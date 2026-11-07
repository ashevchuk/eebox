import { familyOf, type TerminalSide } from '../library/types';
import { PASSIVE_KINDS, type NetContext } from './context';
import type { Net } from './nets';

/** The side of a device that the current comes in at when nothing says otherwise. */
const USUAL_INPUT_SIDE: TerminalSide = 'top';

export interface Direction {
  isInput(key: string): boolean;
  isOutput(key: string): boolean;
  /** Placed devices that a source reaches from both sides, so something goes round them. */
  fedFromBothSides: ReadonlySet<string>;
  /** Placed devices whose maker names the input and that a source reaches only through an output. */
  fedThroughOutput: ReadonlySet<string>;
}

/** Only the phases show which way a device is fed: a surge protector has its earth on the far side, and the contacts of a controller are not its output. */
const carriesSupply = (terminal: { conductor: Parameters<typeof familyOf>[0] }): boolean => familyOf(terminal.conductor) === 'phase';

const hasRoles = (own: ReadonlyArray<{ terminal: { role?: string } }>): boolean => own.some((t) => t.terminal.role !== undefined);

/**
 * Which terminals of each placed device are inputs and which outputs. A terminal whose maker gave it a
 * role keeps it. For a device that names none, the input side is the one a source reaches first,
 * following the wires from the sources through the devices; one that no source reaches has the usual
 * direction, the top as the input. Bars and terminal blocks have no direction.
 */
export function directionOf({ project, nets, netOf, defs, terminals }: NetContext): Direction {
  const inputSide = new Map<string, TerminalSide>();
  const fedFromBothSides = new Set<string>();
  const live = new Set<Net>();
  const enteredAtInput = new Set<string>();
  /** The devices a net was reached through: their own terminals on it are where they let the current out, not where it comes in. */
  const reachedThrough = new Map<Net, Set<string>>();
  const queue: Net[] = nets.filter((net) => net.terminals.some((t) => t.owner.kind === 'node' && project.schematic.nodes.find((n) => n.id === t.owner.id)?.kind === 'source'));
  queue.forEach((net) => live.add(net));

  const sideOf = (placementId: string): TerminalSide => inputSide.get(placementId) ?? USUAL_INPUT_SIDE;
  const inputOf = (placementId: string, terminal: { side: TerminalSide; role?: string }): boolean | undefined => {
    const own = terminals.get(placementId) ?? [];
    return hasRoles(own) ? (terminal.role === undefined ? undefined : terminal.role === 'input') : terminal.side === sideOf(placementId);
  };

  for (let next = 0; next < queue.length; next++) {
    for (const t of queue[next]!.terminals) {
      const def = t.owner.kind === 'placement' ? defs.get(t.owner.id) : undefined;
      if (!def || PASSIVE_KINDS.includes(def.kind) || reachedThrough.get(queue[next]!)?.has(t.owner.id) || !carriesSupply(t.terminal)) continue;
      const id = t.owner.id;
      const own = terminals.get(id) ?? [];
      if (!hasRoles(own)) {
        const side = inputSide.get(id);
        if (side === undefined) inputSide.set(id, t.terminal.side);
        else if (side !== t.terminal.side) fedFromBothSides.add(id);
      }
      if (inputOf(id, t.terminal) !== true) continue;
      enteredAtInput.add(id);
      for (const other of own) {
        const passes = other.terminal.conductor === t.terminal.conductor && inputOf(id, other.terminal) === false;
        const onward = passes ? netOf.get(other.key) : undefined;
        if (!onward) continue;
        if (onward === queue[next]) {
          fedFromBothSides.add(id);
          continue;
        }
        reachedThrough.set(onward, (reachedThrough.get(onward) ?? new Set()).add(id));
        if (!live.has(onward)) {
          live.add(onward);
          queue.push(onward);
        }
      }
    }
  }

  const fedThroughOutput = new Set<string>();
  for (const [id, own] of terminals) {
    if (!hasRoles(own) || enteredAtInput.has(id)) continue;
    if (own.some((t) => t.terminal.role === 'output' && carriesSupply(t.terminal) && netOf.has(t.key) && live.has(netOf.get(t.key)!))) fedThroughOutput.add(id);
  }

  const find = (key: string) => {
    const id = key.slice(2, key.indexOf('/'));
    const terminal = terminals.get(id)?.find((t) => t.key === key)?.terminal;
    return terminal ? { id, terminal } : undefined;
  };
  return {
    isInput: (key) => {
      const found = find(key);
      return found !== undefined && inputOf(found.id, found.terminal) === true;
    },
    isOutput: (key) => {
      const found = find(key);
      return found !== undefined && inputOf(found.id, found.terminal) === false;
    },
    fedFromBothSides,
    fedThroughOutput,
  };
}
