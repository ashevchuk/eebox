import { DEFAULT_STROKE_WIDTH_MM, placeArt, type ArtShape, type TextAlign } from '../library/art';
import { FONT_FAMILY } from './font';
import type { Rect } from './geometry';

const CANVAS_ALIGN: Record<TextAlign, CanvasTextAlign> = { left: 'left', centre: 'center', right: 'right' };

/** Draws the art of a module on its face, clipped to the face, for a copy `widthUnits` wide of a module made for `baseUnits`. */
export function drawArt(ctx: CanvasRenderingContext2D, art: readonly ArtShape[], face: Rect, baseUnits: number, widthUnits: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(face.x, face.y, face.width, face.height);
  ctx.clip();
  ctx.translate(face.x, face.y);
  for (const shape of placeArt(art, baseUnits, widthUnits)) {
    ctx.lineWidth = shape.strokeWidth ?? DEFAULT_STROKE_WIDTH_MM;
    ctx.lineJoin = 'round';
    if (shape.fill !== undefined) ctx.fillStyle = shape.fill;
    if (shape.stroke !== undefined) ctx.strokeStyle = shape.stroke;
    switch (shape.kind) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(shape.x1, shape.y1);
        ctx.lineTo(shape.x2, shape.y2);
        ctx.stroke();
        break;
      case 'rect':
        ctx.beginPath();
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
        paint(ctx, shape);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
        paint(ctx, shape);
        break;
      case 'polyline':
        ctx.beginPath();
        shape.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        if (shape.closed) ctx.closePath();
        paint(ctx, shape);
        break;
      case 'text':
        ctx.font = `${shape.bold ? 'bold ' : ''}${shape.size}px ${FONT_FAMILY}`;
        ctx.textAlign = CANVAS_ALIGN[shape.align ?? 'left'];
        ctx.textBaseline = 'middle';
        ctx.fillText(shape.text, shape.x, shape.y);
        break;
    }
  }
  ctx.restore();
}

function paint(ctx: CanvasRenderingContext2D, shape: ArtShape): void {
  if (shape.fill !== undefined) ctx.fill();
  if (shape.stroke !== undefined) ctx.stroke();
}
