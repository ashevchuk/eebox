import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import {
  addNode,
  connect,
  emptySchematic,
  syncModuleNodes,
  type Schematic,
} from '../src/schematic/model';
import { applyAction, applyEdit, inspect, type InspectContext, type InspectorField } from '../src/ui/inspector';
import type { Mode, Selection } from '../src/ui/session';
import { combAt, defs, panelOf, place, resolve } from './fixtures';
import type { ModuleDef } from '../src/library/types';

function build(): Project {
  const panel = panelOf(
    [place('p1', 'breaker16', 0, 0), place('p2', 'mcb3', 0, 4), place('p3', 'nbar', 0, 10)],
    [combAt('c1', 'comb1', 0, 0)],
    [24, 24],
  );
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L1', 'L2', 'L3', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  for (const [a, b] of [
    [{ node: 'n4', terminal: 'bottom:L1' }, { node: 'n1', terminal: 'top:L' }],
    [{ node: 'n4', terminal: 'bottom:N' }, { node: 'n3', terminal: 'top:N3' }],
    [{ node: 'n4', terminal: 'bottom:N' }, { node: 'n3', terminal: 'top:N1' }],
  ] as const) {
    const wired = connect(schematic, terminalsOf, a, b);
    if (!wired.ok) throw new Error(wired.error.kind);
    schematic = wired.schematic;
  }
  return { panel, schematic };
}

const ctx = (
  selection: Selection,
  mode: Mode = 'panel',
  project: Project = build(),
  libraries: Partial<Pick<InspectContext, 'snapshot' | 'fromLibraries'>> = {},
): InspectContext => ({ project, selection, mode, resolve, snapshot: {}, fromLibraries: resolve, ...libraries });
const fieldsOf = (c: InspectContext) => inspect(c)?.fields ?? [];
const field = (c: InspectContext, key: string): InspectorField | undefined => fieldsOf(c).find((f) => f.key === key);
const keysOf = (c: InspectContext) => fieldsOf(c).map((f) => f.key);

function ok(result: ReturnType<typeof applyEdit>): Project {
  if (!result.ok) throw new Error(result.message || JSON.stringify(result.needsConfirm));
  return result.project;
}
function message(result: ReturnType<typeof applyEdit>): string {
  if (result.ok) throw new Error('expected a failure');
  return result.message;
}

