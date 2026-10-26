import { terminalSources, terminalsOf, type Terminal } from '../electrical/terminals';
import { createPanel } from '../layout/panel';
import { fixedRange, isValidPosition, leftPosition } from '../library/positions';
import type { ModuleRef, Panel, Placement } from '../layout/placement';
import type { Conductor, Library, ModuleDef, TerminalDef, TerminalSide, TripCurve } from '../library/types';

export const UNIT_PX = 44;
const MARGIN = 28;
const BODY_HEIGHT = 190;
const PIN_INSET = 18;
const PIN_SPACING_PX = 13;
const PIN_HIT_RADIUS = 10;
const MIN_PIN_RADIUS = 3;
const MAX_PIN_RADIUS = 6;
const PIN_GAP_SHARE = 0.42;
const CROWDED_GAP_PX = 22;
const MIN_PINS_TO_ABBREVIATE = 3;
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
  /** Radius of a pin: smaller when terminals stand close together. */
  pinRadius: number;
  /** True when neighbouring pins are so close that their names would overlap on one line. */
  crowded: boolean;
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
  const gaps = (['top', 'bottom'] as const).flatMap((side) => {
    const xs = pins.filter((p) => p.terminal.side === side).map((p) => p.x).sort((a, b) => a - b);
    return xs.slice(1).map((x, i) => x - xs[i]!);
  });
  const tightest = Math.min(Infinity, ...gaps);
  const pinRadius = Math.max(MIN_PIN_RADIUS, Math.min(MAX_PIN_RADIUS, tightest * PIN_GAP_SHARE));
  return { width: body.width + 2 * MARGIN, height: body.height + 2 * MARGIN, widthUnits, pinRadius, crowded: tightest < CROWDED_GAP_PX, body, pins };
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

/** Positions are offered in steps of a quarter unit, 4.4 mm, which keeps terminals apart and lines them up. */
export const POSITION_STEP = 0.25;

/**
 * The position along the module and the side a point on the body stands for, snapped to a quarter
 * unit and kept inside the module; null outside the body and a little around it.
 */
export function slotAt(layout: DesignerLayout, x: number, y: number): { unit: number; side: TerminalSide } | null {
  const { body, widthUnits } = layout;
  const inside =
    x >= body.x && x <= body.x + body.width && y >= body.y - EDGE_TOLERANCE_PX && y <= body.y + body.height + EDGE_TOLERANCE_PX;
  if (!inside) return null;
  const { min, max } = fixedRange(widthUnits);
  const snapped = Math.round((((x - body.x) / UNIT_PX) - 0.5) / POSITION_STEP) * POSITION_STEP;
  const unit = Math.min(Math.floor(max / POSITION_STEP) * POSITION_STEP, Math.max(Math.ceil(min / POSITION_STEP) * POSITION_STEP, snapped));
  return { unit, side: y < body.y + body.height / 2 ? 'top' : 'bottom' };
}

/**
 * How a position on the drawn module is stored. A fixed module counts from the left. A resizable one
 * counts from the nearer edge, because a position has to exist at the narrowest width: counting from
 * the right keeps a terminal at the right edge whatever the width of a placed copy. A position that
 * does not exist at the narrowest width is moved to the nearest unit centre that does.
 */
