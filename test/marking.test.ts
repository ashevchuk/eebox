import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { deriveMarking } from '../src/electrical/marking';
import { DEFAULT_STRIP_HEIGHT_MM, MARKING_PALETTE, markingCheck, setMarking, setStripHeight } from '../src/layout/marking';
import type { Panel, Placement } from '../src/layout/placement';
import type { Conductor } from '../src/library/types';
import type { Project } from '../src/project';
import { buildProjectFile, parseProjectJson, projectWarnings } from '../src/project/file';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { findMarkingFindings, fitText, markingStrips, MIN_FONT_MM, resolveMarking, textColourOn } from '../src/project/marking';
import { addNode, connect, emptySchematic, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const PURPLE = MARKING_PALETTE[0].hex;
const GREEN = MARKING_PALETTE[1].hex;

/**
 * Mains feeds an RCD (p1) and a breaker without one (p4); the RCD feeds two breakers (p2, p3); p2
 * feeds the kitchen sockets, p3 a contactor (p5, on the second row) that feeds the hall light, and p4 the garden.
 */
function house(placements: Placement[] = [place('p1', 'rcd4', 0, 0), place('p2', 'mcb1', 0, 4), place('p3', 'mcb1', 0, 5), place('p4', 'mcb1', 0, 6), place('p5', 'contactor', 1, 0)]): Project {
  const panel = panelOf(placements);
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const add = (kind: 'source' | 'load', label: string, conductors: Conductor[]) => {
    schematic = addNode(schematic, { kind, label, x: 0, y: 0, conductors }).schematic;
    return schematic.nodes[schematic.nodes.length - 1]!.id;
  };
  const mains = add('source', 'Mains', ['L1', 'L2', 'L3', 'N', 'PE']);
  const kitchen = add('load', 'Kitchen sockets', ['L', 'N', 'PE']);
  const hall = add('load', 'Hall light', ['L1', 'N', 'PE']);
  const garden = add('load', 'Garden', ['L', 'N', 'PE']);
  const node = (id: string) => schematic.nodes.find((n) => n.placementId === id)!.id;
  const wire = (a: string, at: string, b: string, bt: string) => {
    const result = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: a, terminal: at }, { node: b, terminal: bt });
    if (!result.ok) throw new Error(`${a} ${at} - ${b} ${bt}: ${result.error.kind}`);
    schematic = result.schematic;
  };
  wire(mains, 'bottom:L1', node('p1'), 'top:L1');
  wire(mains, 'bottom:L2', node('p4'), 'top:L');
  wire(node('p1'), 'bottom:L1', node('p2'), 'top:L');
  wire(node('p1'), 'bottom:L1', node('p3'), 'top:L');
  wire(node('p2'), 'bottom:L', kitchen, 'top:L');
  wire(node('p3'), 'bottom:L', node('p5'), 'top:L1');
  wire(node('p5'), 'bottom:T1', hall, 'top:L1');
  wire(node('p4'), 'bottom:L', garden, 'top:L');
  return { panel, schematic };
}

const labelled = (project: Project, labels: Record<string, string>): Project => ({
  ...project,
  panel: { ...project.panel, placements: project.panel.placements.map((p) => (labels[p.id] ? { ...p, label: labels[p.id] } : p)) },
});