describe('inspect: what is shown', () => {
  it('shows the panel itself when nothing is selected or the selection is stale', () => {
    for (const c of [
      ctx({}),
      ctx({}, 'schematic'),
      ctx({ placementId: 'gone', combId: 'gone', rail: 9 }),
      ctx({ nodeId: 'gone', wireId: 'gone' }, 'schematic'),
    ]) {
      expect(inspect(c).title).toBe('Panel');
    }
  });

  it('describes the panel: title, rows and what is on it', () => {
    const c = ctx({});
    expect(field(c, 'title')).toMatchObject({ kind: 'text', value: '', placeholder: 'Untitled panel' });
    expect(field(c, 'rows')).toMatchObject({ kind: 'integer', value: 2, min: 1, max: 20 });
    expect(field(c, 'size')?.value).toBe('longest row 24 units');
    expect(field(c, 'contents')?.value).toBe('3 modules, 1 combs, 0 on the shelf');
  });

  it('describes a module with its position, details and a label placeholder', () => {
    const view = inspect(ctx({ placementId: 'p1' }))!;
    expect(view.title).toBe('Module');
    expect(field(ctx({ placementId: 'p1' }), 'label')).toMatchObject({ kind: 'text', value: '', placeholder: 'MCB 1P C16' });
    expect(field(ctx({ placementId: 'p1' }), 'row')).toMatchObject({ kind: 'integer', value: 1, min: 1, max: 2 });
    expect(field(ctx({ placementId: 'p1' }), 'slot')).toMatchObject({ kind: 'number', value: 0, min: 0, max: 23, hint: 'units from the start of the rail, 0 mm' });
    expect(keysOf(ctx({ placementId: 'p1' }))).toEqual(
      expect.arrayContaining(['module', 'kind', 'poles', 'rated', 'curve', 'capacity', 'residual', 'sku', 'terminals', 'id']),
    );
    expect(field(ctx({ placementId: 'p1' }), 'rated')?.value).toBe('16 A');
    expect(field(ctx({ placementId: 'p1' }), 'capacity')?.value).toBe('6 kA');
  });

  it('leaves out the details a module does not have', () => {
    expect(keysOf(ctx({ placementId: 'p2' }))).not.toContain('rated');
    expect(keysOf(ctx({ placementId: 'p2' }))).not.toContain('sku');
  });

  it('lets only resizable modules have an editable width, with the allowed range', () => {
    expect(field(ctx({ placementId: 'p1' }), 'width')).toMatchObject({ kind: 'readonly', value: '1 units (17.5 mm)' });
    expect(field(ctx({ placementId: 'p3' }), 'width')).toMatchObject({ kind: 'number', value: 3, min: 2, max: 12, hint: '2-12 units, 52.5 mm' });
  });

  it('keeps the position range tied to the width of this copy', () => {
    expect(field(ctx({ placementId: 'p3' }), 'slot')?.max).toBe(24 - 3);
    const wide = build();
    wide.panel.placements[2] = { ...wide.panel.placements[2]!, widthUnits: 10 };
    expect(field(ctx({ placementId: 'p3' }, 'panel', wide), 'slot')?.max).toBe(14);
  });

  it('summarises terminals, and only counts them on a long bar', () => {
    expect(field(ctx({ placementId: 'p2' }), 'terminals')?.value).toBe('top L1 L2 L3 · bottom L1 L2 L3');
    expect(field(ctx({ placementId: 'p3' }), 'terminals')?.value).toBe('top N1 N2 N3 · bottom Nb1 Nb2 Nb3');
    const bar = build();
    bar.panel.placements[2] = { ...bar.panel.placements[2]!, widthUnits: 12 };
    expect(field(ctx({ placementId: 'p3' }, 'panel', bar), 'terminals')?.value).toBe('top 12 · bottom 12');
  });

  it('describes a comb, preferring it over a placement selected with it', () => {
    const view = inspect(ctx({ combId: 'c1', placementId: 'p1' }))!;
    expect(view.title).toBe('Comb');
    expect(field(ctx({ combId: 'c1' }), 'pattern')?.value).toBe('L');
    expect(field(ctx({ combId: 'c1' }), 'side')?.value).toBe('top');
    expect(field(ctx({ combId: 'c1' }), 'width')).toMatchObject({ kind: 'number', value: 6, min: 2, max: 12 });
  });

  it('describes a row, with spacing only when there is a row below', () => {
    const first = inspect(ctx({ rail: 0 }))!;
    expect(first.title).toBe('Row 1');
    expect(field(ctx({ rail: 0 }), 'label')).toMatchObject({ value: '', placeholder: 'Row 1' });
    expect(field(ctx({ rail: 0 }), 'length')).toMatchObject({ value: 24, min: 1, max: 144 });
    expect(field(ctx({ rail: 0 }), 'spacing')).toMatchObject({ value: 150, min: 90, max: 500 });
    expect(field(ctx({ rail: 0 }), 'contents')?.value).toBe('3 modules, 1 comb');
    expect(keysOf(ctx({ rail: 1 }))).not.toContain('spacing');
    expect(field(ctx({ rail: 1 }), 'contents')?.value).toBe('0 modules, 0 combs');
  });

  it('shows a module node as its module plus the node position, in the schematic only', () => {
    const view = inspect(ctx({ nodeId: 'n1', placementId: 'p1' }, 'schematic'))!;
    expect(view.title).toBe('Module node');
    expect(keysOf(ctx({ nodeId: 'n1' }, 'schematic'))).toEqual(expect.arrayContaining(['label', 'row', 'slot', 'nodeX', 'nodeY']));
    expect(keysOf(ctx({ placementId: 'p1' }))).not.toContain('nodeX');
  });

  it('describes a source with ticked conductors, and an orphaned module node plainly', () => {
    expect(field(ctx({ nodeId: 'n4' }, 'schematic'), 'conductors')).toMatchObject({
      kind: 'choices',
      value: ['L1', 'L2', 'L3', 'N', 'PE'],
      options: ['L', 'L1', 'L2', 'L3', 'N', 'PE', 'C', 'DCP', 'DCN'],
    });
    const orphaned: Project = { ...build(), panel: { ...build().panel, placements: [] } };
    expect(keysOf(ctx({ nodeId: 'n1' }, 'schematic', orphaned))).toEqual(
      expect.arrayContaining(['label', 'status', 'nodeX', 'nodeY']),
    );
    expect(keysOf(ctx({ nodeId: 'n1' }, 'schematic', orphaned))).not.toContain('conductors');
  });

  it('describes a wire by what it joins, using the labels of the modules', () => {
    const labelled = ok(applyEdit(ctx({ placementId: 'p1' }), 'label', 'Kitchen'));
    const c = ctx({ wireId: 'w1' }, 'schematic', labelled);
    expect(inspect(c)?.title).toBe('Wire');
    expect(field(c, 'from')?.value).toBe('Mains · bottom L1');
    expect(field(c, 'to')?.value).toBe('Kitchen · top L');
    expect(field(c, 'conductor')?.value).toBe('L1');
  });

  it('prefers a wire over a node in the schematic', () => {
    expect(inspect(ctx({ wireId: 'w1', nodeId: 'n4' }, 'schematic'))?.title).toBe('Wire');
  });
});

