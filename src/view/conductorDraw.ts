import type { Conductor } from '../library/types';
import type { Point } from './Camera';
import { conductorStyle } from './theme';

const OUTLINE_EXTRA = 2;
const STRIPE_DASH = [6, 6];
const DOT_STROKE = '#14161d';

/**
 * Strokes a wire in the colours of its conductor: an outline first when the colour would be lost on
 * the ground, then the colour, and over it the stripe of a striped conductor as alternating dashes.
 */
export function strokeConductor(ctx: CanvasRenderingContext2D, path: Point[], conductor: Conductor, width: number, dash: number[] = []): void {
  const style = conductorStyle(conductor);
  const trace = () => {
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  };
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash);
  if (style.outline) {
    ctx.strokeStyle = style.outline;
    ctx.lineWidth = width + OUTLINE_EXTRA;
    trace();
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = width;
  trace();
  if (style.stripe && dash.length === 0) {
    ctx.setLineDash(STRIPE_DASH);
    ctx.strokeStyle = style.stripe;
    trace();
  }
  ctx.setLineDash([]);
}

const FERRULE_START = 4;
const FERRULE_LENGTH = 7;
const FERRULE_TIP = 2.5;
const FERRULE_WIDTH = 5;
const FERRULE_MIN_WIRE = 1;
const FERRULE_TIP_COLOUR = '#c9ced6';

function ferruleAt(ctx: CanvasRenderingContext2D, end: Point, towards: Point, conductor: Conductor): void {
  const dx = towards.x - end.x;
  const dy = towards.y - end.y;
  const length = Math.hypot(dx, dy);
  const sleeve = Math.min(FERRULE_LENGTH, length - FERRULE_START - FERRULE_MIN_WIRE);
  if (sleeve <= FERRULE_TIP) return;
  const along = (offset: number): Point => ({ x: end.x + (dx / length) * offset, y: end.y + (dy / length) * offset });
  strokeConductor(ctx, [along(FERRULE_START), along(FERRULE_START + sleeve)], conductor, FERRULE_WIDTH);
  const tipStart = along(FERRULE_START);
  const tipEnd = along(FERRULE_START + FERRULE_TIP);
  ctx.strokeStyle = FERRULE_TIP_COLOUR;
  ctx.lineWidth = FERRULE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(tipStart.x, tipStart.y);
  ctx.lineTo(tipEnd.x, tipEnd.y);
  ctx.stroke();
}

/** A ferrule on each end of a wire: a sleeve in the colour of the conductor with a bare metal tip at the terminal. */
export function drawFerrules(ctx: CanvasRenderingContext2D, path: Point[], conductor: Conductor): void {
  if (path.length < 2) return;
  ferruleAt(ctx, path[0]!, path[1]!, conductor);
  ferruleAt(ctx, path[path.length - 1]!, path[path.length - 2]!, conductor);
}

/** A terminal: a dot in the colour of its conductor, half in the stripe colour for a striped one. */
export function drawConductorDot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, conductor: Conductor, lineWidth: number): void {
  const style = conductorStyle(conductor);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = style.color;
  ctx.fill();
  if (style.stripe) {
    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI / 2, Math.PI / 2);
    ctx.fillStyle = style.stripe;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = style.outline ?? DOT_STROKE;
  ctx.stroke();
}
