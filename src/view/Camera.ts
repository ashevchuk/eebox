export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** `x, y` is the world point at the viewport center; `scale` is world-to-screen zoom. */
export class Camera {
  x = 0;
  y = 0;
  scale = 1;
  readonly minScale = 0.1;
  readonly maxScale = 8;

  worldToScreen(p: Point, viewportW: number, viewportH: number): Point {
    return {
      x: (p.x - this.x) * this.scale + viewportW / 2,
      y: (p.y - this.y) * this.scale + viewportH / 2,
    };
  }

  screenToWorld(p: Point, viewportW: number, viewportH: number): Point {
    return {
      x: (p.x - viewportW / 2) / this.scale + this.x,
      y: (p.y - viewportH / 2) / this.scale + this.y,
    };
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
  }

  /** Zooms by `factor`, keeping the world point under `screenPoint` fixed on screen. */
  zoomAt(screenPoint: Point, factor: number, viewportW: number, viewportH: number): void {
    const before = this.screenToWorld(screenPoint, viewportW, viewportH);
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale);
    const after = this.screenToWorld(screenPoint, viewportW, viewportH);
    this.x -= after.x - before.x;
    this.y -= after.y - before.y;
  }

  fit(bounds: Bounds, viewportW: number, viewportH: number, padding = 40): void {
    const w = Math.max(bounds.maxX - bounds.minX, 1);
    const h = Math.max(bounds.maxY - bounds.minY, 1);
    const fitScale = Math.min((viewportW - padding * 2) / w, (viewportH - padding * 2) / h);
    this.scale = clamp(fitScale, this.minScale, this.maxScale);
    this.x = (bounds.minX + bounds.maxX) / 2;
    this.y = (bounds.minY + bounds.maxY) / 2;
  }
}
