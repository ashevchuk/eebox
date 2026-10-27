import type { PathCommand } from './art';

/** How far along its tangents a cubic curve is pulled to follow a quarter of a circle. */
const QUARTER = 0.5522847498;

/** A rectangle as path commands, with rounded corners when both radii are above nothing. */
export function rectCommands(x: number, y: number, w: number, h: number, rx = 0, ry = 0): PathCommand[] {
  if (rx <= 0 || ry <= 0) return [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }];
  const kx = rx * QUARTER;
  const ky = ry * QUARTER;
  return [
    { op: 'M', x: x + rx, y },
    { op: 'L', x: x + w - rx, y },
    { op: 'C', x1: x + w - rx + kx, y1: y, x2: x + w, y2: y + ry - ky, x: x + w, y: y + ry },
    { op: 'L', x: x + w, y: y + h - ry },
    { op: 'C', x1: x + w, y1: y + h - ry + ky, x2: x + w - rx + kx, y2: y + h, x: x + w - rx, y: y + h },
    { op: 'L', x: x + rx, y: y + h },
    { op: 'C', x1: x + rx - kx, y1: y + h, x2: x, y2: y + h - ry + ky, x, y: y + h - ry },
    { op: 'L', x, y: y + ry },
    { op: 'C', x1: x, y1: y + ry - ky, x2: x + rx - kx, y2: y, x: x + rx, y },
    { op: 'Z' },
  ];
}

/** An ellipse as four cubic curves. */
export function ellipseCommands(cx: number, cy: number, rx: number, ry: number): PathCommand[] {
  const kx = rx * QUARTER;
  const ky = ry * QUARTER;
  return [
    { op: 'M', x: cx + rx, y: cy },
    { op: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { op: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { op: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { op: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { op: 'Z' },
  ];
}
