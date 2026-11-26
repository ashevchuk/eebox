import { isStoredLabel, normalizeLabel } from './labels';
import type { Panel, PlacementResult } from './placement';

/** What the person set by hand on the marking strip of a module; whatever is absent is worked out from the project. */
export interface Marking {
  /** The description in the cell; lines are separated by a line break. */
  text?: string;
  /** The colour of the header, `#rrggbb`. */
  colour?: string;
  /** Modules with the same group share a colour and, side by side with the same text, one cell. */
  group?: string;
}

export const MARKING_KEYS = ['text', 'colour', 'group'] as const;
export type MarkingKey = (typeof MARKING_KEYS)[number];

export const MAX_MARKING_TEXT_LENGTH = 80;
export const MAX_MARKING_TEXT_LINES = 4;

/** The strip goes in the window of the enclosure under the modules; windows of 15 to 25 mm are usual. */
export const DEFAULT_STRIP_HEIGHT_MM = 25;
export const MIN_STRIP_HEIGHT_MM = 12;
export const MAX_STRIP_HEIGHT_MM = 40;

/** Colours of the group headers, chosen to stay apart from each other on paper; text on them is white or black by contrast. */
export const MARKING_PALETTE = [
  { name: 'Purple', hex: '#8e44ad' },
  { name: 'Green', hex: '#27ae60' },
  { name: 'Orange', hex: '#e67e22' },
  { name: 'Blue', hex: '#2e86de' },
  { name: 'Red', hex: '#c0392b' },
  { name: 'Yellow', hex: '#f1c40f' },
  { name: 'Teal', hex: '#16a085' },
  { name: 'Pink', hex: '#e84393' },
] as const;

const COLOUR = /^#[0-9a-f]{6}$/;
const CONTROL_EXCEPT_LINE_BREAK = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export const isMarkingColour = (value: unknown): value is string => typeof value === 'string' && COLOUR.test(value);

export function isMarkingText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MARKING_TEXT_LENGTH || CONTROL_EXCEPT_LINE_BREAK.test(value)) return false;
  const lines = value.split('\n');
  return lines.length <= MAX_MARKING_TEXT_LINES && lines.every((line) => line.length > 0 && line === line.trim());
}

/** Typed text with its lines trimmed and the empty ones dropped; nothing left clears it. */
function normalizeText(raw: string): { ok: true; value: string | undefined } | { ok: false } {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
  if (text === '') return { ok: true, value: undefined };
  return isMarkingText(text) ? { ok: true, value: text } : { ok: false };
}

function normalize(key: MarkingKey, raw: string): { ok: true; value: string | undefined } | { ok: false } {
  if (key === 'text') return normalizeText(raw);
  if (key === 'colour') {
    const colour = raw.trim().toLowerCase();
    if (colour === '') return { ok: true, value: undefined };
    return isMarkingColour(colour) ? { ok: true, value: colour } : { ok: false };
  }
  const label = normalizeLabel(raw);
  return label.ok ? { ok: true, value: label.label } : { ok: false };
}

export function setMarking(panel: Panel, id: string, key: MarkingKey, raw: string): PlacementResult {
  const parsed = normalize(key, raw);
  if (!parsed.ok) return { ok: false, error: { kind: 'invalid-marking' } };
  if (!panel.placements.some((p) => p.id === id)) return { ok: false, error: { kind: 'unknown-placement' } };
  const placements = panel.placements.map((p) => {
    if (p.id !== id) return p;
    const { marking: previous, ...rest } = p;
    const { [key]: _old, ...others } = previous ?? {};
    const marking: Marking = parsed.value === undefined ? others : { ...others, [key]: parsed.value };
    return Object.keys(marking).length === 0 ? rest : { ...rest, marking };
  });
  return { ok: true, panel: { ...panel, placements } };
}

export function setStripHeight(panel: Panel, mm: number): { ok: true; panel: Panel } | { ok: false } {
  if (!Number.isFinite(mm) || mm < MIN_STRIP_HEIGHT_MM || mm > MAX_STRIP_HEIGHT_MM) return { ok: false };
  const { stripHeightMm: _previous, ...rest } = panel;
  return { ok: true, panel: mm === DEFAULT_STRIP_HEIGHT_MM ? rest : { ...rest, stripHeightMm: mm } };
}

/** For the file validator: an object with at least one of the known keys, each valid. */
export function markingCheck(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
  const entries = Object.entries(value);
  if (entries.length === 0) return 'must set at least one of text, colour and group';
  for (const [key, v] of entries) {
    if (key === 'text' && !isMarkingText(v)) return `text must be 1 to ${MAX_MARKING_TEXT_LENGTH} characters in at most ${MAX_MARKING_TEXT_LINES} trimmed lines`;
    if (key === 'colour' && !isMarkingColour(v)) return 'colour must be #rrggbb in lower case';
    if (key === 'group' && !isStoredLabel(v)) return 'group must be a label of 1 to 60 characters';
    if (!(MARKING_KEYS as readonly string[]).includes(key)) return `has an unknown field "${key}"`;
  }
  return null;
}
