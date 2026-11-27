import { describe, expect, it } from 'vitest';
import catalogue from '../icons/generic/catalogue.json';
import { MAX_ART_SHAPES } from '../src/library/art';
import { UKRAINIAN } from '../src/i18n/uk';
import { ICONS } from '../src/i18n/uk-icons';
import { genericIcons, GENERIC_ICON_CATEGORIES } from '../src/library/genericIcons';
import { iconFromSvg, iconIdOf, iconProblem, isIconChoice, isIconKey, type IconDef } from '../src/library/icons';
import { importSvg } from '../src/library/svgImport';
import { setMarking } from '../src/layout/marking';
import type { Project } from '../src/project';
import { buildProjectFile, iconKeysUsed, parseProjectJson } from '../src/project/file';
import { freeIconId, loadOwnIcons, parseIconList, saveOwnIcons } from '../src/project/iconStorage';
import { markingStrips } from '../src/project/marking';
import { emptySchematic, setNodeIcon } from '../src/schematic/model';
import { filterIcons, iconCategories, iconEntries } from '../src/ui/iconCatalog';
import { applyAction, applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { panelOf, place, resolve } from './fixtures';

const sources = import.meta.glob('../icons/generic/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const OWN: IconDef = { id: 'boat', name: 'Boat', category: 'my', widthMm: 24, heightMm: 18, art: [{ kind: 'rect', x: 1, y: 1, width: 22, height: 16, fill: '#000000' }] };
const resolveIcon = (key: string) => (key === 'my/boat' ? OWN : genericIcons().get(key));

describe('the bundled icons', () => {
  it('are every entry of the catalogue, each read from its SVG with nothing left out', () => {
    expect(Object.keys(sources)).toHaveLength(catalogue.icons.length);
    expect(genericIcons().size).toBe(catalogue.icons.length);
    for (const entry of catalogue.icons) {
      const text = sources[`../icons/generic/${entry.id}.svg`];
      expect(text, entry.id).toBeDefined();
      const result = importSvg(text!, { widthMm: 24, leftMm: 0, topMm: 0, anchor: 'left', room: MAX_ART_SHAPES });
      expect(result.ok && result.notes, entry.id).toEqual([]);
    }
  });

  it('are in categories the catalogue lists, with unique ids that make valid keys', () => {
    const categories = new Set(GENERIC_ICON_CATEGORIES.map((c) => c.id));
    const ids = catalogue.icons.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const icon of genericIcons().values()) {
      expect(categories.has(icon.category), icon.id).toBe(true);
      expect(iconProblem(icon), icon.id).toBeNull();
    }
    for (const key of genericIcons().keys()) expect(isIconKey(key), key).toBe(true);
  });
});

describe('an icon', () => {
  it('is refused with a reason when a field is wrong or unknown', () => {
    expect(iconProblem(OWN)).toBeNull();
    expect(iconProblem({ ...OWN, id: 'Boat!' })).toContain('id');
    expect(iconProblem({ ...OWN, widthMm: 0 })).toContain('widthMm');
    expect(iconProblem({ ...OWN, art: [{ kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: 'red' }] })).toContain('colour');
    expect(iconProblem({ ...OWN, colour: '#000000' })).toContain('unknown');
  });

  it('is named by a key of a known source, and a marking may also say none', () => {
    expect(isIconKey('generic/oven')).toBe(true);
    expect(isIconKey('my/boat-2')).toBe(true);
    for (const bad of ['oven', 'other/oven', 'generic/Oven', 'generic/']) expect(isIconKey(bad), bad).toBe(false);
    expect(isIconChoice('none')).toBe(true);
    expect(isIconKey('none')).toBe(false);
  });

  it('comes from an SVG at the import width, keeping its proportions', () => {
    const result = iconFromSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 18"><rect x="0" y="0" width="48" height="18"/></svg>', 'wide', 'Wide', 'my', MAX_ART_SHAPES);
    expect(result.ok && [result.icon.widthMm, result.icon.heightMm]).toEqual([24, 9]);
    expect(iconFromSvg('<html/>', 'x', 'X', 'my', MAX_ART_SHAPES).ok).toBe(false);
  });

  it('takes its id from the file name, numbered when the name is taken', () => {
    expect(iconIdOf('Garage Door_2.SVG')).toBe('garage-door-2');
    expect(iconIdOf('###.svg')).toBe('icon');
    expect(freeIconId([OWN], 'boat.svg')).toBe('boat-2');
    expect(freeIconId([OWN, { ...OWN, id: 'boat-2' }], 'Boat.svg')).toBe('boat-3');
  });
});

describe('own icons in the browser', () => {
  const store = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  };

  it('are kept and read back', () => {
    const s = store();
    expect(saveOwnIcons(s, [OWN])).toBe(true);
    expect(loadOwnIcons(s)).toEqual({ icons: [OWN] });
  });

  it('are ignored with a reason when the stored list is broken or repeats an id', () => {
    expect(parseIconList([OWN, OWN])).toMatchObject({ ok: false, message: expect.stringContaining('twice') });
    const s = store();
    s.setItem('eebox:my-icons', '{');
    expect(loadOwnIcons(s).icons).toEqual([]);
    expect(loadOwnIcons(s).problem).toContain('ignored');
  });
});