export function storedUnit(def: ModuleDef, unit: number, width: number = def.widthUnits): number {
  if (!def.resizable) return isValidPosition(unit, undefined, width) ? unit : Math.min(width - 1, Math.max(0, Math.round(unit)));
  const narrowest = def.resizable.minUnits;
  const candidate = unit < width / 2 ? unit : unit - width;
  if (isValidPosition(candidate, narrowest, width)) return candidate;
  return candidate >= 0 ? Math.min(narrowest - 1, Math.max(0, Math.round(candidate))) : Math.max(-narrowest, Math.min(-1, Math.round(candidate)));
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
  const valid = (unit: number) => isValidPosition(unit, minUnits, width);
  if (def.terminals.every((t) => t.unit === undefined || valid(t.unit))) return draft;
  const terminals = def.terminals.map((t) => {
    if (t.unit === undefined || valid(t.unit)) return t;
    return { ...t, unit: storedUnit(def, leftPosition(t.unit, width, true), width) };
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

/** The listed terminals of a module with every conductor replaced; the poles' terminals are listed first. */
function withConductor(def: ModuleDef, conductor: Conductor): ModuleDef {
  if (def.kind === 'comb') return def;
  return { ...def, terminals: listedTerminals(def).map((t) => ({ ...t, conductor })) };
}

/**
 * Makes a copy of a module for every rating, every curve and every conductor given, and for every
 * combination when several are given, so that a series is designed once. The copies follow the
 * original and carry what tells them apart in id and name. A copy for a conductor puts that
 * conductor on all its terminals, as the blocks of a distribution block come in a colour per conductor.
 */
export function makeVariants(
  draft: Library,
  moduleId: string,
  ratings: readonly number[],
  curves: readonly TripCurve[] = [],
  conductors: readonly Conductor[] = [],
): VariantResult {
  const index = draft.modules.findIndex((m) => m.id === moduleId);
  const base = draft.modules[index];
  if (!base) return { ok: false, message: 'That module does not exist.' };
  const distinct = [...new Set(ratings)];
  if (distinct.some((r) => !(r > 0))) return { ok: false, message: 'A rating must be above 0.' };
  if (distinct.length === 0 && curves.length === 0 && conductors.length === 0) {
    return { ok: false, message: 'Give at least one rating, curve or conductor.' };
  }
  const made: ModuleDef[] = [];
  for (const conductor of conductors.length > 0 ? conductors : [undefined]) {
    for (const curve of curves.length > 0 ? curves : [undefined]) {
      for (const rating of distinct.length > 0 ? distinct : [undefined]) {
        const idParts: string[] = [];
        const nameParts: string[] = [];
        if (curve && rating !== undefined) {
          idParts.push(`${curve}${rating}`.toLowerCase());
          nameParts.push(`${curve}${rating}`);
        } else if (curve) {
          idParts.push(curve.toLowerCase());
          nameParts.push(curve);
        } else if (rating !== undefined) {
          idParts.push(`${rating}a`);
          nameParts.push(`${rating} A`);
        }
        if (conductor) {
          idParts.push(conductor.toLowerCase());
          nameParts.push(conductor);
        }
        const recoloured = conductor ? withConductor(structuredClone(base), conductor) : structuredClone(base);
        made.push({
          ...recoloured,
          id: `${base.id}-${idParts.join('-')}`,
          name: `${base.name} ${nameParts.join(' ')}`,
          ...(rating !== undefined ? { ratedCurrentA: rating } : {}),
          ...(curve ? { curve } : {}),
        });
      }
    }
  }
  const taken = new Set(draft.modules.map((m) => m.id));
  const clash = made.find((m) => taken.has(m.id));
  if (clash) return { ok: false, message: `The library already has a module with the id ${clash.id}.` };
  const modules = [...draft.modules];
  modules.splice(index + 1, 0, ...made);
  return { ok: true, draft: { ...draft, modules }, ids: made.map((m) => m.id) };
}

/** Puts one conductor on every terminal of the module. */
export function setAllConductors(draft: Library, moduleId: string, conductor: Conductor): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def) return { ok: false, message: 'That module does not exist.' };
  if (def.kind === 'comb') return { ok: false, message: 'A comb has no terminals.' };
  return { ok: true, draft: replaceTerminals(draft, moduleId, listedTerminals(def).map((t) => ({ ...t, conductor }))), index: 0 };
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ROW = 48;
const POSITION_PRECISION = 1000;

/**
 * Centres of `count` terminals, each in the middle of an equal share of a module `width` units wide.
 * When that would put the outer ones too close to an edge, they are spread evenly between the
 * outermost positions the module allows instead.
 */
export function evenPositions(count: number, width: number): number[] {
  const round = (n: number) => Math.round(n * POSITION_PRECISION) / POSITION_PRECISION;
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

const rowProblem = (spec: RowSpec): string | null => {
  if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > MAX_ROW) return `The count must be a whole number from 1 to ${MAX_ROW}.`;
  if (!NAME_PATTERN.test(spec.prefix)) return 'The name must start with a letter or digit and use letters, digits, ".", "_" or "-".';
  return null;
};

/**
 * Terminals for one side: evenly spread by position on a module of fixed width, and as one group with
 * a count on a resizable one, where the group grows with the module and stays spread over its width.
 */
function rowEntries(def: ModuleDef, spec: RowSpec, width: number, net: string | undefined): TerminalDef[] {
  const joined = net ? { net } : {};
  if (def.resizable) {
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

/** Adds several terminals on one side at once, spread evenly, and joined inside the module if asked. */
export function addRow(draft: Library, moduleId: string, spec: RowSpec, width?: number): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def) return { ok: false, message: 'That module does not exist.' };
  if (def.kind === 'comb') return { ok: false, message: 'A comb has no terminals.' };
  const problem = rowProblem(spec);
  if (problem) return { ok: false, message: problem };
  const listed = listedTerminals(def);
  const added = rowEntries(def, spec, width ?? def.widthUnits, spec.joined ? freeNet(listed) : undefined);
  const taken = new Set(listed.filter((t) => t.side === spec.side).map((t) => t.name));
  const clash = added.find((t) => taken.has(t.name));
  if (clash) return { ok: false, message: `The ${spec.side} side already has a terminal named ${clash.name}.` };
  return { ok: true, draft: replaceTerminals(draft, moduleId, [...listed, ...added]), index: listed.length };
}

/**
 * Spaces the single terminals of one side evenly again, in the order they stand in. A resizable
 * module keeps its terminals at the edges or in groups, so there is nothing to space.
 */
export function spreadSide(draft: Library, moduleId: string, side: TerminalSide, width?: number): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def) return { ok: false, message: 'That module does not exist.' };
  if (def.resizable) return { ok: false, message: 'A module whose width can change keeps its terminals at the edges; use a group with a count to spread them.' };
  const listed = listedTerminals(def);
  const positions = (t: TerminalDef, i: number) => (t.unit === undefined ? Math.floor((i * def.widthUnits) / Math.max(1, listed.filter((x) => x.side === side).length)) : t.unit);
  const singles = listed
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.side === side && (t.count ?? 1) === 1)
    .sort((a, b) => positions(a.t, a.i) - positions(b.t, b.i) || a.i - b.i);
  if (singles.length === 0) return { ok: false, message: `The ${side} side has no single terminals to space.` };
  const spaced = evenPositions(singles.length, width ?? def.widthUnits);
  const moved = new Map(singles.map(({ i }, order) => [i, spaced[order]!]));
  return { ok: true, draft: replaceTerminals(draft, moduleId, listed.map((t, i) => (moved.has(i) ? { ...t, unit: moved.get(i)! } : t))), index: 0 };
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

