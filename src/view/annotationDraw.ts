import { CHAR_MM, LINE_MM, PAD_MM, annotationLayout, annotationBox, type Annotation } from '../layout/annotations';
import type { Point } from './Camera';
import { FONT_FAMILY } from './font';

const PLATE = '#fde68a';
const EDGE = '#d97706';
const INK = '#451a03';
const SELECTED = '#f5c518';
const HEAD_LENGTH_MM = 9;
const HEAD_HALF_WIDTH_MM = 4;
const FONT_MM = 10;

/** The point on the plate that the arrow leaves from: the one nearest to what it points at. */
export function arrowStart(note: Annotation): Point | null {
  if (!note.target) return null;
  const box = annotationBox(note);
  return { x: Math.min(box.maxX, Math.max(box.minX, note.target.x)), y: Math.min(box.maxY, Math.max(box.minY, note.target.y)) };
}

/** Draws the notes of a drawing, in millimetres of that drawing: the arrow, then the plate with its text over it. */
export function drawAnnotations(ctx: CanvasRenderingContext2D, notes: readonly Annotation[] | undefined, selectedId: string | null, shown: boolean): void {
  if (!shown || !notes || notes.length === 0) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const note of notes) {
    const box = annotationBox(note);
    const start = arrowStart(note);
    const selected = note.id === selectedId;
    ctx.strokeStyle = selected ? SELECTED : EDGE;
    ctx.fillStyle = selected ? SELECTED : EDGE;
    ctx.lineWidth = selected ? 2.4 : 1.6;
    ctx.setLineDash([]);
    if (start && note.target && (start.x !== note.target.x || start.y !== note.target.y)) {
      const angle = Math.atan2(note.target.y - start.y, note.target.x - start.x);
      const back = { x: note.target.x - Math.cos(angle) * HEAD_LENGTH_MM, y: note.target.y - Math.sin(angle) * HEAD_LENGTH_MM };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(back.x, back.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(note.target.x, note.target.y);
      ctx.lineTo(back.x - Math.sin(angle) * HEAD_HALF_WIDTH_MM, back.y + Math.cos(angle) * HEAD_HALF_WIDTH_MM);
      ctx.lineTo(back.x + Math.sin(angle) * HEAD_HALF_WIDTH_MM, back.y - Math.cos(angle) * HEAD_HALF_WIDTH_MM);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = PLATE;
    ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.fillStyle = INK;
    ctx.font = `${FONT_MM}px ${FONT_FAMILY}`;
    annotationLayout(note.text).lines.forEach((line, i) => ctx.fillText(line, box.minX + PAD_MM, box.minY + PAD_MM / 2 + LINE_MM * (i + 0.5)));
  }
  ctx.restore();
}

export const NOTE_FONT_MM = FONT_MM;
export const NOTE_CHAR_MM = CHAR_MM;
