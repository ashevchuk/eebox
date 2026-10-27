import { describe, expect, it } from 'vitest';
import { moveGroup } from '../src/layout/group';
import { emptySchematic, addNode } from '../src/schematic/model';
import { nextModuleId, nextNodeId, nodeStep, panelStep } from '../src/ui/keyboardMoves';
import { lookupsOf } from '../src/layout/lookups';
import { panelOf, place, resolve, widthOf } from './fixtures';

const { combLookup } = lookupsOf(resolve);

describe('what the arrow keys do', () => {
  it('move modules along the rail by a unit, or a quarter with Alt, and between rails by one', () => {
    expect(panelStep('ArrowRight', false)).toEqual({ rail: 0, slot: 1 });
    expect(panelStep('ArrowLeft', true)).toEqual({ rail: 0, slot: -0.25 });
    expect(panelStep('ArrowUp', false)).toEqual({ rail: -1, slot: 0 });
    expect(panelStep('ArrowDown', true)).toEqual({ rail: 1, slot: 0 });
  });

  it('move nodes by 10 mm, or 50 with Shift', () => {
    expect(nodeStep('ArrowLeft', false)).toEqual({ dx: -10, dy: 0 });
    expect(nodeStep('ArrowDown', true)).toEqual({ dx: 0, dy: 50 });
  });

  it('work with the move of a group: one step to a free place, nothing past the end of a rail or onto a neighbour', () => {
    const panel = panelOf([place('a', 'breaker16', 0, 0), place('b', 'breaker16', 0, 1)], [], [24, 24]);
    const step = (ids: string[], key: Parameters<typeof panelStep>[0]) => {
      const s = panelStep(key, false);
      return moveGroup(panel, widthOf, combLookup, ids, [], s.rail, s.slot);
    };
    expect(step(['b'], 'ArrowRight').ok).toBe(true);
    expect(step(['a'], 'ArrowRight').ok).toBe(false);
    expect(step(['a'], 'ArrowLeft').ok).toBe(false);
    expect(step(['a', 'b'], 'ArrowRight').ok).toBe(true);
    expect(step(['a'], 'ArrowDown').ok).toBe(true);
    expect(step(['a'], 'ArrowUp').ok).toBe(false);
  });
});

describe('where Tab goes', () => {
  const panel = panelOf([place('p1', 'breaker16', 1, 0), place('p2', 'breaker16', 0, 5), place('p3', 'breaker16', 0, 2)], [], [24, 24]);

  it('walks the modules by row and position, and wraps round', () => {
    expect(nextModuleId(panel, ['p3'], false)).toBe('p2');
    expect(nextModuleId(panel, ['p2'], false)).toBe('p1');
    expect(nextModuleId(panel, ['p1'], false)).toBe('p3');
  });

  it('walks back with Shift', () => {
    expect(nextModuleId(panel, ['p3'], true)).toBe('p1');
    expect(nextModuleId(panel, ['p2'], true)).toBe('p3');
  });

  it('starts at the first, or at the last when going back, when nothing is selected', () => {
    expect(nextModuleId(panel, [], false)).toBe('p3');
    expect(nextModuleId(panel, [], true)).toBe('p1');
    expect(nextModuleId(panelOf([]), [], false)).toBeNull();
  });

  it('continues from the last of several selected', () => {
    expect(nextModuleId(panel, ['p3', 'p2'], false)).toBe('p1');
  });

  it('walks the nodes of a schematic from the top down', () => {
    let schematic = emptySchematic();
    for (const [label, x, y] of [['low', 0, 100], ['high right', 90, 0], ['high left', 10, 0]] as const) {
      schematic = addNode(schematic, { kind: 'load', label, x, y, conductors: ['L'] }).schematic;
    }
    const byLabel = (id: string | null) => schematic.nodes.find((n) => n.id === id)?.label;
    const first = nextNodeId(schematic, [], false);
    expect(byLabel(first)).toBe('high left');
    expect(byLabel(nextNodeId(schematic, [first!], false))).toBe('high right');
    expect(byLabel(nextNodeId(schematic, [schematic.nodes.find((n) => n.label === 'low')!.id], false))).toBe('high left');
  });
});
