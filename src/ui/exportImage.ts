import { SvgContext } from '../view/svgContext';
import { DARK_THEME, withTheme, type Theme } from '../view/theme';
import type { Session } from './session';
import type { View } from './view';

const LONG_SIDE_PX = 2000;

interface Framing {
  width: number;
  height: number;
}

function framingOf(view: View): Framing {
  const bounds = view.fitBounds();
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const pxPerUnit = LONG_SIDE_PX / Math.max(contentW, contentH);
  return { width: Math.max(1, Math.round(contentW * pxPerUnit)), height: Math.max(1, Math.round(contentH * pxPerUnit)) };
}

/** Draws the whole view, framed to its content and without selection, regardless of the on-screen camera. */
function drawFramed(view: View, session: Session, ctx: CanvasRenderingContext2D, { width, height }: Framing): void {
  const { camera } = view;
  const savedCamera = { x: camera.x, y: camera.y, scale: camera.scale };
  const savedSelection = session.selection;
  camera.fit(view.fitBounds(), width, height, 0);
  session.selection = {};
  try {
    view.draw(ctx, width, height, 1);
  } finally {
    Object.assign(camera, savedCamera);
    session.selection = savedSelection;
  }
}

export function renderToPng(view: View, session: Session): Promise<Blob> {
  const framing = framingOf(view);
  const canvas = document.createElement('canvas');
  canvas.width = framing.width;
  canvas.height = framing.height;
  drawFramed(view, session, canvas.getContext('2d')!, framing);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

/** The same drawing as the screen, recorded as vector graphics. */
export function renderToSvg(view: View, session: Session, theme: Theme = DARK_THEME, idPrefix = ''): string {
  const framing = framingOf(view);
  const measuring = document.createElement('canvas').getContext('2d')!;
  const measure = (text: string, font: string) => {
    measuring.font = font;
    return measuring.measureText(text).width;
  };
  const svg = new SvgContext(framing.width, framing.height, measure, idPrefix);
  withTheme(theme, () => drawFramed(view, session, svg as unknown as CanvasRenderingContext2D, framing));
  return svg.toSvg();
}