describe('applyEdit: labels', () => {
  it('labels a module, a comb, a row and a wire', () => {
    expect(ok(applyEdit(ctx({ placementId: 'p1' }), 'label', ' Kitchen ')).panel.placements[0]?.label).toBe('Kitchen');
    expect(ok(applyEdit(ctx({ combId: 'c1' }), 'label', 'Phase bus')).panel.combs[0]?.label).toBe('Phase bus');
    expect(ok(applyEdit(ctx({ rail: 1 }), 'label', 'Lighting')).panel.railLabels).toEqual(['', 'Lighting']);
    expect(ok(applyEdit(ctx({ wireId: 'w1' }, 'schematic'), 'label', 'NYM 3x1.5')).schematic.wires[0]?.label).toBe('NYM 3x1.5');
  });

  it('labelling a module node labels its module, so both views agree', () => {
    const next = ok(applyEdit(ctx({ nodeId: 'n1', placementId: 'p1' }, 'schematic'), 'label', 'Kitchen'));
    expect(next.panel.placements[0]?.label).toBe('Kitchen');
    expect(next.schematic.nodes).toEqual(build().schematic.nodes);
  });

  it('clears a label with blank text, but a source or load always keeps one', () => {
    const labelled = ok(applyEdit(ctx({ placementId: 'p1' }), 'label', 'Kitchen'));
    const cleared = ok(applyEdit(ctx({ placementId: 'p1' }, 'panel', labelled), 'label', ''));
    expect('label' in cleared.panel.placements[0]!).toBe(false);
    expect(message(applyEdit(ctx({ nodeId: 'n4' }, 'schematic'), 'label', ' '))).toBe('This item needs a label.');
  });

  it('renames a source', () => {
    expect(ok(applyEdit(ctx({ nodeId: 'n4' }, 'schematic'), 'label', 'Grid')).schematic.nodes[3]?.label).toBe('Grid');
  });

  it('refuses invalid text with the rule, and leaves the project untouched', () => {
    const before = build();
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'label', 'a\nb'))).toMatch(/1 to 60 characters/);
    expect(message(applyEdit(ctx({ rail: 0 }), 'label', 'x'.repeat(61)))).toMatch(/1 to 60 characters/);
    expect(message(applyEdit(ctx({ wireId: 'w1' }, 'schematic'), 'label', 'x'.repeat(61)))).toMatch(/1 to 60 characters/);
    expect(before).toEqual(build());
  });
});