describe('finding an icon in the picker', () => {
  const entries = iconEntries([OWN]);

  it('lists the bundled icons, then the own ones, with a category for them', () => {
    expect(entries[entries.length - 1]).toEqual({ key: 'my/boat', icon: OWN });
    expect(iconCategories([OWN]).map((c) => c.id)).toContain('my');
    expect(iconCategories([]).map((c) => c.id)).not.toContain('my');
  });

  it('matches every word of the query in the name, its translation or the id, within a category', () => {
    expect(filterIcons(entries, 'socket type', '').map((e) => e.icon.id)).toContain('socket-type-f');
    expect(filterIcons(entries, 'oven', 'kitchen').every((e) => e.icon.category === 'kitchen')).toBe(true);
    expect(filterIcons(entries, '\u0447\u043e\u0432\u0435\u043d', '', (s) => (s === 'Boat' ? '\u0427\u043e\u0432\u0435\u043d' : s)).map((e) => e.key)).toEqual(['my/boat']);
    expect(filterIcons(entries, 'zzz', '')).toEqual([]);
  });
});

/** A breaker feeding a load with an icon, and a second breaker beside it feeding nothing. */
function withLoadIcon(icon: string | undefined): Project {
  const panel = panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)]);
  const project = { panel, schematic: emptySchematic() };
  const schematic = {
    nodes: [
      { id: 'n1', kind: 'module' as const, label: 'MCB', x: 0, y: 0, placementId: 'p1' },
      { id: 'n2', kind: 'module' as const, label: 'MCB', x: 100, y: 0, placementId: 'p2' },
      { id: 'n3', kind: 'source' as const, label: 'Mains', x: 0, y: -100, conductors: ['L' as const, 'N' as const] },
      { id: 'n4', kind: 'load' as const, label: 'Oven', x: 0, y: 100, conductors: ['L' as const, 'N' as const], ...(icon ? { icon } : {}) },
    ],
    wires: [
      { id: 'w1', a: { node: 'n3', terminal: 'bottom:L' }, b: { node: 'n1', terminal: 'top:L' } },
      { id: 'w2', a: { node: 'n1', terminal: 'bottom:L' }, b: { node: 'n4', terminal: 'top:L' } },
    ],
  };
  return { ...project, schematic };
}