/** Replaces the terminals of a module with a block: `top` on the top side and `bottom` on the bottom, evenly spread. */
export function makeBlock(draft: Library, moduleId: string, spec: BlockSpec, width?: number): Change {
  const def = draft.modules.find((m) => m.id === moduleId);
  if (!def) return { ok: false, message: 'That module does not exist.' };
  if (def.kind === 'comb') return { ok: false, message: 'A comb has no terminals.' };
  for (const count of [spec.top, spec.bottom]) {
    if (!Number.isInteger(count) || count < 0 || count > MAX_ROW) return { ok: false, message: `A side takes from 0 to ${MAX_ROW} terminals.` };
  }
  if (spec.top + spec.bottom < 2) return { ok: false, message: 'A block needs at least two terminals.' };
  const net = spec.joined ? 'NET1' : undefined;
  const shown = width ?? def.widthUnits;
  const sides: Array<[TerminalSide, number, string]> = [['top', spec.top, 'IN'], ['bottom', spec.bottom, 'OUT']];
  const terminals = sides.flatMap(([side, count, prefix]) =>
    count === 0 ? [] : rowEntries(def, { side, count, conductor: spec.conductor, prefix, joined: spec.joined }, shown, net),
  );
  return { ok: true, draft: replaceTerminals(draft, moduleId, terminals), index: 0 };
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

/**
 * What to write beside each pin. When the pins of a side are crowded and all start with the same
 * letters before their numbers, as OUT1 to OUT8 do (three or more), only the numbers are written; the full names
 * stay in the fields.
 */
export function pinLabels(layout: DesignerLayout): string[] {
  const prefix = (name: string) => /^([A-Za-z]+)\d+$/.exec(name)?.[1];
  return layout.pins.map((pin) => {
    if (!layout.crowded) return pin.terminal.name;
    const sameSide = layout.pins.filter((p) => p.terminal.side === pin.terminal.side).map((p) => prefix(p.terminal.name));
    const common = sameSide[0];
    const shared = common !== undefined && sameSide.length >= MIN_PINS_TO_ABBREVIATE && sameSide.every((p) => p === common);
    return shared ? pin.terminal.name.slice(common.length) : pin.terminal.name;
  });
}

/** The point a net is drawn to from each of its pins: the middle of them. */
export function netCentre(pins: readonly DesignerPin[]): { x: number; y: number } {
  return { x: pins.reduce((sum, p) => sum + p.x, 0) / pins.length, y: pins.reduce((sum, p) => sum + p.y, 0) / pins.length };
}