describe('applyEdit: position and width', () => {
  it('moves a module to another row and position', () => {
    const moved = ok(applyEdit(ctx({ placementId: 'p1' }), 'row', '2'));
    expect(moved.panel.placements[0]).toMatchObject({ rail: 1, slot: 0 });
    expect(ok(applyEdit(ctx({ placementId: 'p1' }), 'slot', '7')).panel.placements[0]?.slot).toBe(7);
  });

  it('says what is in the way, or that it does not fit, or that the row does not exist', () => {
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'slot', '4'))).toBe('Overlaps p2.');
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'slot', '24'))).toBe('Does not fit on the rail.');
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'row', '3'))).toBe('There is no such row.');
  });

  it('asks for a number, and for a whole one where only a whole one makes sense, such as the row', () => {
    for (const bad of ['', 'abc']) {
      expect(message(applyEdit(ctx({ placementId: 'p1' }), 'slot', bad))).toBe('Enter a number.');
    }
    for (const bad of ['', 'abc', '1.5']) {
      expect(message(applyEdit(ctx({ placementId: 'p1' }), 'row', bad))).toBe('Enter a whole number.');
    }
  });

  it('moves a module to a position that is not a whole number of units, as a relay of 22.5 mm needs', () => {
    const moved = ok(applyEdit(ctx({ placementId: 'p1' }), 'slot', '1.2857'));
    expect(moved.panel.placements.find((p) => p.id === 'p1')?.slot).toBe(1.2857);
  });

  it('moves a comb the same way', () => {
    expect(ok(applyEdit(ctx({ combId: 'c1' }), 'slot', '3')).panel.combs[0]?.slot).toBe(3);
    expect(message(applyEdit(ctx({ combId: 'c1' }), 'slot', '20'))).toBe('Does not fit on the rail.');
  });

  it('gives a bar its own width and a comb too', () => {
    expect(ok(applyEdit(ctx({ placementId: 'p3' }), 'width', '8')).panel.placements[2]?.widthUnits).toBe(8);
    expect(ok(applyEdit(ctx({ combId: 'c1' }), 'width', '10')).panel.combs[0]?.widthUnits).toBe(10);
  });

  it('refuses a width outside the range, on a module that cannot be resized, or into a neighbour', () => {
    expect(message(applyEdit(ctx({ placementId: 'p3' }), 'width', '13'))).toBe('The width is outside what the library allows.');
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'width', '2'))).toBe('This module cannot be resized.');
    const crowded = ok(applyEdit(ctx({ placementId: 'p1' }), 'slot', '13'));
    expect(message(applyEdit(ctx({ placementId: 'p3' }, 'panel', crowded), 'width', '4'))).toBe('Overlaps p1.');
  });

  it('asks before a narrower bar removes wires from terminals that disappear, then does it', () => {
    const c = ctx({ placementId: 'p3' });
    const asked = applyEdit(c, 'width', '2');
    expect(asked).toMatchObject({ ok: false, needsConfirm: { message: expect.stringContaining('1 wire') } });
    const confirmed = ok(applyEdit(c, 'width', '2', { confirmed: true }));
    expect(confirmed.panel.placements[2]?.widthUnits).toBe(2);
    expect(confirmed.schematic.wires.map((w) => w.id)).toEqual(['w1', 'w3']);
  });

  it('does not ask when no wire is affected, and keeps every wire when the bar grows', () => {
    const grown = ok(applyEdit(ctx({ placementId: 'p3' }), 'width', '12'));
    expect(grown.schematic.wires).toHaveLength(3);
    const narrow = applyEdit(ctx({ placementId: 'p3' }), 'width', '3');
    expect(narrow.ok).toBe(true);
  });

  it('moves the node of a module node', () => {
    const moved = ok(applyEdit(ctx({ nodeId: 'n1', placementId: 'p1' }, 'schematic'), 'nodeX', '300'));
    expect(moved.schematic.nodes[0]?.x).toBe(300);
  });
});

describe('applyEdit: rows', () => {
  it('changes the length, refusing what would not fit the modules', () => {
    expect(ok(applyEdit(ctx({ rail: 1 }), 'length', '12')).panel.railLengthsUnits).toEqual([24, 12]);
    expect(message(applyEdit(ctx({ rail: 0 }), 'length', '5'))).toBe('Modules on this row would not fit.');
    expect(message(applyEdit(ctx({ rail: 0 }), 'length', '500'))).toBe('Length is 1 to 144 units.');
  });

  it('changes the spacing within its limits', () => {
    expect(ok(applyEdit(ctx({ rail: 0 }), 'spacing', '200')).panel.railPitchesMm).toEqual([200]);
    expect(message(applyEdit(ctx({ rail: 0 }), 'spacing', '50'))).toBe('Spacing is 90 to 500 mm.');
  });

  it('moves a row with its contents and keeps it selected at its new position', () => {
    const result = applyEdit(ctx({ rail: 0 }), 'position', '2');
    if (!result.ok) throw new Error(result.message);
    expect(result.selection).toEqual({ rail: 1 });
    expect(result.project.panel.placements.map((p) => p.rail)).toEqual([1, 1, 1]);
    expect(message(applyEdit(ctx({ rail: 0 }), 'position', '3'))).toBe('There is no such row.');
  });
});

