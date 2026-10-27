import type { Resolve } from '../electrical/context';
import type { Project } from '../project';
import type { Objects } from './problems';
import type { Mode } from './session';

export interface SearchResult {
  /** What was found, as a short title. */
  title: string;
  /** Where it is, and what else is known of it. */
  detail: string;
  /** The view the hit belongs to; the other view is used only when this one has nothing of it. */
  prefer: Mode;
  objects: Objects;
}

export const MAX_SEARCH_RESULTS = 30;

const none = { placements: [], nodes: [], wires: [], combs: [] };

/** Everything on the drawings whose label, name, article number or id contains the words typed, best matches first. */
export function searchProject(project: Project, resolve: Resolve, query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: Array<{ rank: number; result: SearchResult }> = [];
  const consider = (fields: Array<string | undefined>, result: SearchResult) => {
    const texts = fields.filter((f): f is string => !!f).map((f) => f.toLowerCase());
    if (!words.every((word) => texts.some((text) => text.includes(word)))) return;
    const first = texts[0] ?? '';
    // A hit on the label of the thing beats a hit on its article number; an exact label beats a part of one.
    const rank = words.every((word) => first === word) ? 0 : words.every((word) => first.includes(word)) ? 1 : 2;
    hits.push({ rank, result });
  };

  const rows = project.panel.railLabels;
  project.panel.placements.forEach((placement) => {
    const def = resolve(placement.module);
    consider([placement.label, def?.name, def?.sku, placement.id], {
      title: placement.label ?? def?.name ?? placement.id,
      detail: `${def?.name ?? 'module'} · row ${placement.rail + 1}${rows[placement.rail] ? ` (${rows[placement.rail]})` : ''}`,
      prefer: 'panel',
      objects: { ...none, placements: [placement.id] },
    });
  });
  project.panel.combs.forEach((comb) => {
    const def = resolve(comb.module);
    consider([comb.label, def?.name, def?.sku, comb.id], {
      title: comb.label ?? def?.name ?? comb.id,
      detail: `${def?.name ?? 'comb'} · row ${comb.rail + 1}`,
      prefer: 'panel',
      objects: { ...none, combs: [comb.id] },
    });
  });
  // Module nodes carry the label of their placement, which is found above.
  project.schematic.nodes
    .filter((node) => node.kind !== 'module')
    .forEach((node) => {
      consider([node.label, node.id], {
        title: node.label,
        detail: node.kind === 'source' ? 'source' : 'load',
        prefer: 'schematic',
        objects: { ...none, nodes: [node.id] },
      });
    });
  project.schematic.wires.forEach((wire) => {
    consider([wire.label, wire.id], {
      title: wire.label ?? wire.id,
      detail: 'wire',
      prefer: 'schematic',
      objects: { ...none, wires: [wire.id] },
    });
  });
  return hits
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SEARCH_RESULTS)
    .map((hit) => hit.result);
}
