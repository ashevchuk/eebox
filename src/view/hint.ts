import { FONT_FAMILY } from './font';
import { theme } from './theme';

const SIZE_PX = 15;
const LINE_GAP = 1.5;
const PADDING_PX = 14;

/** Lines of help in the middle of a view, in screen pixels and not in the drawing, so they never scale or reach an export. */
export function drawHint(ctx: CanvasRenderingContext2D, lines: readonly string[], width: number, height: number, dpr: number): void {
  if (lines.length === 0) return;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const lineHeight = SIZE_PX * LINE_GAP;
  const widest = Math.max(
    ...lines.map((line, i) => {
      ctx.font = `${i === 0 ? 'bold ' : ''}${SIZE_PX}px ${FONT_FAMILY}`;
      return ctx.measureText(line).width;
    }),
  );
  // The words are in the middle of the view, where a rail may run; a plate behind them keeps them readable.
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = theme().background;
  ctx.fillRect(width / 2 - widest / 2 - PADDING_PX, height / 2 - (lines.length * lineHeight) / 2 - PADDING_PX / 2, widest + 2 * PADDING_PX, lines.length * lineHeight + PADDING_PX);
  ctx.fillStyle = theme().label;
  ctx.globalAlpha = 0.8;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${SIZE_PX}px ${FONT_FAMILY}`;
    ctx.fillText(line, width / 2, height / 2 + (i - (lines.length - 1) / 2) * lineHeight);
  });
  ctx.restore();
}