describe('applyEdit: sources and loads', () => {
  it('moves a node', () => {
    const moved = ok(applyEdit(ctx({ nodeId: 'n4' }, 'schematic'), 'nodeY', '-250'));
    expect(moved.schematic.nodes[3]?.y).toBe(-250);
  });

  it('changes the conductors, asking before it removes wires', () => {
    const c = ctx({ nodeId: 'n4' }, 'schematic');
    const asked = applyEdit(c, 'conductors', ['L1', 'L2', 'L3', 'PE']);
    expect(asked).toMatchObject({ ok: false, needsConfirm: { message: expect.stringContaining('2 wires') } });
    const confirmed = ok(applyEdit(c, 'conductors', ['L1', 'L2', 'L3', 'PE'], { confirmed: true }));
    expect(confirmed.schematic.wires.map((w) => w.id)).toEqual(['w1']);
    expect(confirmed.schematic.nodes[3]?.conductors).toEqual(['L1', 'L2', 'L3', 'PE']);
  });

  it('changes the conductors without asking when no wire is on them', () => {
    const next = ok(applyEdit(ctx({ nodeId: 'n4' }, 'schematic'), 'conductors', ['L1', 'L2', 'L3', 'N', 'PE', 'L']));
    expect(next.schematic.nodes[3]?.conductors).toEqual(['L', 'L1', 'L2', 'L3', 'N', 'PE']);
  });

  it('refuses an empty set of conductors', () => {
    expect(message(applyEdit(ctx({ nodeId: 'n4' }, 'schematic'), 'conductors', []))).toBe(
      'A conductor can be ticked once, and at least one is needed.',
    );
  });
});

describe('applyEdit: guards', () => {
  it('refuses an unknown property, a read-only one, and an empty selection', () => {
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'poles', '3'))).toBe('That property cannot be edited.');
    expect(message(applyEdit(ctx({ placementId: 'p1' }), 'nope', 'x'))).toBe('That property cannot be edited.');
    expect(message(applyEdit(ctx({}), 'label', 'x'))).toBe('That property cannot be edited.');
  });

  it('never mutates the project it was given', () => {
    const project = build();
    const snapshot = structuredClone(project);
    applyEdit(ctx({ placementId: 'p3' }, 'panel', project), 'width', '8');
    applyEdit(ctx({ rail: 0 }, 'panel', project), 'position', '2');
    applyEdit(ctx({ nodeId: 'n4' }, 'schematic', project), 'conductors', ['L1'], { confirmed: true });
    expect(project).toEqual(snapshot);
  });
});

describe('panel properties', () => {
  it('sets and clears the title, and refuses an invalid one', () => {
    expect(ok(applyEdit(ctx({}), 'title', ' Flat 12 ')).panel.title).toBe('Flat 12');
    const titled = ok(applyEdit(ctx({}), 'title', 'Flat 12'));
    expect('title' in ok(applyEdit(ctx({}, 'panel', titled), 'title', '')).panel).toBe(false);
    expect(message(applyEdit(ctx({}), 'title', 'x'.repeat(61)))).toMatch(/1 to 60 characters/);
  });

  it('changes the number of rows, refusing one that still holds modules', () => {
    expect(ok(applyEdit(ctx({}), 'rows', '3')).panel.railLengthsUnits).toHaveLength(3);
    expect(ok(applyEdit(ctx({}), 'rows', '1')).panel.railLengthsUnits).toHaveLength(1);
    expect(message(applyEdit(ctx({}), 'rows', '0'))).toBe('Rows: 1 to 20.');
    expect(message(applyEdit(ctx({}), 'rows', 'abc'))).toBe('Enter a whole number.');
    const withModuleOnSecondRow = ok(applyEdit(ctx({ placementId: 'p1' }), 'row', '2'));
    expect(message(applyEdit(ctx({}, 'panel', withModuleOnSecondRow), 'rows', '1'))).toBe(
      'Move the modules off the rows you remove first.',
    );
  });
});

