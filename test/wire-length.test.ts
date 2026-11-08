import { describe, expect, it } from 'vitest';
import { terminalsOf } from '../src/electrical/terminals';
import { addFreePlacement } from '../src/layout/free';
import { DEFAULT_WIRE_SLACK_MM } from '../src/layout/limits';
import { setWireSlack } from '../src/layout/panel';
import { addPlate } from '../src/layout/plates';
import { CROSS_PLATE_MM, wireRuns } from '../src/layout/wireLength';
import { MODULE_UNIT_MM } from '../src/library/types';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { defs, panelOf, place, resolve, widthOf } from './fixtures';

const DIN_HEIGHT = 90;
const unitOf = (id: string) => terminalsOf(defs.breaker16!).find((t) => t.id === id)!.unit;

function wired(project: Project, a: [string, string], b: [string, string]): Project {
  const terminalsOf2 = nodeTerminalsLookup(project.panel, resolve);
  const result = connect(project.schematic, terminalsOf2, { node: a[0], terminal: a[1] }, { node: b[0], terminal: b[1] });
  if (!result.ok) throw new Error(result.error.kind);
  return { ...project, schematic: result.schematic };
}

function twoOnARail(): Project {
  const panel = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)], [], [24]);
  return { panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) };
}

describe('wireRuns', () => {
  it('measures along and across the plate between two terminals, and adds the default slack', () => {
    const project = wired(twoOnARail(), ['n1', 'top:L'], ['n2', 'bottom:L']);
    const along = 4 * MODULE_UNIT_MM + (unitOf('top:L') - unitOf('bottom:L')) * MODULE_UNIT_MM;
    expect(wireRuns(project, resolve).get('w1')).toBe(Math.round(Math.abs(along) + DIN_HEIGHT + DEFAULT_WIRE_SLACK_MM));
  });

  it('measures between the terminals of narrow bars along the rail and down their height', () => {
    const panel = panelOf([place('p1', 'colRight', 0, 0), place('p2', 'colRight', 0, 4)], [], [24]);
    const base: Project = { panel, schematic: syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId) };
    // The same side of the two bars: only the distance between them along the rail, 4 units.
    const alongRail = wired(base, ['n1', 'top:A'], ['n2', 'top:A']);
    expect(wireRuns(alongRail, resolve).get('w1')).toBe(4 * MODULE_UNIT_MM + DEFAULT_WIRE_SLACK_MM);
    // Terminal B stands one unit lower on its bar than terminal A.
    const down = wired(base, ['n1', 'top:A'], ['n2', 'top:B']);
    expect(wireRuns(down, resolve).get('w1')).toBe(Math.round(4 * MODULE_UNIT_MM + MODULE_UNIT_MM + DEFAULT_WIRE_SLACK_MM));
  });

  it('takes the slack the panel sets, and the default again when it is set back', () => {
    const project = wired(twoOnARail(), ['n1', 'top:L'], ['n2', 'bottom:L']);
    const run = (panel = project.panel) => wireRuns({ ...project, panel }, resolve).get('w1')!;
    const base = run();
    const less = setWireSlack(project.panel, 40);
    if (!less.ok) throw new Error('slack refused');
    expect(run(less.panel)).toBe(base - DEFAULT_WIRE_SLACK_MM + 40);
    const back = setWireSlack(less.panel, DEFAULT_WIRE_SLACK_MM);
    if (!back.ok) throw new Error('slack refused');
    expect(back.panel.wireSlackMm).toBeUndefined();
    expect(run(back.panel)).toBe(base);
  });

  it('has no length for a wire to a source or to a module that is not on the panel', () => {
    let project = twoOnARail();
    const source = addNode(project.schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L'] });
    project = { ...project, schematic: source.schematic };
    const sourceId = source.schematic.nodes.find((n) => n.kind === 'source')!.id;
    project = wired(project, [sourceId, 'bottom:L'], ['n1', 'top:L']);
    expect(wireRuns(project, resolve).size).toBe(0);
  });

  it('goes out to the nearest edge of each plate and across when the ends are on different plates', () => {
    const base = twoOnARail();
    const door = addPlate(base.panel, 'Door', 300, 400);
    if (!door.ok || !door.id) throw new Error('plate not added');
    const placed = addFreePlacement(door.panel, widthOf, { id: 'p3', module: { libraryId: 'lib', moduleId: 'breaker16' }, plate: door.id, x: 100, y: 60 });
    if (!placed.ok) throw new Error('device not placed');
    let project: Project = { panel: placed.panel, schematic: syncModuleNodes(base.schematic, placed.panel, (r) => r.moduleId) };
    project = wired(project, ['n1', 'top:L'], ['n3', 'bottom:L']);

    const unit = unitOf('top:L') * MODULE_UNIT_MM;
    const back = base.panel.plates[0]!;
    const railY = base.panel.rails[0]!.y;
    const a = { x: base.panel.rails[0]!.x + unit, y: railY - DIN_HEIGHT / 2 };
    const b = { x: 100 + unitOf('bottom:L') * MODULE_UNIT_MM, y: 60 + DIN_HEIGHT };
    const edge = (p: { x: number; y: number }, w: number, h: number) => Math.min(p.x, w - p.x, p.y, h - p.y);
    const expected = Math.round(edge(a, back.widthMm, back.heightMm) + edge(b, 300, 400) + CROSS_PLATE_MM + DEFAULT_WIRE_SLACK_MM);
    expect(wireRuns(project, resolve).get('w1')).toBe(expected);
  });
});
