import type { Selection } from './session';

/** Ids of everything selected on the panel, whether it is one item or a group. */
export function selectedIds(selection: Selection): { placements: string[]; combs: string[] } {
  return {
    placements: selection.placementIds ?? (selection.placementId ? [selection.placementId] : []),
    combs: selection.combIds ?? (selection.combId ? [selection.combId] : []),
  };
}

/** Adds the item to the selection, or takes it out if it is in already; one item left becomes a plain selection. */
export function toggleItem(selection: Selection, kind: 'placement' | 'comb', id: string): Selection {
  const current = selectedIds(selection);
  const list = kind === 'placement' ? current.placements : current.combs;
  const changed = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return groupSelection(kind === 'placement' ? changed : current.placements, kind === 'comb' ? changed : current.combs);
}

export function groupSelection(placements: string[], combs: string[]): Selection {
  if (placements.length + combs.length === 0) return {};
  if (placements.length === 1 && combs.length === 0) return { placementId: placements[0]! };
  if (placements.length === 0 && combs.length === 1) return { combId: combs[0]! };
  return { placementIds: placements, combIds: combs };
}

/** Ids of the selected nodes of the schematic, whether it is one or a group. */
export function selectedNodes(selection: Selection): string[] {
  return selection.nodeIds ?? (selection.nodeId ? [selection.nodeId] : []);
}

/** One node is a plain selection of it; several are a group; none is no selection. */
export function nodeGroupSelection(ids: string[], placementOf: (id: string) => string | undefined = () => undefined): Selection {
  if (ids.length === 0) return {};
  if (ids.length > 1) return { nodeIds: ids };
  const placementId = placementOf(ids[0]!);
  return { nodeId: ids[0]!, ...(placementId ? { placementId } : {}) };
}

/** Adds the node to the selected nodes, or takes it out if it is in already. */
export function toggleNode(selection: Selection, id: string, placementOf?: (id: string) => string | undefined): Selection {
  const current = selectedNodes(selection);
  return nodeGroupSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id], placementOf);
}

/** Ids of the selected wires, whether it is one or a group. */
export function selectedWires(selection: Selection): string[] {
  return selection.wireIds ?? (selection.wireId ? [selection.wireId] : []);
}

/** One wire is a plain selection of it; several are a group; none is no selection. */
export function wireGroupSelection(ids: string[]): Selection {
  if (ids.length === 0) return {};
  return ids.length === 1 ? { wireId: ids[0]! } : { wireIds: ids };
}

/** Adds the wire to the selected wires, or takes it out if it is in already. */
export function toggleWire(selection: Selection, id: string): Selection {
  const current = selectedWires(selection);
  return wireGroupSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
}
