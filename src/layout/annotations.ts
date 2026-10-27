import type { Bounds, Point } from '../view/Camera';

/** A note written on a drawing, with an arrow to the thing it is about when it has a target. */
export interface Annotation {
  id: string;
  /** The top left corner of the note, in millimetres of the drawing. */
  x: number;
  y: number;
  text: string;
  /** What the arrow points at. */
  target?: Point;
}

export const MAX_ANNOTATIONS = 200;
export const MAX_NOTE_CHARS = 200;
export const MAX_COORDINATE_MM = 100_000;

/** The size of a note is worked out from the number of letters, so drawing, hit tests and exports agree without a canvas. */
const WRAP_CHARS = 28;
export const CHAR_MM = 6;
export const LINE_MM = 14;
export const PAD_MM = 6;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
export const isNoteText = (value: unknown): value is string => typeof value === 'string' && value.trim().length >= 1 && value.length <= MAX_NOTE_CHARS && !CONTROL.test(value);

export interface NoteLayout {
  lines: string[];
  width: number;
  height: number;
}

/** The lines a note is set in, broken between words at about 28 letters, and the plate that holds them. */
export function annotationLayout(text: string): NoteLayout {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    for (let rest = word; rest.length > 0; rest = rest.slice(WRAP_CHARS)) {
      const piece = rest.slice(0, WRAP_CHARS);
      if (line === '') line = piece;
      else if (line.length + 1 + piece.length <= WRAP_CHARS) line += ` ${piece}`;
      else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line !== '') lines.push(line);
  return { lines, width: Math.max(...lines.map((l) => l.length), 1) * CHAR_MM + 2 * PAD_MM, height: lines.length * LINE_MM + PAD_MM };
}

export function annotationBox(note: Annotation): Bounds {
  const { width, height } = annotationLayout(note.text);
  return { minX: note.x, minY: note.y, maxX: note.x + width, maxY: note.y + height };
}

export type AnnotationError = 'too-many' | 'bad-text' | 'unknown-note' | 'out-of-range';
export type AnnotationResult = { ok: true; list: Annotation[]; id: string } | { ok: false; error: AnnotationError };

const inRange = (p: Point): boolean => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= MAX_COORDINATE_MM && Math.abs(p.y) <= MAX_COORDINATE_MM;

export function nextAnnotationId(list: readonly Annotation[]): string {
  return `a${Math.max(0, ...list.map((n) => Number(n.id.slice(1)) || 0)) + 1}`;
}

export function addAnnotation(list: readonly Annotation[] | undefined, input: { at: Point; text: string; target?: Point }): AnnotationResult {
  const current = list ?? [];
  if (current.length >= MAX_ANNOTATIONS) return { ok: false, error: 'too-many' };
  if (!isNoteText(input.text)) return { ok: false, error: 'bad-text' };
  if (!inRange(input.at) || (input.target && !inRange(input.target))) return { ok: false, error: 'out-of-range' };
  const id = nextAnnotationId(current);
  const note: Annotation = { id, x: input.at.x, y: input.at.y, text: input.text.trim(), ...(input.target ? { target: input.target } : {}) };
  return { ok: true, list: [...current, note], id };
}

const change = (list: readonly Annotation[], id: string, edit: (note: Annotation) => Annotation | AnnotationError): AnnotationResult => {
  const note = list.find((n) => n.id === id);
  if (!note) return { ok: false, error: 'unknown-note' };
  const next = edit(note);
  if (typeof next === 'string') return { ok: false, error: next };
  return { ok: true, list: list.map((n) => (n.id === id ? next : n)), id };
};

/** The note and its arrow move together. */
export function moveAnnotation(list: readonly Annotation[], id: string, dx: number, dy: number): AnnotationResult {
  return change(list, id, (n) => {
    const moved: Annotation = { ...n, x: n.x + dx, y: n.y + dy, ...(n.target ? { target: { x: n.target.x + dx, y: n.target.y + dy } } : {}) };
    return inRange(moved) && (!moved.target || inRange(moved.target)) ? moved : 'out-of-range';
  });
}

