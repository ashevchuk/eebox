import { describe, expect, it } from 'vitest';
import {
  MAX_ANNOTATIONS,
  MAX_NOTE_CHARS,
  addAnnotation,
  annotationBounds,
  annotationBox,
  annotationLayout,
  annotationsCheck,
  hitAnnotation,
  moveAnnotation,
  removeAnnotation,
  setAnnotationTarget,
  setAnnotationText,
  type Annotation,
} from '../src/layout/annotations';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const note = (id: string, x: number, y: number, text = 'Check this', target?: { x: number; y: number }): Annotation => ({ id, x, y, text, ...(target ? { target } : {}) });

describe('the layout of a note', () => {
  it('keeps a short note on one line and breaks a long one between words', () => {
    expect(annotationLayout('Replace the breaker').lines).toEqual(['Replace the breaker']);
    const long = annotationLayout('Replace the C16 breaker of the kitchen sockets by a B16 one');
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.lines.every((l) => l.length <= 28)).toBe(true);
    expect(long.lines.join(' ')).toBe('Replace the C16 breaker of the kitchen sockets by a B16 one');
  });

  it('breaks a word that is longer than a line, and loses no letter', () => {
    const lines = annotationLayout('x'.repeat(70)).lines;
    expect(lines.map((l) => l.length)).toEqual([28, 28, 14]);
  });

  it('is wider for more letters and taller for more lines', () => {
    expect(annotationLayout('abcdef').width).toBeGreaterThan(annotationLayout('ab').width);
    expect(annotationLayout('a '.repeat(40)).height).toBeGreaterThan(annotationLayout('a').height);
  });

  it('has a box at the place of the note', () => {
    const box = annotationBox(note('a1', 100, 50));
    expect([box.minX, box.minY]).toEqual([100, 50]);
    expect(box.maxX).toBeGreaterThan(100);
  });
});