describe('the icon of a marking', () => {
  it('comes from the load the device feeds, unless the device sets its own or none', () => {
    const project = withLoadIcon('generic/oven');
    const icons = (p: Project) => markingStrips(p, resolve).lines[0]!.texts.map((t) => t.icon);
    expect(icons(project)).toEqual(['generic/oven', undefined]);
    const own = setMarking(project.panel, 'p1', 'icon', 'generic/hob');
    expect(own.ok && icons({ ...project, panel: own.panel })).toEqual(['generic/hob', undefined]);
    const none = setMarking(project.panel, 'p1', 'icon', 'none');
    expect(none.ok && icons({ ...project, panel: none.panel })).toEqual([undefined, undefined]);
  });

  it('takes the upper part of the cell above a text, and all of it without one', () => {
    const project = withLoadIcon('generic/oven');
    const [withText] = markingStrips(project, resolve).lines[0]!.texts;
    expect(withText!.iconMm).toBeGreaterThan(0);
    expect(withText!.iconMm).toBeLessThanOrEqual(10);
    const iconOnly = setMarking(project.panel, 'p2', 'icon', 'generic/hob');
    if (!iconOnly.ok) throw new Error('mark');
    const [, alone] = markingStrips({ ...project, panel: iconOnly.panel }, resolve).lines[0]!.texts;
    expect(alone).toMatchObject({ icon: 'generic/hob', lines: [] });
    expect(alone!.iconMm).toBeCloseTo(25 - 5 - 2 * 0.7);
  });

  it('keeps apart neighbours with the same text and different icons', () => {
    let panel = panelOf([{ ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' }, { ...place('p2', 'mcb1', 0, 1), label: 'Kitchen' }]);
    const merged = markingStrips({ panel, schematic: emptySchematic() }, resolve).lines[0]!.texts;
    expect(merged.map((t) => t.placementIds)).toEqual([['p1', 'p2']]);
    const set = setMarking(panel, 'p2', 'icon', 'generic/hob');
    if (set.ok) panel = set.panel;
    expect(markingStrips({ panel, schematic: emptySchematic() }, resolve).lines[0]!.texts.map((t) => t.placementIds)).toEqual([['p1'], ['p2']]);
  });

  it('is set on a load only, and must be a key', () => {
    const { schematic } = withLoadIcon(undefined);
    expect(setNodeIcon(schematic, 'n4', 'generic/oven').ok).toBe(true);
    expect(setNodeIcon(schematic, 'n3', 'generic/oven')).toEqual({ ok: false, error: { kind: 'not-a-load' } });
    expect(setNodeIcon(schematic, 'n4', 'none')).toEqual({ ok: false, error: { kind: 'invalid-icon' } });
    const set = setNodeIcon(schematic, 'n4', 'generic/oven');
    const cleared = set.ok ? setNodeIcon(set.schematic, 'n4', undefined) : set;
    expect(cleared.ok && 'icon' in cleared.schematic.nodes[3]!).toBe(false);
  });
});

describe('own icons in a project file', () => {
  it('travel with the file, the bundled ones do not, and a file without any has no icons field', () => {
    const project = withLoadIcon('generic/oven');
    const marked = setMarking(project.panel, 'p2', 'icon', 'my/boat');
    if (!marked.ok) throw new Error('mark');
    const file = buildProjectFile({ ...project, panel: marked.panel }, resolve, resolveIcon);
    expect(file.icons).toEqual({ 'my/boat': OWN });
    const parsed = parseProjectJson(JSON.stringify(file));
    expect(parsed.ok && parsed.file.icons).toEqual({ 'my/boat': OWN });
    expect(buildProjectFile(project, resolve, resolveIcon)).not.toHaveProperty('icons');
  });

  it('are refused under a key that does not match, or with bad shapes', () => {
    const base = buildProjectFile(withLoadIcon(undefined), resolve);
    expect(parseProjectJson(JSON.stringify({ ...base, icons: { 'my/ship': OWN } })).ok).toBe(false);
    expect(parseProjectJson(JSON.stringify({ ...base, icons: { 'generic/boat': OWN } })).ok).toBe(false);
    expect(parseProjectJson(JSON.stringify({ ...base, icons: { 'my/boat': { ...OWN, art: 'x' } } })).ok).toBe(false);
  });

  it('refuse an icon on a node that is not a load', () => {
    const base = buildProjectFile(withLoadIcon(undefined), resolve);
    const bad = { ...base, project: { ...base.project, schematic: { ...base.project.schematic, nodes: base.project.schematic.nodes.map((n) => (n.id === 'n3' ? { ...n, icon: 'generic/oven' } : n)) } } };
    expect(parseProjectJson(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('the icon in the inspector', () => {
  const ctx = (project: Project, selection: InspectContext['selection']): InspectContext => ({ project, selection, mode: selection.nodeId ? 'schematic' : 'panel', resolve, snapshot: {}, fromLibraries: resolve, resolveIcon });
  const value = (c: InspectContext, key: string) => inspect(c)?.fields.find((f) => f.key === key)?.value;

  it('names the icon of a device, says when it comes from its load, and offers the picker', () => {
    const project = withLoadIcon('generic/oven');
    expect(value(ctx(project, { placementId: 'p1' }), 'markingIconName')).toBe('Oven (from its load)');
    expect(value(ctx(project, { placementId: 'p2' }), 'markingIconName')).toBe('none');
    expect(inspect(ctx(project, { placementId: 'p1' }))?.actions.map((a) => a.key)).toContain('chooseIcon');
    const edited = applyEdit(ctx(project, { placementId: 'p2' }), 'markingIcon', 'my/boat');
    expect(edited.ok && value(ctx(edited.project, { placementId: 'p2' }), 'markingIconName')).toBe('Boat');
  });

  it('names the icon of a load and sets it', () => {
    const project = withLoadIcon(undefined);
    expect(value(ctx(project, { nodeId: 'n4' }), 'icon')).toBe('none');
    const edited = applyEdit(ctx(project, { nodeId: 'n4' }), 'icon', 'generic/oven');
    expect(edited.ok && value(ctx(edited.project, { nodeId: 'n4' }), 'icon')).toBe('Oven');
  });

  it('leaves choosing to the view', () => {
    expect(applyAction(ctx(withLoadIcon(undefined), { placementId: 'p1' }), 'chooseIcon').ok).toBe(false);
  });
});

describe('the Ukrainian names of the bundled icons', () => {
  it('cover every icon and category, except names that read the same in both', () => {
    const same = new Set(['Wi-Fi', 'Zigbee']);
    for (const name of [...catalogue.categories.map((c) => c.name), ...catalogue.icons.map((i) => i.name)]) {
      expect(typeof ICONS[name] === 'string' || same.has(name), name).toBe(true);
    }
  });

  it('stay out of the page dictionary, so a circuit labelled Kitchen or Oven keeps its label', () => {
    for (const name of ['Kitchen', 'Oven', 'Garage', 'Sauna', 'Boiler, gas']) expect(UKRAINIAN[name], name).toBeUndefined();
  });
});

describe('the icons a project uses', () => {
  it('are those of the markings, on the rails and on the shelf, and of the loads, without none', () => {
    const project = withLoadIcon('generic/oven');
    const marked = setMarking(project.panel, 'p2', 'icon', 'my/boat');
    const refused = marked.ok ? setMarking(marked.panel, 'p1', 'icon', 'none') : marked;
    if (!refused.ok) throw new Error('mark');
    expect(iconKeysUsed({ ...project, panel: refused.panel }).sort()).toEqual(['generic/oven', 'my/boat']);
  });
});

describe('the words of an icon import', () => {
  it('speak of an icon, not of the face of a module', () => {
    const many = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 10">${Array.from({ length: 40 }, (_, i) => `<rect x="${i * 2}" y="0" width="1" height="10"/>`).join('')}</svg>`;
    const refused = iconFromSvg(many, 'many', 'Many', 'my', MAX_ART_SHAPES);
    expect(!refused.ok && refused.message).toContain('an icon has room for 32');
    const grey = iconFromSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 18"><rect x="1" y="1" width="9" height="9" fill="url(#g)"/></svg>', 'grey', 'Grey', 'my', MAX_ART_SHAPES);
    expect(grey.ok && grey.notes.join()).toContain('in an icon');
    expect(grey.ok && grey.notes.join()).not.toContain('face');
  });
});

describe('icons that came with a project', () => {
  it('are listed after the own ones, under My icons', () => {
    const fromProject: IconDef = { ...OWN, id: 'ship', name: 'Ship' };
    const entries = iconEntries([OWN], [fromProject]);
    expect(entries.slice(-2).map((e) => e.key)).toEqual(['my/boat', 'my/ship']);
    expect(iconCategories([fromProject]).map((c) => c.id)).toContain('my');
  });
});
