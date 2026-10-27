import type { Camera } from '../view/Camera';
import { fromMinimap, minimapFit, toMinimap, visibleWorld, type MinimapFit } from '../view/minimap';
import type { Overview } from './overview';

const BACKGROUND = 'rgba(15, 17, 23, 0.85)';
const VIEWPORT_COLOR = '#f5c518';
const PATH_COLOR = 'rgba(148, 163, 184, 0.6)';

/** A map of the whole drawing in the corner of the stage: where the camera is, and a click or a drag moves it there. */
export class MinimapView {
  private fit: MinimapFit | null = null;
  private dragging = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** The camera to move; the map follows the view that is on. */
    private readonly cameraOf: () => Camera,
    private readonly onMoved: () => void,
  ) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      this.moveTo(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) this.moveTo(e);
    });
    const stop = () => {
      this.dragging = false;
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('lostpointercapture', stop);
  }

  set visible(shown: boolean) {
    this.canvas.hidden = !shown;
  }

  get visible(): boolean {
    return !this.canvas.hidden;
  }

  private moveTo(e: PointerEvent): void {
    if (!this.fit) return;
    const rect = this.canvas.getBoundingClientRect();
    const world = fromMinimap(this.fit, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    const camera = this.cameraOf();
    camera.x = world.x;
    camera.y = world.y;
    this.onMoved();
  }

  draw(overview: Overview, camera: Camera, viewportW: number, viewportH: number): void {
    if (this.canvas.hidden) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx || width === 0) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);
    const seen = visibleWorld(camera, viewportW, viewportH);
    // The map shows the drawing and, when the camera has wandered off it, the camera too.
    const all = {
      minX: Math.min(overview.bounds.minX, seen.minX),
      minY: Math.min(overview.bounds.minY, seen.minY),
      maxX: Math.max(overview.bounds.maxX, seen.maxX),
      maxY: Math.max(overview.bounds.maxY, seen.maxY),
    };
    const fit = minimapFit(all, width, height);
    this.fit = fit;
    ctx.strokeStyle = PATH_COLOR;
    ctx.lineWidth = 1;
    for (const path of overview.paths) {
      ctx.beginPath();
      path.forEach((point, i) => {
        const p = toMinimap(fit, point);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
    for (const { box, color } of overview.boxes) {
      const a = toMinimap(fit, { x: box.minX, y: box.minY });
      const b = toMinimap(fit, { x: box.maxX, y: box.maxY });
      ctx.fillStyle = color;
      ctx.fillRect(a.x, a.y, Math.max(1, b.x - a.x), Math.max(1, b.y - a.y));
    }
    const a = toMinimap(fit, { x: seen.minX, y: seen.minY });
    const b = toMinimap(fit, { x: seen.maxX, y: seen.maxY });
    ctx.strokeStyle = VIEWPORT_COLOR;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }
}
