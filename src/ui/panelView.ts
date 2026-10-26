import {
  insertPlacement,
  nextPlacementId,
  removePlacement,
  type ModuleRef,
} from '../layout/placement';
import { MODULE_UNIT_MM, type ModuleDef } from '../library/types';
import type { Bounds, Point } from '../view/Camera';
import { Camera } from '../view/Camera';
import { FRAME_PADDING, frameRect, placementAt, snapToSlot } from '../view/geometry';
import { render, type Ghost } from '../view/render';
import type { Panel } from '../layout/placement';
import type { Session } from './session';
import type { View } from './view';

interface Drag {
  def: ModuleDef;
  module: ModuleRef;
  anchorUnits: number;
  movingId: string | null;
  newId: string;
  ghost: Ghost | null;
  next: Panel | null;
}

export class PanelView implements View {
  readonly camera = new Camera();
  private drag: Drag | null = null;

  constructor(private readonly session: Session) {}

  fitBounds(): Bounds {
    const frame = frameRect(this.session.project.panel);
    return { minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height };
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    render(
      ctx,
      this.camera,
      {
        panel: this.drag?.next ?? this.session.project.panel,
        resolve: this.session.resolve,
        selection: this.session.selection.placementId ?? null,
        movingId: this.drag?.movingId ?? null,
        ghost: this.drag?.ghost ?? null,
      },
      width,
      height,
      dpr,
    );
  }

  startPaletteDrag(e: PointerEvent, def: ModuleDef, module: ModuleRef, world: Point): void {
    this.session.selection = {};
    this.startDrag(def, module, def.widthUnits / 2, null);
    this.pointerMove(e, world, false);
  }

  pointerDown(_e: PointerEvent, world: Point): boolean {
    const panel = this.session.project.panel;
    const hit = placementAt(panel, this.session.widthOf, world);
    this.session.select(hit ? { placementId: hit.id } : {});
    if (!hit) return false;
    const def = this.session.resolve(hit.module);
    if (def) {
      const grabbedUnits = (world.x - FRAME_PADDING) / MODULE_UNIT_MM - hit.slot;
      const anchorUnits = Math.max(0, Math.min(grabbedUnits, def.widthUnits));
      this.startDrag(def, hit.module, anchorUnits, hit.id);
    }
    return true;
  }

  pointerMove(_e: PointerEvent, world: Point, overCanvas: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    const panel = this.session.project.panel;
    drag.ghost = null;
    drag.next = null;
    const snap = overCanvas ? snapToSlot(panel, world, drag.def.widthUnits, drag.anchorUnits) : null;
    if (snap) {
      const placement = { id: drag.movingId ?? drag.newId, module: drag.module, ...snap };
      const result = insertPlacement(panel, this.session.widthOf, placement, drag.movingId ?? undefined);
      drag.ghost = { module: drag.def, ...snap, valid: result.ok };
      drag.next = result.ok ? result.panel : null;
    }
    this.session.changed();
  }

  pointerUp(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const { ghost, next, movingId, newId } = drag;
    const unchanged =
      movingId !== null &&
      this.session.project.panel.placements.some(
        (p) => p.id === movingId && p.rail === ghost?.rail && p.slot === ghost?.slot,
      );
    if (next && !unchanged) {
      this.session.commit({ ...this.session.project, panel: next });
      this.session.select({ placementId: movingId ?? newId });
    } else {
      this.session.changed();
    }
  }

  deleteSelection(): void {
    const id = this.session.selection.placementId;
    if (!id) return;
    const result = removePlacement(this.session.project.panel, id);
    if (result.ok) this.session.commit({ ...this.session.project, panel: result.panel });
    this.session.select({});
  }

  private startDrag(def: ModuleDef, module: ModuleRef, anchorUnits: number, movingId: string | null): void {
    this.drag = {
      def,
      module,
      anchorUnits,
      movingId,
      newId: nextPlacementId(this.session.project.panel),
      ghost: null,
      next: null,
    };
  }
}
