import { terminalSources, terminalsOf, type Terminal } from '../electrical/terminals';
import { createPanel } from '../layout/panel';
import type { ModuleRef, Panel, Placement } from '../layout/placement';
import type { Conductor, Library, ModuleDef, TerminalDef, TerminalSide, TripCurve } from '../library/types';

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
export function storedUnit(def: ModuleDef, unit: number, width: number = def.widthUnits): number {
  if (!def.resizable) return Math.min(width - 1, Math.max(0, unit));
  const narrowest = def.resizable.minUnits;
  if (unit < width / 2) return Math.min(unit, narrowest - 1);
  return Math.max(unit - width, -narrowest);
}

/**
 * After a module is made resizable, or its range changes, positions that would not exist at the
 * narrowest width are moved to the nearer edge, counted from the right when that is the right one.
 * A position that is valid is left exactly as it is.
 */
export function repairPositions(draft: Library, moduleId: string): Library {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def?.terminals || !def.resizable) return draft;
  const { minUnits } = def.resizable;
  const width = def.widthUnits;
  const valid = (unit: number) => unit < minUnits && unit >= -minUnits;
  if (def.terminals.every((t) => t.unit === undefined || valid(t.unit))) return draft;
  const terminals = def.terminals.map((t) => {
    if (t.unit === undefined || valid(t.unit)) return t;
    const fromLeft = t.unit < 0 ? width + t.unit : t.unit;
    return { ...t, unit: storedUnit(def, fromLeft, width) };
  });
  return replaceTerminals(draft, moduleId, terminals);
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
  width?: number,
): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def) return { ok: false, message: 'That module does not exist.' };
  if (def.kind === 'comb') return { ok: false, message: 'A comb has no terminals.' };
  const listed = listedTerminals(def);
  const name = freeName(listed.filter((t) => t.side === side).map((t) => t.name), listed.length);
  const terminal: TerminalDef = { name, conductor, side, unit: storedUnit(def, unit, width) };
  return { ok: true, draft: replaceTerminals(draft, moduleId, [...listed, terminal]), index: listed.length };
}

/**
 * Moves one listed terminal to another unit or side. A group with a count is spread over the width,
 * so it can change side but has no position to move to.
 */
export function moveTerminal(
  draft: Library,
  moduleId: string,
  index: number,
  unit: number,
  side: TerminalSide,
  width?: number,
): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  const listed = def && listedTerminals(def);
  const entry = listed?.[index];
  if (!def || !listed || !entry) return { ok: false, message: 'That terminal does not exist.' };
  if (listed.some((t, i) => i !== index && t.side === side && t.name === entry.name)) {
    return { ok: false, message: `The ${side} side already has a terminal named ${entry.name}.` };
  }
  const isGroup = (entry.count ?? 1) > 1;
  const moved: TerminalDef = isGroup ? { ...entry, side } : { ...entry, side, unit: storedUnit(def, unit, width) };
  return { ok: true, draft: replaceTerminals(draft, moduleId, listed.map((t, i) => (i === index ? moved : t))), index };
}

/** The kinds of terminal a person can add in one click; a kind is several terminals with the right names. */
export interface TerminalPreset {
  id: string;
  label: string;
  /** The terminals to add, given the names already used on that side. */
  build(taken: ReadonlySet<string>, side: TerminalSide): Array<{ name: string; conductor: Conductor; count?: number }>;
}

const MAX_NUMBERED = 9;

/** The first set of names, out of those a generator offers, that is free on the side. */
function firstFree(candidates: Iterable<string[]>, taken: ReadonlySet<string>): string[] | undefined {
  for (const names of candidates) if (names.every((n) => !taken.has(n))) return names;
  return undefined;
}

function numbered(make: (tens: number) => string[]): Iterable<string[]> {
  return Array.from({ length: MAX_NUMBERED }, (_, i) => make(i + 1));
}

/** Names with a number appended until none of them is taken, for kinds that have no standard numbering. */
function suffixed(names: string[], taken: ReadonlySet<string>): string[] {
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? names : names.map((name) => `${name}${n}`);
    if (candidate.every((name) => !taken.has(name))) return candidate;
  }
}

