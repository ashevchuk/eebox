import { deriveMarking, type DerivedMarking } from '../electrical/marking';
import type { Resolve } from '../electrical/context';
import type { Finding } from '../electrical/problems';
import { readingOrder } from '../layout/designations';
import { DEFAULT_STRIP_HEIGHT_MM, MARKING_PALETTE } from '../layout/marking';
import { isOnRail, type Placement } from '../layout/placement';
import { LAYOUT_EPSILON_UNITS } from '../layout/units';
import { MODULE_UNIT_MM } from '../library/types';
import type { Project } from '../project';
import { labelStrips, STRIP_LINE_UNITS } from './labels';

/** The coloured band on top of a cell with the number of the module. */
export const HEAD_MM = 5;
export const TEXT_PADDING_MM = 0.7;
export const MAX_FONT_MM = 3.2;
export const MIN_FONT_MM = 1.8;
const FONT_STEP_MM = 0.1;
export const LINE_HEIGHT = 1.15;
/**
 * The average advance of a letter of the bundled font, in font sizes. The model has no font to measure
 * with, so it errs wide: a line laid out with it fits when printed.
 */
const LETTER_WIDTH = 0.58;
const NEUTRAL_HEAD = '#d0d0d0';

export interface MarkingHead {
  placementId: string;
  offsetUnits: number;
  widthUnits: number;
  number: number;
  colour: string;
  textColour: string;
}

export interface MarkingText {
  placementIds: string[];
  offsetUnits: number;
  widthUnits: number;
  lines: string[];
  fontMm: number;
  /** The text did not fit even at the smallest size and was shortened. */
  cut: boolean;
}

export interface MarkingLine {
  rail: number;
  railLabel?: string;
  heads: MarkingHead[];
  texts: MarkingText[];
}

export interface MarkingLayout {
  heightMm: number;
  lines: MarkingLine[];
}

/** What a module's cell says and which group it belongs to, with what was set by hand winning. */
export interface ResolvedMarking {
  text: string;
  /** Modules of one group share a colour; absent for modules outside any group. */
  groupKey?: string;
  colour?: string;
}

export function resolveMarking(placement: Placement, derived: DerivedMarking | undefined): ResolvedMarking {
  const own = placement.marking;
  const text = own?.text ?? placement.label ?? derived?.loads.join(', ') ?? '';
  const groupKey = own?.group !== undefined ? `group:${own.group}` : derived?.rcd !== undefined ? `rcd:${derived.rcd}` : undefined;
  return { text, ...(groupKey ? { groupKey } : {}), ...(own?.colour ? { colour: own.colour } : {}) };
}

/** Black or white, whichever reads better on the colour (relative luminance, as WCAG defines it). */
export function textColourOn(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.4 ? '#000000' : '#ffffff';
}

const widthOfText = (text: string, fontMm: number) => text.length * LETTER_WIDTH * fontMm;

