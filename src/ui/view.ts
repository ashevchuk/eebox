import type { Bounds, Camera, Point } from '../view/Camera';

export interface View {
  readonly camera: Camera;
  fitBounds(): Bounds;
  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void;
  /** Returns false when nothing was hit, so the caller can start panning. */
  pointerDown(e: PointerEvent, world: Point): boolean;
  pointerMove(e: PointerEvent, world: Point, overCanvas: boolean): void;
  pointerUp(e: PointerEvent, world: Point): void;
  deleteSelection(): void;
}