describe('terminal labels', () => {
  it('lists a field for every terminal of a module, named after the terminal', () => {
    const terminals = fieldsOf(ctx({ placementId: 'p2' })).filter((f) => f.key.startsWith('terminal:'));
    expect(terminals.map((f) => f.key)).toEqual([
      'terminal:top:L1', 'terminal:top:L2', 'terminal:top:L3',
      'terminal:bottom:L1', 'terminal:bottom:L2', 'terminal:bottom:L3',
    ]);
    expect(terminals[0]).toMatchObject({ label: 'L1 (top)', kind: 'text', value: '', placeholder: 'L1' });
  });

  it('follows the width of a bar: a wider copy has more terminals to label', () => {
    const count = (c: InspectContext) => fieldsOf(c).filter((f) => f.key.startsWith('terminal:')).length;
    expect(count(ctx({ placementId: 'p3' }))).toBe(6);
    const wide = ok(applyEdit(ctx({ placementId: 'p3' }), 'width', '6'));
    expect(count(ctx({ placementId: 'p3' }, 'panel', wide))).toBe(12);
  });

  it('labels and clears one terminal, and shows the label in the field', () => {
    const labelled = ok(applyEdit(ctx({ placementId: 'p3' }), 'terminal:top:N2', 'Kitchen'));
    expect(labelled.panel.placements[2]?.terminalLabels).toEqual({ 'top:N2': 'Kitchen' });
    expect(field(ctx({ placementId: 'p3' }, 'panel', labelled), 'terminal:top:N2')?.value).toBe('Kitchen');
    const cleared = ok(applyEdit(ctx({ placementId: 'p3' }, 'panel', labelled), 'terminal:top:N2', ''));
    expect('terminalLabels' in cleared.panel.placements[2]!).toBe(false);
  });

  it('refuses an invalid terminal label', () => {
    expect(message(applyEdit(ctx({ placementId: 'p3' }), 'terminal:top:N2', 'a\nb'))).toMatch(/1 to 60 characters/);
  });

  it('is available on a module node too, where it edits the placement', () => {
    const next = ok(applyEdit(ctx({ nodeId: 'n3', placementId: 'p3' }, 'schematic'), 'terminal:top:N1', 'Hall'));
    expect(next.panel.placements[2]?.terminalLabels).toEqual({ 'top:N1': 'Hall' });
  });
});