/** Words to lines of at most `widthMm`; a word wider than that is broken where it must be. */
function wrap(text: string, fontMm: number, widthMm: number): string[] {
  const perLine = Math.max(1, Math.floor(widthMm / (LETTER_WIDTH * fontMm)));
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const joined = line === '' ? word : `${line} ${word}`;
      if (widthOfText(joined, fontMm) <= widthMm) {
        line = joined;
        continue;
      }
      if (line !== '') lines.push(line);
      let rest = word;
      while (widthOfText(rest, fontMm) > widthMm) {
        lines.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      line = rest;
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

/** The largest size at which the text fits the box without breaking a word; else the smallest, shortened. */
export function fitText(text: string, widthMm: number, heightMm: number): { lines: string[]; fontMm: number; cut: boolean } {
  if (text === '') return { lines: [], fontMm: MAX_FONT_MM, cut: false };
  const longestWord = Math.max(...text.split(/\s+/).map((w) => w.length));
  for (let font = MAX_FONT_MM; font >= MIN_FONT_MM - 1e-9; font -= FONT_STEP_MM) {
    const fontMm = Math.round(font * 10) / 10;
    if (longestWord * LETTER_WIDTH * fontMm > widthMm) continue;
    const lines = wrap(text, fontMm, widthMm);
    if (lines.length * fontMm * LINE_HEIGHT <= heightMm) return { lines, fontMm, cut: false };
  }
  const lines = wrap(text, MIN_FONT_MM, widthMm);
  const room = Math.max(1, Math.floor(heightMm / (MIN_FONT_MM * LINE_HEIGHT)));
  const kept = lines.slice(0, room);
  const perLine = Math.max(1, Math.floor(widthMm / (LETTER_WIDTH * MIN_FONT_MM)));
  kept[kept.length - 1] = `${kept[kept.length - 1]!.slice(0, perLine - 1)}…`;
  return { lines: kept, fontMm: MIN_FONT_MM, cut: true };
}

/**
 * The marking strips of the panel: per rail, cut into lines that fit a sheet, a header per module
 * with its number and the colour of its group, and text cells, neighbours of one group with the same
 * text joined into one. Numbers run over the panel in reading order.
 */
export function markingStrips(project: Project, resolve: Resolve, maxUnits: number = STRIP_LINE_UNITS): MarkingLayout {
  const { panel } = project;
  const heightMm = panel.stripHeightMm ?? DEFAULT_STRIP_HEIGHT_MM;
  const derived = deriveMarking(project, resolve);
  const resolved = new Map(panel.placements.map((p) => [p.id, resolveMarking(p, derived.get(p.id))]));

  const numbers = new Map<string, number>();
  const groupColours = new Map<string, string>();
  for (const placement of readingOrder(panel).filter(isOnRail)) {
    numbers.set(placement.id, numbers.size + 1);
    const key = resolved.get(placement.id)!.groupKey;
    if (key && !groupColours.has(key)) groupColours.set(key, MARKING_PALETTE[groupColours.size % MARKING_PALETTE.length]!.hex);
  }

  const textBox = (widthUnits: number) => ({
    widthMm: widthUnits * MODULE_UNIT_MM - 2 * TEXT_PADDING_MM,
    heightMm: heightMm - HEAD_MM - 2 * TEXT_PADDING_MM,
  });

  const lines = labelStrips(panel, resolve, maxUnits).map((strip): MarkingLine => {
    const heads = strip.cells.map((cell): MarkingHead => {
      const mark = resolved.get(cell.placementId)!;
      const colour = mark.colour ?? (mark.groupKey ? groupColours.get(mark.groupKey)! : NEUTRAL_HEAD);
      return { placementId: cell.placementId, offsetUnits: cell.offsetUnits, widthUnits: cell.widthUnits, number: numbers.get(cell.placementId)!, colour, textColour: textColourOn(colour) };
    });
    const groups: Array<{ ids: string[]; offsetUnits: number; widthUnits: number; text: string; key?: string }> = [];
    for (const cell of strip.cells) {
      const mark = resolved.get(cell.placementId)!;
      const last = groups[groups.length - 1];
      const touches = last !== undefined && Math.abs(last.offsetUnits + last.widthUnits - cell.offsetUnits) < LAYOUT_EPSILON_UNITS;
      if (last && touches && mark.text !== '' && last.text === mark.text && last.key === mark.groupKey) {
        last.ids.push(cell.placementId);
        last.widthUnits = cell.offsetUnits + cell.widthUnits - last.offsetUnits;
        continue;
      }
      groups.push({ ids: [cell.placementId], offsetUnits: cell.offsetUnits, widthUnits: cell.widthUnits, text: mark.text, ...(mark.groupKey ? { key: mark.groupKey } : {}) });
    }
    const texts = groups.map((group): MarkingText => {
      const box = textBox(group.widthUnits);
      return { placementIds: group.ids, offsetUnits: group.offsetUnits, widthUnits: group.widthUnits, ...fitText(group.text, box.widthMm, box.heightMm) };
    });
    return { rail: strip.rail, ...(strip.railLabel ? { railLabel: strip.railLabel } : {}), heads, texts };
  });
  return { heightMm, lines };
}

/** A strip text that had to be shortened is advice: the printed label would not say all of it. */
export function findMarkingFindings(project: Project, resolve: Resolve): Finding[] {
  const name = (id: string) => {
    const placement = project.panel.placements.find((p) => p.id === id)!;
    return `${placement.label ?? resolve(placement.module)?.name ?? placement.module.moduleId} [${id}]`;
  };
  return markingStrips(project, resolve)
    .lines.flatMap((line) => line.texts)
    .filter((text) => text.cut)
    .map((text) => ({
      message: `Strip text of ${text.placementIds.map(name).join(', ')} does not fit; shorten it or make the strip taller`,
      severity: 'advice' as const,
      wires: [],
      nodes: [],
      placements: text.placementIds,
    }));
}
