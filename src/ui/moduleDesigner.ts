import { terminalSources, terminalsOf, type Terminal } from '../electrical/terminals';
import type { Conductor, Library, ModuleDef, TerminalDef, TerminalSide } from '../library/types';

export const UNIT_PX = 44;
const MARGIN = 28;
const BODY_HEIGHT = 190;
const PIN_INSET = 18;
const PIN_SPACING_PX = 13;
const PIN_HIT_RADIUS = 10;
const EDGE_TOLERANCE_PX = 14;

export interface DesignerPin {
  /** The entry of `terminals` this pin comes from; null while the terminals are derived from the poles. */
  source: number | null;
  terminal: Terminal;
  x: number;
  y: number;
}

export interface DesignerLayout {
  width: number;
  height: number;
  widthUnits: number;
  body: { x: number; y: number; width: number; height: number };
  pins: DesignerPin[];
}

/** Where a module and its terminals are drawn in the designer, in pixels. */
export function designerLayout(def: ModuleDef, widthUnits: number = def.widthUnits): DesignerLayout {
  const body = { x: MARGIN, y: MARGIN, width: widthUnits * UNIT_PX, height: BODY_HEIGHT };
  const terminals = terminalsOf(def, widthUnits);
  const sources = terminalSources(def, widthUnits);
  const pins = terminals.map((terminal, i): DesignerPin => {
    const sharing = terminals.filter((t) => t.side === terminal.side && t.unit === terminal.unit);
    const offset = (sharing.indexOf(terminal) - (sharing.length - 1) / 2) * PIN_SPACING_PX;
    return {
      source: sources[i] ?? null,
      terminal,
      x: body.x + (terminal.unit + 0.5) * UNIT_PX + offset,
      y: terminal.side === 'top' ? body.y + PIN_INSET : body.y + body.height - PIN_INSET,
    };
  });
  return { width: body.width + 2 * MARGIN, height: body.height + 2 * MARGIN, widthUnits, body, pins };
}

/** The pin under a point, the nearest one when several are within reach. */
export function pinAt(layout: DesignerLayout, x: number, y: number): DesignerPin | undefined {
  let best: DesignerPin | undefined;
  let bestDistance = PIN_HIT_RADIUS;
  for (const pin of layout.pins) {
    const distance = Math.hypot(pin.x - x, pin.y - y);
    if (distance <= bestDistance) {
      best = pin;
      bestDistance = distance;
    }
  }
  return best;
}

/** The unit and side a point on the body stands for, or null outside the body and a little around it. */
export function slotAt(layout: DesignerLayout, x: number, y: number): { unit: number; side: TerminalSide } | null {
  const { body, widthUnits } = layout;
  const inside =
    x >= body.x && x <= body.x + body.width && y >= body.y - EDGE_TOLERANCE_PX && y <= body.y + body.height + EDGE_TOLERANCE_PX;
  if (!inside) return null;
  const unit = Math.min(widthUnits - 1, Math.max(0, Math.floor((x - body.x) / UNIT_PX)));
  return { unit, side: y < body.y + body.height / 2 ? 'top' : 'bottom' };
}

/**
 * How a unit on the drawn module is stored. A fixed module counts from the left. A resizable one
 * counts from the nearer edge, because a position has to exist at the narrowest width: counting
 * from the right keeps a terminal at the right edge whatever the width of a placed copy.
 */
export function storedUnit(def: ModuleDef, unit: number): number {
  const width = def.widthUnits;
  if (!def.resizable) return Math.min(width - 1, Math.max(0, unit));
  const narrowest = def.resizable.minUnits;
  const fromRight = unit - width;
  if (unit < width / 2) return Math.min(unit, narrowest - 1);
  return Math.max(fromRight, -narrowest);
}

/** The entries of `terminals`, or the ones the poles give when the module has none of its own. */
function listedTerminals(def: ModuleDef): TerminalDef[] {
  return def.terminals ?? terminalsOf(def).map((t) => ({ name: t.name, conductor: t.conductor, side: t.side }));
}

type Change = { ok: true; draft: Library; index: number } | { ok: false; message: string };

const replaceTerminals = (draft: Library, moduleId: string, terminals: TerminalDef[]): Library => ({
  ...draft,
  modules: draft.modules.map((m) => (m.id === moduleId ? { ...m, terminals } : m)),
});

const freeName = (taken: readonly string[], count: number): string => {
  let n = count + 1;
  while (taken.includes(`T${n}`)) n++;
  return `T${n}`;
};

/** Adds a terminal at a unit and side; the first one listed turns derived terminals into listed ones. */
export function addTerminalAt(
  draft: Library,
  moduleId: string,
  unit: number,
  side: TerminalSide,
  conductor: Conductor = 'L',
): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def) return { ok: false, message: 'That module does not exist.' };
  if (def.kind === 'comb') return { ok: false, message: 'A comb has no terminals.' };
  const listed = listedTerminals(def);
  const name = freeName(listed.filter((t) => t.side === side).map((t) => t.name), listed.length);
  const terminal: TerminalDef = { name, conductor, side, unit: storedUnit(def, unit) };
  return { ok: true, draft: replaceTerminals(draft, moduleId, [...listed, terminal]), index: listed.length };
}

/** Moves one listed terminal to another unit or side. A group with a count has no position of its own. */
export function moveTerminal(draft: Library, moduleId: string, index: number, unit: number, side: TerminalSide): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  const listed = def && listedTerminals(def);
  const entry = listed?.[index];
  if (!def || !listed || !entry) return { ok: false, message: 'That terminal does not exist.' };
  if ((entry.count ?? 1) > 1) {
    return { ok: false, message: 'A group of terminals has no position of its own: set its count to 1 to place it by hand.' };
  }
  if (listed.some((t, i) => i !== index && t.side === side && t.name === entry.name)) {
    return { ok: false, message: `The ${side} side already has a terminal named ${entry.name}.` };
  }
  const moved: TerminalDef = { ...entry, side, unit: storedUnit(def, unit) };
  return { ok: true, draft: replaceTerminals(draft, moduleId, listed.map((t, i) => (i === index ? moved : t))), index };
}
