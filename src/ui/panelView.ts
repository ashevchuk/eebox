import { addComb, moveComb, nextCombId, removeComb } from '../layout/combs';
import {
  insertPlacement,
  nextPlacementId,
  type ModuleRef,
  type Panel,
  type ShelfItem,
} from '../layout/placement';
import { placeFromShelf } from '../layout/shelf';
import type { Project } from '../project';
import { deletePlacement } from '../project/delete';
import { MODULE_UNIT_MM, type ModuleDef } from '../library/types';
import type { Bounds, Point } from '../view/Camera';
import { Camera } from '../view/Camera';
import { FRAME_PADDING, combAtPoint, frameRect, placementAt, railAtPoint, snapToSlot } from '../view/geometry';
import { render, type Ghost } from '../view/render';
import type { Session } from './session';
import type { View } from './view';

interface Drag {
  kind: 'placement' | 'comb';
  def: ModuleDef;
  /** Width of the dragged item, which differs from the library width for a resized copy. */
  widthUnits: number;
  module: ModuleRef;
  anchorUnits: number;
  movingId: string | null;
  /** Set when the drag started on the shelf, so the module keeps its id and properties. */
  shelfId: string | null;
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
    const { drag } = this;
    render(
      ctx,
      this.camera,
      {
        panel: drag?.next ?? this.session.project.panel,
        resolve: this.session.resolve,
        selectedPlacementId: this.session.selection.placementId ?? null,
        selectedCombId: this.session.selection.combId ?? null,
        selectedRail: this.session.selection.rail ?? null,
        moving: drag?.movingId ? { kind: drag.kind, id: drag.movingId } : null,
        ghost: drag?.ghost ?? null,
      },
      width,
      height,
      dpr,
    );
  }

  startPaletteDrag(e: PointerEvent, def: ModuleDef, module: ModuleRef, world: Point): void {
    this.session.selection = {};
    this.startDrag(def.kind === 'comb' ? 'comb' : 'placement', def, module, def.widthUnits, def.widthUnits / 2, null);
    this.pointerMove(e, world, false);
  }

  startShelfDrag(e: PointerEvent, item: ShelfItem, world: Point): void {
    const def = this.session.resolve(item.module);
    if (!def) {
      this.session.notify('That module is missing from the libraries, so it cannot be placed.', true);
      return;
    }
    this.session.selection = {};
    const width = item.widthUnits ?? def.widthUnits;
    this.startDrag('placement', def, item.module, width, width / 2, null, item.id);
    this.pointerMove(e, world, false);
  }

  pointerDown(_e: PointerEvent, world: Point): boolean {
    const panel = this.session.project.panel;
    const comb = combAtPoint(
      panel,
      (item) => {
        const def = this.session.resolve(item.module);
        return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
      },
      world,
    );
    if (comb) {
      this.session.select({ combId: comb.id });
      const def = this.session.resolve(comb.module);
      if (def) {
        const width = comb.widthUnits ?? def.widthUnits;
        this.startDrag('comb', def, comb.module, width, this.grabbedUnits(world, comb.slot, width), comb.id);
      }
      return true;
    }
    const hit = placementAt(panel, this.session.widthOf, world);
    if (!hit) {
      const rail = railAtPoint(panel, world);
      this.session.select(rail === undefined ? {} : { rail });
      return false;
    }
    this.session.select({ placementId: hit.id });
    const def = this.session.resolve(hit.module);
    if (def) {
      const width = hit.widthUnits ?? def.widthUnits;
      this.startDrag('placement', def, hit.module, width, this.grabbedUnits(world, hit.slot, width), hit.id);
    }
    return true;
  }

  pointerMove(_e: PointerEvent, world: Point, overCanvas: boolean): void {
    const drag = this.drag;
    if (!drag) return;
    const panel = this.session.project.panel;
    drag.ghost = null;
    drag.next = null;
    const snap = overCanvas ? snapToSlot(panel, world, drag.widthUnits, drag.anchorUnits) : null;
    if (snap) {
      const result = this.tryDrop(drag, panel, snap);
      drag.ghost = { module: drag.def, widthUnits: drag.widthUnits, ...snap, valid: result.ok };
      drag.next = result.ok ? result.panel : null;
    }
    this.session.changed();
  }

  pointerUp(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const { ghost, next, movingId, newId, kind } = drag;
    const list = kind === 'comb' ? this.session.project.panel.combs : this.session.project.panel.placements;
    const unchanged =
      movingId !== null && list.some((p) => p.id === movingId && p.rail === ghost?.rail && p.slot === ghost?.slot);
    if (next && !unchanged) {
      this.session.commit({ ...this.session.project, panel: next });
      const id = movingId ?? newId;
      this.session.select(kind === 'comb' ? { combId: id } : { placementId: id });
    } else {
      this.session.changed();
    }
  }

  deleteSelection(): void {
    const { placementId, combId } = this.session.selection;
    const panel = this.session.project.panel;
    const project = this.session.project;
    let next: Project | null = null;
    if (combId) {
      const result = removeComb(panel, combId);
      if (result.ok) next = { ...project, panel: result.panel };
    } else if (placementId) {
      next = deletePlacement(project, placementId);
    }
    if (next) this.session.commit(next);
    this.session.select({});
  }

  private grabbedUnits(world: Point, slot: number, widthUnits: number): number {
    const grabbed = (world.x - FRAME_PADDING) / MODULE_UNIT_MM - slot;
    return Math.max(0, Math.min(grabbed, widthUnits));
  }

  private tryDrop(drag: Drag, panel: Panel, snap: { rail: number; slot: number }) {
    const id = drag.movingId ?? drag.newId;
    if (drag.shelfId) return placeFromShelf(panel, this.session.widthOf, drag.shelfId, snap.rail, snap.slot);
    if (drag.kind === 'comb') {
      const { combLookup } = this.session;
      return drag.movingId
        ? moveComb(panel, combLookup, drag.movingId, snap.rail, snap.slot)
        : addComb(panel, combLookup, { id, module: drag.module, ...snap });
    }
    const moved = panel.placements.find((p) => p.id === drag.movingId);
    const placement = { ...(moved ?? { id, module: drag.module }), ...snap };
    return insertPlacement(panel, this.session.widthOf, placement, drag.movingId ?? undefined);
  }

  private startDrag(
    kind: Drag['kind'],
    def: ModuleDef,
    module: ModuleRef,
    widthUnits: number,
    anchorUnits: number,
    movingId: string | null,
    shelfId: string | null = null,
  ): void {
    const panel = this.session.project.panel;
    this.drag = {
      kind,
      def,
      widthUnits,
      module,
      anchorUnits,
      movingId,
      shelfId,
      newId: shelfId ?? (kind === 'comb' ? nextCombId(panel) : nextPlacementId(panel)),
      ghost: null,
      next: null,
    };
  }
}
