import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';
import { focusOfObjects, objectsOfSelection } from '../src/ui/problems';
import { MAX_SEARCH_RESULTS, searchProject } from '../src/ui/search';
import { fromMinimap, minimapFit, toMinimap, visibleWorld } from '../src/view/minimap';
import { combAt, panelOf, place, resolve } from './fixtures';

function project(): Project {
  const placements = [
    { ...place('p1', 'breaker16', 0, 0), label: 'Kitchen' },
    { ...place('p2', 'breaker16', 0, 2), label: 'Kitchen sockets' },
    place('p3', 'mcb1', 1, 4),
  ];
  const panel = { ...panelOf(placements, [{ ...combAt('c1', 'comb3', 0, 0), label: 'Bus' }]), railLabels: ['Incoming', ''] };
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains 3-phase', x: 0, y: -100, conductors: ['L', 'N'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const source = schematic.nodes.find((n) => n.kind === 'source')!.id;
  const module = schematic.nodes.find((n) => n.placementId === 'p1')!.id;
  const joined = connect(schematic, terminalsOf, { node: source, terminal: 'bottom:L' }, { node: module, terminal: 'top:L' });
  if (!joined.ok) throw new Error('wire');
  return { panel, schematic: { ...joined.schematic, wires: joined.schematic.wires.map((w) => ({ ...w, label: '3x2.5 mm2' })) } };
}

describe('searching a project', () => {
  it('finds a module by its label and says which row it is in', () => {
    const [first] = searchProject(project(), resolve, 'kitchen');
    expect(first?.title).toBe('Kitchen');
    expect(first?.detail).toContain('row 1 (Incoming)');
    expect(first?.prefer).toBe('panel');
    expect(first?.objects.placements).toEqual(['p1']);
  });

  it('puts an exact label before a longer one that merely contains it', () => {
    expect(searchProject(project(), resolve, 'kitchen').map((r) => r.title)).toEqual(['Kitchen', 'Kitchen sockets']);
  });

  it('wants every word to match, in any order and in any of the fields', () => {
    expect(searchProject(project(), resolve, 'sockets kitchen')).toHaveLength(1);
    expect(searchProject(project(), resolve, 'kitchen nonsense')).toEqual([]);
  });

  it('finds sources, wires and combs', () => {
    const p = project();
    expect(searchProject(p, resolve, 'mains')[0]?.prefer).toBe('schematic');
    expect(searchProject(p, resolve, '2.5')[0]?.objects.wires).toHaveLength(1);
    expect(searchProject(p, resolve, 'bus')[0]?.objects.combs).toEqual(['c1']);
  });

  it('finds a module by the name its library gives it when it has no label', () => {
    const hit = searchProject(project(), resolve, 'p3')[0];
    expect(hit?.objects.placements).toEqual(['p3']);
  });

  it('is empty for an empty query and limited for a common one', () => {
    expect(searchProject(project(), resolve, '   ')).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => place(`p${i + 1}`, 'mcb1', 0, i));
    const big = { panel: { ...panelOf(many, [], [80]) }, schematic: emptySchematic() };
    expect(searchProject(big, resolve, 'p').length).toBe(MAX_SEARCH_RESULTS);
  });
});

describe('focusing on objects', () => {
  it('finds a comb and a group of modules on the panel', () => {
    const p = project();
    const comb = focusOfObjects(p, resolve, { placements: [], nodes: [], wires: [], combs: ['c1'] }, 'panel');
    expect(comb?.selection).toEqual({ combId: 'c1' });
    const group = focusOfObjects(p, resolve, { placements: ['p1', 'p2'], nodes: [], wires: [] }, 'panel');
    expect(group?.selection).toEqual({ placementIds: ['p1', 'p2'] });
    expect(group!.bounds.maxX).toBeGreaterThan(group!.bounds.minX);
  });

  it('turns a selection into objects, single or several', () => {
    expect(objectsOfSelection({ placementId: 'p1' }).placements).toEqual(['p1']);
    expect(objectsOfSelection({ placementIds: ['a', 'b'], combIds: ['c'] })).toMatchObject({ placements: ['a', 'b'], combs: ['c'] });
    expect(objectsOfSelection({ wireId: 'w1' }).wires).toEqual(['w1']);
    expect(objectsOfSelection({})).toEqual({ placements: [], combs: [], nodes: [], wires: [] });
  });
});

describe('the minimap', () => {
  const bounds = { minX: 100, minY: 50, maxX: 1100, maxY: 550 };

  it('fits the whole drawing into the map and centres it', () => {
    const fit = minimapFit(bounds, 200, 120);
    const a = toMinimap(fit, { x: bounds.minX, y: bounds.minY });
    const b = toMinimap(fit, { x: bounds.maxX, y: bounds.maxY });
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(200);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeLessThanOrEqual(120);
    expect((a.x + b.x) / 2).toBeCloseTo(100, 6);
    expect((a.y + b.y) / 2).toBeCloseTo(60, 6);
  });

  it('maps a pixel back to the world point it came from', () => {
    const fit = minimapFit(bounds, 200, 120);
    const back = fromMinimap(fit, toMinimap(fit, { x: 640, y: 210 }));
    expect(back.x).toBeCloseTo(640, 6);
    expect(back.y).toBeCloseTo(210, 6);
  });

  it('survives an empty drawing', () => {
    const fit = minimapFit({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 200, 120);
    expect(Number.isFinite(fit.scale)).toBe(true);
  });

  it('says what the camera sees', () => {
    expect(visibleWorld({ x: 500, y: 300, scale: 2 }, 800, 400)).toEqual({ minX: 300, minY: 200, maxX: 700, maxY: 400 });
  });
});
