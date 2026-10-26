import type { Session } from './session';
import type { View } from './view';

const LONG_SIDE_PX = 2000;

/** Draws the whole view, framed to its content and without selection, regardless of the on-screen camera. */
export function renderToPng(view: View, session: Session): Promise<Blob> {
  const bounds = view.fitBounds();
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const pxPerUnit = LONG_SIDE_PX / Math.max(contentW, contentH);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(contentW * pxPerUnit));
  canvas.height = Math.max(1, Math.round(contentH * pxPerUnit));

  const { camera } = view;
  const savedCamera = { x: camera.x, y: camera.y, scale: camera.scale };
  const savedSelection = session.selection;
  camera.fit(bounds, canvas.width, canvas.height, 0);
  session.selection = {};
  try {
    view.draw(canvas.getContext('2d')!, canvas.width, canvas.height, 1);
  } finally {
    Object.assign(camera, savedCamera);
    session.selection = savedSelection;
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}