describe('what the wiring says about a marking', () => {
  const derived = deriveMarking(house(), resolve);

  it('groups a device under the nearest RCD that feeds it, the RCD under itself, and leaves the rest out', () => {
    expect(['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => derived.get(id)?.rcd)).toEqual(['p1', 'p1', 'p1', undefined, 'p1']);
  });

  it('names the loads a breaker protects, through a contactor, and none for the RCD whose breakers protect them', () => {
    expect(derived.get('p2')?.loads).toEqual(['Kitchen sockets']);
    expect(derived.get('p3')?.loads).toEqual(['Hall light']);
    expect(derived.get('p5')?.loads).toEqual(['Hall light']);
    expect(derived.get('p1')?.loads).toEqual([]);
  });
});

describe('the text and group of a cell', () => {
  it('take what was set by hand, else the label, else the loads', () => {
    const derived = { rcd: 'p1', loads: ['Kitchen sockets', 'Oven'] };
    const bare = place('p2', 'mcb1', 0, 0);
    expect(resolveMarking(bare, derived)).toEqual({ text: 'Kitchen sockets, Oven', groupKey: 'rcd:p1' });
    expect(resolveMarking({ ...bare, label: 'Kitchen' }, derived).text).toBe('Kitchen');
    expect(resolveMarking({ ...bare, label: 'Kitchen', marking: { text: 'Cooking', group: 'Wet', colour: '#123456' } }, derived)).toEqual({ text: 'Cooking', groupKey: 'group:Wet', colour: '#123456' });
  });
});

describe('the marking strips', () => {
  it('number the modules over the panel and colour each group, the modules outside one in grey', () => {
    const { lines } = markingStrips(house(), resolve);
    const heads = lines.flatMap((l) => l.heads);
    expect(heads.map((h) => [h.placementId, h.number])).toEqual([['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4], ['p5', 5]]);
    expect(heads.map((h) => h.colour)).toEqual([PURPLE, PURPLE, PURPLE, '#d0d0d0', PURPLE]);
  });

  it('join neighbours of one group with the same text, and keep apart other groups and gaps', () => {
    const project = labelled(house(), { p2: 'Kitchen', p3: 'Kitchen', p4: 'Kitchen' });
    const texts = markingStrips(project, resolve).lines[0]!.texts;
    expect(texts.map((t) => t.placementIds)).toEqual([['p1'], ['p2', 'p3'], ['p4']]);
    expect(texts[1]).toMatchObject({ offsetUnits: 4, widthUnits: 2, lines: ['Kitchen'] });

    const apart = labelled(house([place('p1', 'rcd4', 0, 0), place('p2', 'mcb1', 0, 4), place('p3', 'mcb1', 0, 6), place('p4', 'mcb1', 0, 7), place('p5', 'contactor', 1, 0)]), { p2: 'Kitchen', p3: 'Kitchen' });
    expect(markingStrips(apart, resolve).lines[0]!.texts.map((t) => t.placementIds)).toEqual([['p1'], ['p2'], ['p3'], ['p4']]);
  });

  it('take a group and a colour set by hand', () => {
    const project = house();
    let panel: Panel = project.panel;
    for (const [id, key, value] of [['p4', 'group', 'Outside'], ['p2', 'colour', '#000000']] as const) {
      const result = setMarking(panel, id, key, value);
      if (!result.ok) throw new Error(result.error.kind);
      panel = result.panel;
    }
    const heads = markingStrips({ ...project, panel }, resolve).lines.flatMap((l) => l.heads);
    expect(heads.map((h) => h.colour)).toEqual([PURPLE, '#000000', PURPLE, GREEN, PURPLE]);
    expect(heads[1]!.textColour).toBe('#ffffff');
  });

  it('are as high as the panel says, 25 mm unless set', () => {
    expect(markingStrips(house(), resolve).heightMm).toBe(DEFAULT_STRIP_HEIGHT_MM);
    const taller = setStripHeight(house().panel, 18);
    expect(taller.ok && markingStrips({ ...house(), panel: taller.panel }, resolve).heightMm).toBe(18);
  });
});

describe('fitting the text into a cell', () => {
  it('keeps a short text large and on one line', () => {
    expect(fitText('Oven', 16, 17)).toEqual({ lines: ['Oven'], fontMm: 3.2, cut: false });
  });

  it('wraps at word ends while the text fits at the largest size', () => {
    expect(fitText('Living room, Bedroom', 16, 17)).toEqual({ lines: ['Living', 'room,', 'Bedroom'], fontMm: 3.2, cut: false });
  });

  it('makes the letters smaller until the longest word fits on a line', () => {
    const fit = fitText('Dishwasher', 16, 17);
    expect(fit).toMatchObject({ lines: ['Dishwasher'], cut: false });
    expect(fit.fontMm).toBe(2.7);
  });

  it('keeps the line breaks that were typed', () => {
    expect(fitText('Kitchen\nWC', 30, 17).lines).toEqual(['Kitchen', 'WC']);
  });

  it('shortens a text that does not fit at the smallest size, and says so', () => {
    const fit = fitText('Protection of people touching faulty equipment or wiring in the whole house', 14, 5);
    expect(fit).toMatchObject({ fontMm: MIN_FONT_MM, cut: true });
    expect(fit.lines[fit.lines.length - 1]!.endsWith('…')).toBe(true);
    expect(fit.lines.length * MIN_FONT_MM * 1.15).toBeLessThanOrEqual(5);
  });
});

describe('a marking set by hand', () => {
  const panel = panelOf([place('p1', 'mcb1', 0, 0)]);
  const set = (p: Panel, key: 'text' | 'colour' | 'group', value: string) => setMarking(p, 'p1', key, value);

  it('trims the lines of a text, drops empty ones and clears with blank text', () => {
    const result = set(panel, 'text', '  Kitchen \r\n\n  WC ');
    expect(result.ok && result.panel.placements[0]?.marking).toEqual({ text: 'Kitchen\nWC' });
    const cleared = result.ok ? set(result.panel, 'text', ' ') : result;
    expect(cleared.ok && 'marking' in cleared.panel.placements[0]!).toBe(false);
  });

  it('keeps the other fields when one is cleared', () => {
    const both = set(panel, 'colour', '#ABCDEF');
    const withGroup = both.ok ? set(both.panel, 'group', 'Wet') : both;
    const cleared = withGroup.ok ? set(withGroup.panel, 'colour', '') : withGroup;
    expect(cleared.ok && cleared.panel.placements[0]?.marking).toEqual({ group: 'Wet' });
  });

  it('refuses a colour that is not #rrggbb, a text over 80 characters or 4 lines, and a bad group', () => {
    for (const [key, value] of [['colour', 'red'], ['colour', '#abc'], ['text', 'x'.repeat(81)], ['text', 'a\nb\nc\nd\ne'], ['group', 'g'.repeat(61)]] as const) {
      expect(set(panel, key, value), `${key} ${value}`).toEqual({ ok: false, error: { kind: 'invalid-marking' } });
    }
  });

  it('travels in a project file, and a bad one is refused', () => {
    const file = (placement: Placement, stripHeightMm?: number) =>
      JSON.stringify(buildProjectFile({ panel: { ...panelOf([placement]), ...(stripHeightMm ? { stripHeightMm } : {}) }, schematic: emptySchematic() }, resolve));
    const parsed = parseProjectJson(file({ ...place('p1', 'mcb1', 0, 0), marking: { text: 'Kitchen\nWC', colour: '#27ae60', group: 'Wet' } }, 18));
    expect(parsed.ok && parsed.file.project.panel.placements[0]?.marking).toEqual({ text: 'Kitchen\nWC', colour: '#27ae60', group: 'Wet' });
    expect(parsed.ok && parsed.file.project.panel.stripHeightMm).toBe(18);
    expect(parseProjectJson(file({ ...place('p1', 'mcb1', 0, 0), marking: { colour: 'red' } })).ok).toBe(false);
    expect(parseProjectJson(file(place('p1', 'mcb1', 0, 0), 50)).ok).toBe(false);
    expect(markingCheck({})).toContain('at least one');
    expect(markingCheck({ shape: 'x' })).toContain('unknown');
    expect(markingCheck({ icon: 'generic/oven' })).toBeNull();
    expect(markingCheck({ icon: 'none' })).toBeNull();
    expect(markingCheck({ icon: 'elsewhere/oven' })).toContain('icon');
  });

  it('keeps the strip height within its bounds', () => {
    expect(setStripHeight(panel, 11).ok).toBe(false);
    expect(setStripHeight(panel, 41).ok).toBe(false);
    const back = setStripHeight({ ...panel, stripHeightMm: 18 }, DEFAULT_STRIP_HEIGHT_MM);
    expect(back.ok && 'stripHeightMm' in back.panel).toBe(false);
  });
});

describe('the colour of the text on a header', () => {
  it('is black on light colours and white on dark ones', () => {
    expect(textColourOn('#f1c40f')).toBe('#000000');
    expect(textColourOn('#d0d0d0')).toBe('#000000');
    expect(textColourOn('#8e44ad')).toBe('#ffffff');
  });
});

describe('the marking in the inspector', () => {
  const ctx = (project: Project, selection: InspectContext['selection']): InspectContext => ({ project, selection, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });
  const field = (c: InspectContext, key: string) => inspect(c)?.fields.find((f) => f.key === key);
  const ok = (result: ReturnType<typeof applyEdit>): Project => {
    if (!result.ok) throw new Error(result.message);
    return result.project;
  };

  it('shows what the strip says without a hand-set value, and the RCD the group comes from', () => {
    const c = ctx(house(), { placementId: 'p2' });
    expect(field(c, 'markingText')).toMatchObject({ kind: 'longtext', value: '', placeholder: 'Kitchen sockets' });
    expect(field(c, 'markingColour')).toMatchObject({ value: 'automatic', options: ['automatic', ...MARKING_PALETTE.map((p) => p.name)] });
    expect(field(c, 'markingGroup')).toMatchObject({ value: '', placeholder: 'RCD 4P' });
  });

  it('stores a colour picked by name as its hex value, and automatic clears it', () => {
    const picked = ok(applyEdit(ctx(house(), { placementId: 'p2' }), 'markingColour', 'Green'));
    expect(picked.panel.placements.find((p) => p.id === 'p2')?.marking).toEqual({ colour: GREEN });
    expect(field(ctx(picked, { placementId: 'p2' }), 'markingColour')?.value).toBe('Green');
    const cleared = ok(applyEdit(ctx(picked, { placementId: 'p2' }), 'markingColour', 'automatic'));
    expect(cleared.panel.placements.find((p) => p.id === 'p2')).not.toHaveProperty('marking');
  });

  it('edits the text and the group, and refuses a text that is too long', () => {
    const text = ok(applyEdit(ctx(house(), { placementId: 'p2' }), 'markingText', 'Kitchen\nWC'));
    const group = ok(applyEdit(ctx(text, { placementId: 'p2' }), 'markingGroup', 'Wet'));
    expect(group.panel.placements.find((p) => p.id === 'p2')?.marking).toEqual({ text: 'Kitchen\nWC', group: 'Wet' });
    const refused = applyEdit(ctx(house(), { placementId: 'p2' }), 'markingText', 'x'.repeat(81));
    expect(!refused.ok && refused.message).toContain('80 characters');
  });

  it('offers no strip fields for a device on the plate', () => {
    const project = { panel: panelOf([{ id: 'p1', module: { libraryId: 'lib', moduleId: 'contactor' }, plate: 'plate1', x: 10, y: 300 }]), schematic: emptySchematic() };
    expect(field(ctx(project, { placementId: 'p1' }), 'markingText')).toBeUndefined();
  });

  it('sets the strip height of the panel within its bounds', () => {
    const c = ctx(house(), {});
    expect(field(c, 'stripHeight')?.value).toBe(DEFAULT_STRIP_HEIGHT_MM);
    expect(ok(applyEdit(c, 'stripHeight', '18')).panel.stripHeightMm).toBe(18);
    expect(applyEdit(c, 'stripHeight', '50').ok).toBe(false);
  });
});

describe('a strip text that does not fit', () => {
  it('is advice in Check that names the modules of the cell, on a low strip', () => {
    const low = setStripHeight(house().panel, 12);
    if (!low.ok) throw new Error('height');
    const project = { ...house(), panel: low.panel };
    const long = setMarking(project.panel, 'p2', 'text', 'Protection of people touching faulty equipment');
    if (!long.ok) throw new Error(long.error.kind);
    const findings = findMarkingFindings({ ...project, panel: long.panel }, resolve);
    expect(findings).toEqual([{ message: 'Strip text of MCB 1P [p2] does not fit; shorten it or make the strip taller', severity: 'advice', wires: [], nodes: [], placements: ['p2'] }]);
    expect(projectWarnings({ ...project, panel: long.panel }, resolve)).toContain(findings[0]!.message);
    expect(findMarkingFindings(project, resolve)).toEqual([]);
  });
});