describe('take off', () => {
  const actions = (c: InspectContext) => inspect(c).actions.map((a) => a.key);

  it('is offered for a module and a module node, and for nothing else', () => {
    expect(actions(ctx({ placementId: 'p1' }))).toEqual(['editModule', 'takeOff']);
    expect(actions(ctx({ nodeId: 'n1', placementId: 'p1' }, 'schematic'))).toEqual(['editModule', 'takeOff']);
    for (const c of [ctx({ combId: 'c1' }), ctx({ rail: 0 }), ctx({}), ctx({ wireId: 'w1' }, 'schematic'), ctx({ nodeId: 'n4' }, 'schematic')]) {
      expect(actions(c)).toEqual([]);
    }
  });

  it('moves the module to the shelf and clears the selection on the panel', () => {
    const result = applyAction(ctx({ placementId: 'p1' }), 'takeOff');
    if (!result.ok) throw new Error(result.message);
    expect(result.project.panel.placements.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(result.project.panel.shelf.map((s) => s.id)).toEqual(['p1']);
    expect(result.selection).toEqual({});
  });

  it('keeps the node selected in the schematic, and its wires, ready for when the module returns', () => {
    const result = applyAction(ctx({ nodeId: 'n1', placementId: 'p1' }, 'schematic'), 'takeOff');
    if (!result.ok) throw new Error(result.message);
    expect(result.selection).toEqual({ nodeId: 'n1' });
    expect(result.project.schematic).toEqual(build().schematic);
  });

  it('refuses an unknown action', () => {
    const result = applyAction(ctx({ placementId: 'p1' }), 'explode');
    expect(result.ok).toBe(false);
  });
});

describe('updating modules from the libraries', () => {
  const stored = { 'lib/nbar': defs.nbar! };
  const fromLibraries = (overrides: Record<string, ModuleDef | undefined>) => (ref: { libraryId: string; moduleId: string }) =>
    ref.moduleId in overrides ? overrides[ref.moduleId] : resolve(ref);
  const renamed = fromLibraries({ nbar: { ...defs.nbar!, name: 'N bar v2' } });
  const fewerTerminals = fromLibraries({
    nbar: {
      ...defs.nbar!,
      terminals: [
        { name: 'N', conductor: 'N', side: 'top', net: 'N', count: 2 },
        { name: 'Nb', conductor: 'N', side: 'bottom', net: 'N', count: 2 },
      ],
    },
  });
  const widerBar = fromLibraries({ nbar: { ...defs.nbar!, widthUnits: 8 } });

  it('says the stored data matches, and offers nothing, when it does', () => {
    const view = inspect(ctx({}, 'panel', build(), { snapshot: stored }));
    expect(view.fields.find((f) => f.key === 'libraries')?.value).toBe('matches the libraries');
    expect(view.actions).toEqual([]);
  });

  it('counts the modules that differ or have vanished, and offers the update', () => {
    const view = inspect(ctx({}, 'panel', build(), { snapshot: stored, fromLibraries: renamed }));
    expect(view.fields.find((f) => f.key === 'libraries')?.value).toBe('1 differ from the libraries');
    expect(view.actions).toEqual([{ key: 'updateModules', label: 'Update modules from libraries' }]);
    const gone = inspect(ctx({}, 'panel', build(), { snapshot: stored, fromLibraries: fromLibraries({ nbar: undefined }) }));
    expect(gone.fields.find((f) => f.key === 'libraries')?.value).toBe('1 no longer in any library');
    expect(gone.actions).toEqual([]);
  });

  it('takes the new definitions over at once when it harms nothing, and says so', () => {
    const result = applyAction(ctx({}, 'panel', build(), { snapshot: stored, fromLibraries: renamed }), 'updateModules');
    if (!result.ok) throw new Error(result.message);
    expect(result.snapshot?.['lib/nbar']?.name).toBe('N bar v2');
    expect(result.message).toBe('Updated 1 module from the libraries.');
    expect(result.project).toEqual(build());
  });

  it('asks first when wires would be removed, then does it', () => {
    const c = ctx({}, 'panel', build(), { snapshot: stored, fromLibraries: fewerTerminals });
    const asked = applyAction(c, 'updateModules');
    expect(asked).toMatchObject({ ok: false, needsConfirm: { message: expect.stringContaining('removes 1 wire') } });
    const confirmed = applyAction(c, 'updateModules', { confirmed: true });
    if (!confirmed.ok) throw new Error(confirmed.message);
    expect(confirmed.project.schematic.wires.map((w) => w.id)).toEqual(['w1', 'w3']);
  });

  it('asks first when the new definitions cause problems, and names them', () => {
    const base = build();
    const crowded: Project = { ...base, panel: { ...base.panel, placements: base.panel.placements.map((p) => (p.id === 'p3' ? { ...p, slot: 1 } : p)) } };
    const c = ctx({}, 'panel', crowded, { snapshot: stored, fromLibraries: widerBar });
    expect(applyAction(c, 'updateModules')).toMatchObject({ ok: false, needsConfirm: { message: expect.stringContaining('causes') } });
  });

  it('refuses when nothing differs, and on anything but the panel', () => {
    const same = applyAction(ctx({}, 'panel', build(), { snapshot: stored }), 'updateModules');
    expect(same).toEqual({ ok: false, message: 'The modules already match the libraries.' });
    const elsewhere = applyAction(ctx({ placementId: 'p1' }, 'panel', build(), { snapshot: stored, fromLibraries: renamed }), 'updateModules');
    expect(elsewhere.ok).toBe(false);
  });
});

describe('inspector: load power and cable', () => {
  const withLoad = (): Project => {
    const base = build();
    const added = addNode(base.schematic, { kind: 'load', label: 'Oven', x: 0, y: 0, conductors: ['L', 'N', 'PE'] });
    return { ...base, schematic: added.schematic };
  };
  const loadCtx = (project: Project = withLoad()) => ctx({ nodeId: 'n5' }, 'schematic', project);

  it('offers power, power factor, laying method and cable on a load, and nothing of the kind on a source', () => {
    expect(keysOf(loadCtx())).toEqual(expect.arrayContaining(['powerW', 'powerFactor', 'method', 'crossSection']));
    expect(keysOf(ctx({ nodeId: 'n4' }, 'schematic', withLoad()))).not.toContain('powerW');
  });

  it('shows no result until a power is set', () => {
    expect(keysOf(loadCtx())).not.toContain('current');
  });

  it('takes a power, then shows the current and the minimum cable with the table caveat', () => {
    const project = ok(applyEdit(loadCtx(), 'powerW', '2300'));
    expect(project.schematic.nodes.find((n) => n.id === 'n5')?.load).toEqual({ powerW: 2300 });
    const c = loadCtx(project);
    expect(field(c, 'current')?.value).toBe('10 A');
    expect(field(c, 'minSection')?.value).toBe('1.5 mm2');
    expect(String(field(c, 'cableNote')?.value)).toMatch(/not verified/i);
  });

  it('keeps the other fields when one is edited, and clears the whole load with an empty power', () => {
    let project = ok(applyEdit(loadCtx(), 'powerW', '2300'));
    project = ok(applyEdit(loadCtx(project), 'powerFactor', '0.8'));
    project = ok(applyEdit(loadCtx(project), 'method', 'B2'));
    project = ok(applyEdit(loadCtx(project), 'crossSection', '2.5'));
    expect(project.schematic.nodes.find((n) => n.id === 'n5')?.load).toEqual({ powerW: 2300, powerFactor: 0.8, method: 'B2', crossSectionMm2: 2.5 });
    project = ok(applyEdit(loadCtx(project), 'crossSection', ''));
    expect(project.schematic.nodes.find((n) => n.id === 'n5')?.load).toEqual({ powerW: 2300, powerFactor: 0.8, method: 'B2' });
    project = ok(applyEdit(loadCtx(project), 'powerW', ''));
    expect(project.schematic.nodes.find((n) => n.id === 'n5')?.load).toBeUndefined();
  });

  it('refuses text that is not a number, values out of range, and a cable before a power', () => {
    expect(message(applyEdit(loadCtx(), 'powerW', 'lots'))).toBe('Enter a number.');
    expect(message(applyEdit(loadCtx(), 'powerW', '-5'))).toMatch(/power must be above 0/i);
    expect(message(applyEdit(loadCtx(), 'crossSection', '2.5'))).toBe('Enter the power first.');
    const project = ok(applyEdit(loadCtx(), 'powerW', '100'));
    expect(message(applyEdit(loadCtx(project), 'powerFactor', '3'))).toMatch(/power factor/i);
  });
});

describe('inspector: width of a relay', () => {
  const withRelay = (): Project => {
    const base = build();
    return { ...base, panel: { ...base.panel, placements: [...base.panel.placements, place('p9', 'relay', 0, 14)] } };
  };
  const relayCtx = (project: Project = withRelay()) => ctx({ placementId: 'p9' }, 'panel', project);

  it('offers the width of a resizable relay as a number within the range of its library entry', () => {
    expect(field(relayCtx(), 'width')).toMatchObject({ kind: 'number', value: 1, min: 1, max: 4, hint: '1-4 units, 17.5 mm' });
  });

  it('sets the width to two units and keeps the single terminals single', () => {
    const project = ok(applyEdit(relayCtx(), 'width', '2'));
    const placed = project.panel.placements.find((p) => p.id === 'p9');
    expect(placed?.widthUnits).toBe(2);
    expect(field(relayCtx(project), 'terminals')?.value).toBe('top L N · bottom 14');
  });

  it('refuses a width outside the range and does not touch the project', () => {
    expect(message(applyEdit(relayCtx(), 'width', '5'))).toBe('The width is outside what the library allows.');
  });
});

describe('inspector: cross-section of a wire', () => {
  const wired = () => ctx({ wireId: build().schematic.wires[0]!.id }, 'schematic');

  it('offers the cross-section as a choice of the table sizes, empty at first', () => {
    expect(field(wired(), 'section')).toMatchObject({ kind: 'select', value: '', options: ['', '1.5', '2.5', '4', '6', '10', '16', '25', '35'] });
  });

  it('sets and clears it, and refuses a size that is not listed', () => {
    const project = ok(applyEdit(wired(), 'section', '4'));
    expect(project.schematic.wires[0]?.crossSectionMm2).toBe(4);
    const shown = ctx({ wireId: project.schematic.wires[0]!.id }, 'schematic', project);
    expect(field(shown, 'section')?.value).toBe('4');
    expect(ok(applyEdit(shown, 'section', '')).schematic.wires[0]).not.toHaveProperty('crossSectionMm2');
    expect(message(applyEdit(wired(), 'section', '3'))).toBe('That cross-section is not in the table.');
  });
});

describe('inspector: edit module', () => {
  it('is offered only when the module is known, so a module that is missing from every library has nothing to edit', () => {
    const missing: Project = { ...build(), panel: { ...build().panel, placements: [place('p1', 'ghost', 0, 0)] } };
    expect(inspect(ctx({ placementId: 'p1' }, 'panel', missing)).actions.map((a) => a.key)).toEqual(['takeOff']);
  });

  it('is not run by the model: opening a designer is the job of the view', () => {
    expect(applyAction(ctx({ placementId: 'p1' }), 'editModule')).toMatchObject({ ok: false });
  });
});
