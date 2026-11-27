/**
 * Below this size Chrome fits the letters to whole pixels of the nominal size and only then scales the
 * drawing, so on a zoomed canvas the gaps between letters come out uneven ("QS 1", "Room s light").
 */
export const CRISP_BELOW_PX = 16;
/** Text under `CRISP_BELOW_PX` is set this many times larger and scaled back down, where the fitting no longer shows. */
export const CRISP_FACTOR = 10;

const PX = /(\d+(?:\.\d+)?)px/;
/** Contexts already changed; a view that asks for its context every frame must not wrap it again and again. */
const wrapped = new WeakSet<object>();

/**
 * Makes `fillText` and `measureText` of a context set small text large and scale it back, so it is drawn
 * and measured evenly at any zoom. Only these two calls change; the views keep their small sizes.
 */
export function crispText<T extends Pick<CanvasRenderingContext2D, 'font' | 'fillText' | 'measureText' | 'save' | 'restore' | 'translate' | 'scale'>>(ctx: T): T {
  if (wrapped.has(ctx)) return ctx;
  wrapped.add(ctx);
  const fill = ctx.fillText.bind(ctx);
  const measure = ctx.measureText.bind(ctx);
  const enlarged = (): { font: string } | undefined => {
    const match = PX.exec(ctx.font);
    const size = match ? Number(match[1]) : NaN;
    return size > 0 && size < CRISP_BELOW_PX ? { font: ctx.font.replace(match![0], `${size * CRISP_FACTOR}px`) } : undefined;
  };
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    const large = enlarged();
    if (!large) return fill(text, x, y, maxWidth);
    ctx.save();
    ctx.font = large.font;
    ctx.translate(x, y);
    ctx.scale(1 / CRISP_FACTOR, 1 / CRISP_FACTOR);
    fill(text, 0, 0, maxWidth === undefined ? undefined : maxWidth * CRISP_FACTOR);
    ctx.restore();
  };
  ctx.measureText = (text: string) => {
    const large = enlarged();
    if (!large) return measure(text);
    const small = ctx.font;
    ctx.font = large.font;
    const m = measure(text);
    ctx.font = small;
    const k = 1 / CRISP_FACTOR;
    return {
      width: m.width * k,
      actualBoundingBoxLeft: m.actualBoundingBoxLeft * k,
      actualBoundingBoxRight: m.actualBoundingBoxRight * k,
      actualBoundingBoxAscent: m.actualBoundingBoxAscent * k,
      actualBoundingBoxDescent: m.actualBoundingBoxDescent * k,
      fontBoundingBoxAscent: m.fontBoundingBoxAscent * k,
      fontBoundingBoxDescent: m.fontBoundingBoxDescent * k,
      emHeightAscent: m.emHeightAscent * k,
      emHeightDescent: m.emHeightDescent * k,
      alphabeticBaseline: m.alphabeticBaseline * k,
      hangingBaseline: m.hangingBaseline * k,
      ideographicBaseline: m.ideographicBaseline * k,
    } as TextMetrics;
  };
  return ctx;
}