describe('adding and changing notes', () => {
  it('adds a note with the next free id, with or without an arrow', () => {
    const first = addAnnotation(undefined, { at: { x: 10, y: 20 }, text: '  Hello ' });
    expect(first.ok && first.id).toBe('a1');
    const second = addAnnotation(first.ok ? first.list : [], { at: { x: 0, y: 0 }, text: 'Two', target: { x: 5, y: 5 } });
    expect(second.ok && second.list.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(second.ok && second.list[0]!.text).toBe('Hello');
    expect(second.ok && second.list[1]!.target).toEqual({ x: 5, y: 5 });
  });

  it('does not reuse the id of a note that was taken away', () => {
    const list = [note('a1', 0, 0), note('a5', 0, 0)];
    expect(addAnnotation(removeAnnotation(list, 'a1'), { at: { x: 0, y: 0 }, text: 'x' })).toMatchObject({ ok: true, id: 'a6' });
  });

  it('refuses empty text, text with a line break, a long text, too many notes and a point out of range', () => {
    expect(addAnnotation([], { at: { x: 0, y: 0 }, text: '   ' })).toEqual({ ok: false, error: 'bad-text' });
    expect(addAnnotation([], { at: { x: 0, y: 0 }, text: 'a\nb' })).toEqual({ ok: false, error: 'bad-text' });
    expect(addAnnotation([], { at: { x: 0, y: 0 }, text: 'x'.repeat(MAX_NOTE_CHARS + 1) })).toEqual({ ok: false, error: 'bad-text' });
    expect(addAnnotation(Array.from({ length: MAX_ANNOTATIONS }, (_, i) => note(`a${i + 1}`, 0, 0)), { at: { x: 0, y: 0 }, text: 'x' })).toEqual({ ok: false, error: 'too-many' });
    expect(addAnnotation([], { at: { x: 1e9, y: 0 }, text: 'x' })).toEqual({ ok: false, error: 'out-of-range' });
    expect(addAnnotation([], { at: { x: NaN, y: 0 }, text: 'x' })).toEqual({ ok: false, error: 'out-of-range' });
  });

  it('moves the note with its arrow, and the head of the arrow alone', () => {
    const list = [note('a1', 10, 10, 'x', { x: 50, y: 50 })];
    const moved = moveAnnotation(list, 'a1', 5, -5);
    expect(moved.ok && moved.list[0]).toMatchObject({ x: 15, y: 5, target: { x: 55, y: 45 } });
    const head = setAnnotationTarget(list, 'a1', { x: 0, y: 0 });
    expect(head.ok && head.list[0]).toMatchObject({ x: 10, y: 10, target: { x: 0, y: 0 } });
    const none = setAnnotationTarget(list, 'a1', undefined);
    expect(none.ok && 'target' in none.list[0]!).toBe(false);
  });

  it('changes the text and says when there is no such note', () => {
    const list = [note('a1', 0, 0)];
    expect(setAnnotationText(list, 'a1', 'New')).toMatchObject({ ok: true });
    expect(setAnnotationText(list, 'a1', '')).toEqual({ ok: false, error: 'bad-text' });
    expect(setAnnotationText(list, 'zz', 'New')).toEqual({ ok: false, error: 'unknown-note' });
    expect(moveAnnotation(list, 'zz', 1, 1)).toEqual({ ok: false, error: 'unknown-note' });
  });
});

describe('finding a note under the pointer', () => {
  const list = [note('a1', 0, 0, 'First'), note('a2', 20, 0, 'Second', { x: 300, y: 300 })];

  it('takes the head of an arrow before a note, and the topmost of notes that overlap', () => {
    expect(hitAnnotation(list, { x: 302, y: 299 }, 6)).toEqual({ id: 'a2', part: 'head' });
    expect(hitAnnotation(list, { x: 25, y: 5 }, 6)).toEqual({ id: 'a2', part: 'body' });
    expect(hitAnnotation(list, { x: 5, y: 5 }, 6)).toEqual({ id: 'a1', part: 'body' });
  });

  it('finds nothing on empty space', () => {
    expect(hitAnnotation(list, { x: 1000, y: 1000 }, 6)).toBeNull();
    expect(hitAnnotation([], { x: 0, y: 0 }, 6)).toBeNull();
  });

  it('knows the part of the drawing the notes take, arrow heads included', () => {
    expect(annotationBounds(undefined)).toBeNull();
    const bounds = annotationBounds(list)!;
    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBeGreaterThanOrEqual(300);
    expect(bounds.maxY).toBeGreaterThanOrEqual(300);
  });
});

describe('notes in a project file', () => {
  const file = (panelNotes?: unknown, schematicNotes?: unknown) =>
    JSON.stringify(
      buildProjectFile(
        {
          panel: { ...panelOf([place('p1', 'breaker16', 0, 0)]), ...(panelNotes ? { annotations: panelNotes as Annotation[] } : {}) },
          schematic: { ...emptySchematic(), ...(schematicNotes ? { annotations: schematicNotes as Annotation[] } : {}) },
        },
        resolve,
      ),
    );

  it('are written for the panel and for the schematic and read back', () => {
    const parsed = parseProjectJson(file([note('a1', 1, 2, 'On the panel')], [note('a1', 3, 4, 'On the schematic', { x: 9, y: 9 })]));
    expect(parsed.ok && parsed.file.project.panel.annotations?.[0]?.text).toBe('On the panel');
    expect(parsed.ok && parsed.file.project.schematic.annotations?.[0]?.target).toEqual({ x: 9, y: 9 });
  });

  it('are not required', () => {
    const parsed = parseProjectJson(file());
    expect(parsed.ok && parsed.file.project.panel.annotations).toBeUndefined();
  });

  it('are refused when they are not a list of good notes, and the message says which', () => {
    expect(annotationsCheck('x')).toBe('must be a list');
    expect(annotationsCheck([note('a1', 0, 0), note('a1', 1, 1)])).toContain('no other note has');
    expect(annotationsCheck([{ id: 'a1', x: 0, y: 0, text: 'ok', colour: 'red' }])).toContain('unknown field');
    expect(annotationsCheck([{ id: 'a1', x: 0, y: 0, text: '' }])).toContain('text');
    expect(annotationsCheck([{ id: 'a1', x: 0, y: 'z', text: 'ok' }])).toContain('x and y');
    expect(annotationsCheck([{ id: 'a1', x: 0, y: 0, text: 'ok', target: { x: 1 } }])).toContain('target');
    expect(annotationsCheck([{ id: 'a1', x: 0, y: 0, text: 'ok', target: { x: 1, y: 2, z: 3 } }])).toContain('target');
    expect(annotationsCheck([{ id: 'a1', x: 0, y: 0, text: 'ok', target: null }])).toContain('target');
    const parsed = parseProjectJson(file([{ id: 'a1', x: 0, y: 0, text: 'x'.repeat(300) }]));
    expect(parsed.ok).toBe(false);
  });
});
