import { connectAll, type Schematic, type TerminalsOfNode } from './model';

export interface AutowireResult {
  schematic: Schematic;
  /** Wires put in. */
  added: number;
  /** Nodes that got no wire, with why. */
  skipped: Array<{ node: string; reason: 'unknown' | 'same' | 'nothing-to-join' }>;
}

function join(schematic: Schematic, terminalsOf: TerminalsOfNode, from: string, to: string): { schematic: Schematic; added: number; skipped?: AutowireResult['skipped'][number]['reason'] } {
  const result = connectAll(schematic, terminalsOf, from, to);
  if (result.ok) return { schematic: result.schematic, added: result.added };
  const { kind } = result.error;
  return { schematic, added: 0, skipped: kind === 'unknown-node' ? 'unknown' : kind === 'same-terminal' ? 'same' : 'nothing-to-join' };
}

/** Wires every pole of the supplier to the poles of each consumer that face it: the side below it feeds the side above the consumer. */
export function feedFrom(schematic: Schematic, terminalsOf: TerminalsOfNode, supplier: string, consumers: readonly string[]): AutowireResult {
  let next = schematic;
  let added = 0;
  const skipped: AutowireResult['skipped'] = [];
  for (const consumer of consumers.filter((id) => id !== supplier)) {
    const step = join(next, terminalsOf, supplier, consumer);
    next = step.schematic;
    added += step.added;
    if (step.skipped) skipped.push({ node: consumer, reason: step.skipped });
  }
  return { schematic: next, added, skipped };
}

/** Wires the nodes one to the next, from the top of the schematic down and left to right: each output feeds the input of the next. */
export function chainNodes(schematic: Schematic, terminalsOf: TerminalsOfNode, ids: readonly string[]): AutowireResult {
  const ordered = schematic.nodes.filter((n) => ids.includes(n.id)).sort((a, b) => a.y - b.y || a.x - b.x);
  let next = schematic;
  let added = 0;
  const skipped: AutowireResult['skipped'] = [];
  for (let i = 1; i < ordered.length; i++) {
    const step = join(next, terminalsOf, ordered[i - 1]!.id, ordered[i]!.id);
    next = step.schematic;
    added += step.added;
    if (step.skipped) skipped.push({ node: ordered[i]!.id, reason: step.skipped });
  }
  return { schematic: next, added, skipped };
}
