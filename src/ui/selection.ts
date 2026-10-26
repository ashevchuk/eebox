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
