import { describe, expect, it } from 'vitest';
import { nodesOfPlacements, placementsOfNodes } from '../src/ui/selection';

const nodes = [
  { id: 'n1', placementId: 'p1' },
  { id: 'n2', placementId: 'p2' },
  { id: 'n3' },
  { id: 'n4', placementId: 'p4' },
];

describe('what a selection stands for in the other view', () => {
  it('shows the placements of several selected nodes, and none for a node without one', () => {
    expect(placementsOfNodes({ nodeIds: ['n1', 'n3', 'n4'] }, nodes)).toEqual(['p1', 'p4']);
    expect(placementsOfNodes({ nodeId: 'n2' }, nodes)).toEqual(['p2']);
    expect(placementsOfNodes({}, nodes)).toEqual([]);
  });

  it('shows the nodes of several selected placements, one placement and none', () => {
    expect(nodesOfPlacements({ placementIds: ['p1', 'p4'], combIds: [] }, nodes)).toEqual(['n1', 'n4']);
    expect(nodesOfPlacements({ placementId: 'p2' }, nodes)).toEqual(['n2']);
    expect(nodesOfPlacements({ placementId: 'p9' }, nodes)).toEqual([]);
  });
});
