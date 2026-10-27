import type { Bounds, Point } from './Camera';

export interface MinimapFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** How a drawing of the given bounds is laid into a map of `width` by `height` pixels, centred, with a margin. */
export function minimapFit(bounds: Bounds, width: number, height: number, margin = 6): MinimapFit {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY);
  return {
    scale,
    offsetX: (width - spanX * scale) / 2 - bounds.minX * scale,
    offsetY: (height - spanY * scale) / 2 - bounds.minY * scale,
  };
}

export const toMinimap = (fit: MinimapFit, world: Point): Point => ({ x: world.x * fit.scale + fit.offsetX, y: world.y * fit.scale + fit.offsetY });
export const fromMinimap = (fit: MinimapFit, pixel: Point): Point => ({ x: (pixel.x - fit.offsetX) / fit.scale, y: (pixel.y - fit.offsetY) / fit.scale });

/** What the camera sees of the world, in world coordinates. */
export function visibleWorld(camera: { x: number; y: number; scale: number }, viewportW: number, viewportH: number): Bounds {
  const halfW = viewportW / camera.scale / 2;
  const halfH = viewportH / camera.scale / 2;
  return { minX: camera.x - halfW, minY: camera.y - halfH, maxX: camera.x + halfW, maxY: camera.y + halfH };
}
