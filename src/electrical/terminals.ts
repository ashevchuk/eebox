import type { Conductor, ModuleDef, TerminalSide } from '../library/types';

export interface Terminal {
  /** Unique within a module: `<side>:<name>`. */
  id: string;
  name: string;
  conductor: Conductor;
  side: TerminalSide;
  /** Horizontal position inside the module, in module units. */
  unit: number;
  /** Terminals with the same net are connected inside the module. */
  net?: string;
}

export const terminalId = (side: TerminalSide, name: string): string => `${side}:${name}`;

export function defaultPoleConductors(poles: ModuleDef['poles']): Conductor[] {
  switch (poles) {
    case 1:
      return ['L'];
    case 2:
      return ['L', 'N'];
    case 3:
      return ['L1', 'L2', 'L3'];
    case 4:
      return ['L1', 'L2', 'L3', 'N'];
  }
}

type Draft = Omit<Terminal, 'unit'> & { unit?: number };

function draftsOf(def: ModuleDef, widthUnits: number): Draft[] {
  if (def.terminals) {
    const scale = def.resizable ? widthUnits / def.widthUnits : 1;
    return def.terminals.flatMap((t) => {
      const count = scale === 1 || t.count === undefined ? (t.count ?? 1) : Math.max(1, Math.round(t.count * scale));
      return Array.from({ length: count }, (_, i): Draft => {
        const name = count > 1 ? `${t.name}${i + 1}` : t.name;
        return {
          id: terminalId(t.side, name),
          name,
          conductor: t.conductor,
          side: t.side,
          ...(t.net ? { net: t.net } : {}),
          ...(t.unit !== undefined ? { unit: t.unit } : {}),
        };
      });
    });
  }
  const conductors = defaultPoleConductors(def.poles);
  return (['top', 'bottom'] as const).flatMap((side) =>
    conductors.map(
      (conductor): Draft => ({ id: terminalId(side, conductor), name: conductor, conductor, side }),
    ),
  );
}

/**
 * Terminals of a module in drawing order. Combs have none: they act through the panel layout.
 * `widthUnits` is the width of the placed copy, which differs from the definition for resizable modules.
 */
export function terminalsOf(def: ModuleDef, widthUnits: number = def.widthUnits): Terminal[] {
  if (def.kind === 'comb') return [];
  const drafts = draftsOf(def, widthUnits);
  const perSide = { top: 0, bottom: 0 };
  const seen = { top: 0, bottom: 0 };
  drafts.forEach((d) => perSide[d.side]++);
  return drafts.map((d) => {
    const index = seen[d.side]++;
    const unit = d.unit === undefined ? Math.floor((index * widthUnits) / perSide[d.side]) : d.unit < 0 ? widthUnits + d.unit : d.unit;
    return { ...d, unit };
  });
}
