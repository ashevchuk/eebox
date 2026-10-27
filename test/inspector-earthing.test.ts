import { describe, expect, it } from 'vitest';
import type { Project } from '../src/project';
import { addNode, emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { panelOf, resolve } from './fixtures';

function ctxOf(project: Project): InspectContext {
  return { project, selection: { nodeId: 'n1' }, mode: 'schematic', resolve, snapshot: {}, fromLibraries: resolve };
}

const project: Project = {
  panel: panelOf([]),
  schematic: addNode(emptySchematic(), { kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L1', 'L2', 'L3', 'PEN'] }).schematic,
};

describe('the earthing of a source in the inspector', () => {
  it('is a choice of the systems, or not stated', () => {
    const field = inspect(ctxOf(project))?.fields.find((f) => f.key === 'earthing');
    expect(field).toMatchObject({ kind: 'select', value: 'not stated', options: ['not stated', 'TN-S', 'TN-C-S', 'TN-C', 'TT', 'IT'] });
  });

  it('is set from the choice, explained by the system, and cleared by choosing not stated', () => {
    const set = applyEdit(ctxOf(project), 'earthing', 'TN-C-S');
    if (!set.ok) throw new Error(set.message);
    const field = inspect(ctxOf(set.project))?.fields.find((f) => f.key === 'earthing');
    expect(field).toMatchObject({ value: 'TN-C-S' });
    expect(String((field as { hint?: string }).hint)).toMatch(/PEN conductor/);
    const cleared = applyEdit(ctxOf(set.project), 'earthing', 'not stated');
    if (!cleared.ok) throw new Error(cleared.message);
    expect(cleared.project.schematic.nodes[0]).not.toHaveProperty('earthing');
  });

  it('refuses a name that is not a system, and is not offered on a load', () => {
    const refused = applyEdit(ctxOf(project), 'earthing', 'TN');
    expect(refused.ok).toBe(false);
    const load: Project = { panel: panelOf([]), schematic: addNode(emptySchematic(), { kind: 'load', label: 'Oven', x: 0, y: 0, conductors: ['L', 'N', 'PE'] }).schematic };
    expect(inspect(ctxOf(load))?.fields.some((f) => f.key === 'earthing')).toBe(false);
  });
});