const preset = (
  id: string,
  label: string,
  conductors: Conductor[],
  names: (taken: ReadonlySet<string>) => string[],
): TerminalPreset => ({
  id,
  label,
  build: (taken) => {
    const chosen = names(taken);
    return chosen.map((name, i) => ({ name, conductor: conductors[i]! }));
  },
});

export const TERMINAL_PRESETS: readonly TerminalPreset[] = [
  preset('coil', 'Coil (A1, A2)', ['L', 'N'], (taken) => firstFree(['A', 'B', 'C', 'D'].map((l) => [`${l}1`, `${l}2`]), taken) ?? suffixed(['A1', 'A2'], taken)),
  preset('no', 'Normally open contact (13, 14)', ['C', 'C'], (taken) => firstFree(numbered((x) => [`${x}3`, `${x}4`]), taken) ?? suffixed(['13', '14'], taken)),
  preset('nc', 'Normally closed contact (11, 12)', ['C', 'C'], (taken) => firstFree(numbered((x) => [`${x}1`, `${x}2`]), taken) ?? suffixed(['11', '12'], taken)),
  preset('changeover', 'Change-over contact (11, 12, 14)', ['C', 'C', 'C'], (taken) => firstFree(numbered((x) => [`${x}1`, `${x}2`, `${x}4`]), taken) ?? suffixed(['11', '12', '14'], taken)),
  preset('supply1', 'Supply L, N', ['L', 'N'], (taken) => suffixed(['L', 'N'], taken)),
  preset('supply3', 'Supply L1, L2, L3, N', ['L1', 'L2', 'L3', 'N'], (taken) => suffixed(['L1', 'L2', 'L3', 'N'], taken)),
  preset('earth', 'Earth (PE)', ['PE'], (taken) => suffixed(['PE'], taken)),
  preset('dc', 'DC supply (24V, 0V)', ['DCP', 'DCN'], (taken) => suffixed(['24V', '0V'], taken)),
  preset('sensor', 'Sensor input (S1, S2)', ['C', 'C'], (taken) => suffixed(['S1', 'S2'], taken)),
  {
    id: 'row',
    label: 'Row of terminals (a count)',
    build: (taken) => [{ name: suffixed(['T'], taken)[0]!, conductor: 'L', count: 2 }],
  },
];

/** Adds all terminals of a kind at a unit and side, named so that they do not clash with the ones there. */
export function addPreset(
  draft: Library,
  moduleId: string,
  presetId: string,
  unit: number,
  side: TerminalSide,
  width?: number,
): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  const kind = TERMINAL_PRESETS.find((p) => p.id === presetId);
  if (!def || !kind) return { ok: false, message: 'That module or kind of terminal does not exist.' };
  if (def.kind === 'comb') return { ok: false, message: 'A comb has no terminals.' };
  const listed = listedTerminals(def);
  const taken = new Set(listed.filter((t) => t.side === side).map((t) => t.name));
  const added = kind.build(taken, side).map(
    (t): TerminalDef => ({
      name: t.name,
      conductor: t.conductor,
      side,
      ...(t.count ? { count: t.count } : { unit: storedUnit(def, unit, width) }),
    }),
  );
  return { ok: true, draft: replaceTerminals(draft, moduleId, [...listed, ...added]), index: listed.length };
}

const freeNet = (listed: readonly TerminalDef[]): string => {
  const used = new Set(listed.flatMap((t) => (t.net ? [t.net] : [])));
  let n = 1;
  while (used.has(`NET${n}`)) n++;
  return `NET${n}`;
};

/** Joins two listed terminals inside the module: they get the same net, and two nets that meet become one. */
export function connectTerminals(draft: Library, moduleId: string, a: number, b: number): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  const listed = def && listedTerminals(def);
  const first = listed?.[a];
  const second = listed?.[b];
  if (!def || !listed || !first || !second) return { ok: false, message: 'That terminal does not exist.' };
  if (a === b) return { ok: false, message: 'Pick a second terminal to join it to.' };
  const net = first.net ?? second.net ?? freeNet(listed);
  const absorbed = second.net;
  const joined = listed.map((t, i) => (i === a || i === b || (absorbed !== undefined && t.net === absorbed) ? { ...t, net } : t));
  return { ok: true, draft: replaceTerminals(draft, moduleId, joined), index: a };
}

