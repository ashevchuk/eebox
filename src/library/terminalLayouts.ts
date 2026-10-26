import { fixedRange } from './positions';
import type { Conductor, TerminalDef, TerminalSide } from './types';

const PRECISION = 1000;

/**
 * Centres of `count` terminals, each in the middle of an equal share of a module `width` units wide.
 * When that would put the outer ones too close to an edge, they are spread evenly between the
 * outermost positions the module allows instead.
 */
export function evenPositions(count: number, width: number): number[] {
  const round = (n: number) => Math.round(n * PRECISION) / PRECISION;
  const { min, max } = fixedRange(width);
  const shares = Array.from({ length: count }, (_, i) => round(((i + 0.5) * width) / count - 0.5));
  if (count === 1 || (shares[0]! >= min && shares[count - 1]! <= max)) return shares;
  return Array.from({ length: count }, (_, i) => round(min + (i * (max - min)) / (count - 1)));
}

export interface RowSpec {
  side: TerminalSide;
  count: number;
  conductor: Conductor;
  /** Terminals are named `<prefix>1`, `<prefix>2`...; a single one is named `<prefix>`. */
  prefix: string;
  /** Join them all inside the module, as the terminals of a distribution block are. */
  joined: boolean;
}

/**
 * Terminals for one side: evenly spread by position on a module of fixed width, and as one group with
 * a count on a resizable one, where the group grows with the module and stays spread over its width.
 */
export function rowEntries(resizable: boolean, spec: RowSpec, width: number, net: string | undefined): TerminalDef[] {
  const joined = net ? { net } : {};
  if (resizable) {
    return [{ name: spec.prefix, conductor: spec.conductor, side: spec.side, ...(spec.count > 1 ? { count: spec.count } : {}), ...joined }];
  }
  return evenPositions(spec.count, width).map((unit, i) => ({
    name: spec.count === 1 ? spec.prefix : `${spec.prefix}${i + 1}`,
    conductor: spec.conductor,
    side: spec.side,
    unit,
    ...joined,
  }));
}

export interface BlockSpec {
  /** Terminals on the top side, usually the inputs. */
  top: number;
  /** Terminals on the bottom side, usually the outputs. */
  bottom: number;
  conductor: Conductor;
  /** True for a distribution block, where every terminal is the same point. */
  joined: boolean;
}

/** The terminals of a block: `top` on the top side and `bottom` on the bottom, evenly spread. */
export function blockTerminals(spec: BlockSpec, width: number, resizable: boolean): TerminalDef[] {
  const net = spec.joined ? 'NET1' : undefined;
  const sides: Array<[TerminalSide, number, string]> = [['top', spec.top, 'IN'], ['bottom', spec.bottom, 'OUT']];
  return sides.flatMap(([side, count, prefix]) =>
    count === 0 ? [] : rowEntries(resizable, { side, count, conductor: spec.conductor, prefix, joined: spec.joined }, width, net),
  );
}