/** The head of the arrow moves; the note stays. Without a point the arrow is taken away. */
export function setAnnotationTarget(list: readonly Annotation[], id: string, target: Point | undefined): AnnotationResult {
  return change(list, id, (n) => {
    if (target && !inRange(target)) return 'out-of-range';
    const { target: _old, ...rest } = n;
    return target ? { ...rest, target } : rest;
  });
}

export function setAnnotationText(list: readonly Annotation[], id: string, text: string): AnnotationResult {
  if (!isNoteText(text)) return { ok: false, error: 'bad-text' };
  return change(list, id, (n) => ({ ...n, text: text.trim() }));
}

export const removeAnnotation = (list: readonly Annotation[], id: string): Annotation[] => list.filter((n) => n.id !== id);

export type AnnotationHit = { id: string; part: 'head' | 'body' };

/** What is under a point: the head of an arrow first, as it is small, then the plate of the topmost note. */
export function hitAnnotation(list: readonly Annotation[], at: Point, toleranceMm: number): AnnotationHit | null {
  for (const note of [...list].reverse()) {
    if (note.target && Math.hypot(at.x - note.target.x, at.y - note.target.y) <= toleranceMm) return { id: note.id, part: 'head' };
  }
  for (const note of [...list].reverse()) {
    const box = annotationBox(note);
    if (at.x >= box.minX && at.x <= box.maxX && at.y >= box.minY && at.y <= box.maxY) return { id: note.id, part: 'body' };
  }
  return null;
}

/** The part of the drawing the notes take up, to be added to the bounds of the drawing. */
export function annotationBounds(list: readonly Annotation[] | undefined): Bounds | null {
  if (!list || list.length === 0) return null;
  const boxes = list.flatMap((n) => [annotationBox(n), ...(n.target ? [{ minX: n.target.x, minY: n.target.y, maxX: n.target.x, maxY: n.target.y }] : [])]);
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

/** Why a stored list of notes is not one, or null. */
export function annotationsCheck(value: unknown): string | null {
  if (!Array.isArray(value)) return 'must be a list';
  if (value.length > MAX_ANNOTATIONS) return `at most ${MAX_ANNOTATIONS} notes`;
  const ids = new Set<string>();
  for (const [i, item] of value.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return `[${i}]: must be an object`;
    const note = item as Record<string, unknown>;
    for (const key of Object.keys(note)) if (!['id', 'x', 'y', 'text', 'target'].includes(key)) return `[${i}].${key}: unknown field`;
    if (typeof note.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(note.id) || ids.has(note.id)) return `[${i}].id: must be a name that no other note has`;
    ids.add(note.id);
    if (typeof note.x !== 'number' || typeof note.y !== 'number' || !inRange({ x: note.x, y: note.y })) return `[${i}]: x and y must be numbers within ${MAX_COORDINATE_MM} mm`;
    if (!isNoteText(note.text)) return `[${i}].text: must be 1 to ${MAX_NOTE_CHARS} characters on one line`;
    if (note.target !== undefined) {
      const target = note.target as Record<string, unknown> | null;
      const bad = typeof target !== 'object' || target === null || Array.isArray(target) || Object.keys(target).some((k) => k !== 'x' && k !== 'y') || typeof target.x !== 'number' || typeof target.y !== 'number' || !inRange({ x: target.x, y: target.y });
      if (bad) return `[${i}].target: must be x and y within ${MAX_COORDINATE_MM} mm`;
    }
  }
  return null;
}

/** The panel or the schematic with this list of notes, and without the field when there are none. */
export function withNotes<T extends { annotations?: Annotation[] }>(owner: T, list: readonly Annotation[]): T {
  const { annotations: _old, ...rest } = owner;
  return (list.length === 0 ? rest : { ...rest, annotations: [...list] }) as T;
}

/** The bounds of a drawing, grown to take in its notes. */
export function withNoteBounds(bounds: Bounds, notes: readonly Annotation[] | undefined): Bounds {
  const extra = annotationBounds(notes);
  return extra
    ? { minX: Math.min(bounds.minX, extra.minX), minY: Math.min(bounds.minY, extra.minY), maxX: Math.max(bounds.maxX, extra.maxX), maxY: Math.max(bounds.maxY, extra.maxY) }
    : bounds;
}