/** Takes a terminal out of its net; a net left with one terminal is dropped, as it joins nothing. */
export function detachTerminal(draft: Library, moduleId: string, index: number): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  const listed = def && listedTerminals(def);
  const entry = listed?.[index];
  if (!def || !listed || !entry) return { ok: false, message: 'That terminal does not exist.' };
  if (entry.net === undefined) return { ok: false, message: 'That terminal is not joined to another one.' };
  const net = entry.net;
  const rest = listed.filter((t, i) => i !== index && t.net === net).length;
  const cleared = listed.map((t, i) => {
    if (i !== index && !(rest === 1 && t.net === net)) return t;
    const { net: _dropped, ...without } = t;
    return without;
  });
  return { ok: true, draft: replaceTerminals(draft, moduleId, cleared), index };
}

/** Pins that share a net, for drawing the line between them; nets of one pin are left out. */
export function netGroups(layout: DesignerLayout): Array<{ net: string; pins: DesignerPin[] }> {
  const groups = new Map<string, DesignerPin[]>();
  for (const pin of layout.pins) {
    const net = pin.terminal.net;
    if (net) groups.set(net, [...(groups.get(net) ?? []), pin]);
  }
  return [...groups]
    .filter(([, pins]) => pins.length > 1)
    .map(([net, pins]) => ({ net, pins: [...pins].sort((x, y) => x.x - y.x || x.y - y.y) }));
}

export type VariantResult = { ok: true; draft: Library; ids: string[] } | { ok: false; message: string };

/**
 * Makes one copy of a module for every rating, and for every curve when curves are given, so that a
 * series is designed once. The copies follow the original and carry the rating in id and name.
 */
export function makeVariants(draft: Library, moduleId: string, ratings: readonly number[], curves: readonly TripCurve[] = []): VariantResult {
  const index = draft.modules.findIndex((m) => m.id === moduleId);
  const base = draft.modules[index];
  if (!base) return { ok: false, message: 'That module does not exist.' };
  const distinct = [...new Set(ratings)];
  if (distinct.length === 0 || distinct.some((r) => !(r > 0))) return { ok: false, message: 'Give at least one rating above 0.' };
  const made = (curves.length > 0 ? curves : [undefined]).flatMap((curve) =>
    distinct.map((rating): ModuleDef => {
      const tag = curve ? `${curve}${rating}` : `${rating}A`;
      return {
        ...structuredClone(base),
        id: `${base.id}-${tag.toLowerCase()}`,
        name: `${base.name} ${curve ? tag : `${rating} A`}`,
        ratedCurrentA: rating,
        ...(curve ? { curve } : {}),
      };
    }),
  );
  const taken = new Set(draft.modules.map((m) => m.id));
  const clash = made.find((m) => taken.has(m.id));
  if (clash) return { ok: false, message: `The library already has a module with the id ${clash.id}.` };
  const modules = [...draft.modules];
  modules.splice(index + 1, 0, ...made);
  return { ok: true, draft: { ...draft, modules }, ids: made.map((m) => m.id) };
}

export const PREVIEW_LIBRARY_ID = 'preview';

/** A one-rail panel with the module on it, one unit from the start, to draw it as it looks in a panel. */
export function railPreviewScene(def: ModuleDef, widthUnits: number): { panel: Panel; resolve: (ref: ModuleRef) => ModuleDef | undefined } {
  const placed: Placement = {
    id: 'preview',
    module: { libraryId: PREVIEW_LIBRARY_ID, moduleId: def.id },
    rail: 0,
    slot: 1,
    ...(def.resizable ? { widthUnits } : {}),
  };
  const panel: Panel = { ...createPanel([widthUnits + 2]), placements: [placed] };
  return { panel, resolve: (ref) => (ref.libraryId === PREVIEW_LIBRARY_ID && ref.moduleId === def.id ? def : undefined) };
}
