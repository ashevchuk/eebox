import { markedBy } from '../electrical/problems';
import { copyItems, pasteItems, type Clip } from '../layout/clipboard';
import { withNoteBounds } from '../layout/annotations';
import { moveGroup } from '../layout/group';
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
import { FRAME_PADDING, combAtPoint, frameRect, itemsInRect, placementAt, railAtPoint, rectBetween, snapToSlot, type Neighbour, type Rect } from '../view/geometry';
import { render, type Ghost } from '../view/render';
import { groupSelection, selectedIds, toggleItem } from './selection';
import { edgeLines, snapToEdges } from '../view/ruler';
import type { Session } from './session';
import type { View } from './view';

/** How close, in screen pixels, a ruler end has to come to an edge to be drawn onto it. */
const RULER_SNAP_PX = 7;

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
  /** Set when the drag moves everything selected together; `origin` is where the grabbed item started. */
  group: { placements: string[]; combs: string[]; origin: { rail: number; slot: number } } | null;
}

export class PanelView implements View {
  readonly camera = new Camera();
  private drag: Drag | null = null;
  private clip: Clip | null = null;
  private band: { from: Point; to: Point } | null = null;
  private measuring = false;

  constructor(private readonly session: Session) {}

  fitBounds(): Bounds {
    const frame = frameRect(this.session.project.panel);
    return withNoteBounds({ minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height }, this.session.project.panel.annotations);
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
        selectedIds: new Set([...selectedIds(this.session.selection).placements, ...selectedIds(this.session.selection).combs]),
        moving: drag?.movingId ? { kind: drag.kind, id: drag.movingId } : null,
        ghost: drag?.ghost ?? null,
        band: this.band ? rectBetween(this.band.from, this.band.to) : null,
        ruler: this.session.ruler.line,
        bare: this.session.bareDrawing,
        texts: this.session.texts,
        selectedAnnotationId: this.session.selection.annotationId ?? null,
        annotations: this.session.notesOf('panel'),
        marked: this.session.marksVisible ? markedBy(this.session.findings, 'placements') : new Map(),
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

  /** A point of the drawing drawn to the nearest edge within a few pixels of the screen. */
  private snapped(world: Point): Point {
    const info = (item: { module: ModuleRef; widthUnits?: number }) => {
      const def = this.session.resolve(item.module);
      return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
    };
    const edges = edgeLines(this.session.project.panel, this.session.widthOf, info);
    return snapToEdges(world, edges, RULER_SNAP_PX / this.camera.scale);
  }

  pointerDown(e: PointerEvent, world: Point): boolean {
    if (this.session.ruler.on) {
      const start = this.snapped(world);
      this.session.ruler.line = { a: start, b: start };
      this.measuring = true;
      this.session.changed();
      return true;
    }
    const panel = this.session.project.panel;
    const comb = combAtPoint(
      panel,
      (item) => {
        const def = this.session.resolve(item.module);
        return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
      },
      world,
    );
    const chosen = selectedIds(this.session.selection);
    const inGroup = (kind: 'placement' | 'comb', id: string) =>
      this.session.selection.placementIds !== undefined || this.session.selection.combIds !== undefined
        ? (kind === 'placement' ? chosen.placements : chosen.combs).includes(id)
        : false;
    if (comb && e.shiftKey) {
      this.session.select(toggleItem(this.session.selection, 'comb', comb.id));
      return true;
    }
    if (comb && inGroup('comb', comb.id)) {
      const width = comb.widthUnits ?? this.session.resolve(comb.module)?.widthUnits ?? 1;
      this.startGroupDrag('comb', comb, width, world);
      return true;
    }
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
    if (!hit && e.shiftKey) {
      this.band = { from: world, to: world };
      return true;
    }
    if (!hit) {
      const rail = railAtPoint(panel, world);
      this.session.select(rail === undefined ? {} : { rail });
      return false;
    }
    if (e.shiftKey) {
      this.session.select(toggleItem(this.session.selection, 'placement', hit.id));
      return true;
    }
    if (inGroup('placement', hit.id)) {
      this.startGroupDrag('placement', hit, this.session.widthOf(hit) ?? 1, world);
      return true;
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
    if (this.measuring && this.session.ruler.line) {
      this.session.ruler.line = { a: this.session.ruler.line.a, b: this.snapped(world) };
      this.session.changed();
      return;
    }
    if (this.band) {
      this.band = { ...this.band, to: world };
      this.session.changed();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const panel = this.session.project.panel;
    drag.ghost = null;
    drag.next = null;
    const snap = overCanvas ? snapToSlot(panel, world, drag.widthUnits, drag.anchorUnits, this.neighboursOf(drag, panel)) : null;
    if (snap) {
      const result = this.tryDrop(drag, panel, snap);
      drag.ghost = { module: drag.def, widthUnits: drag.widthUnits, ...snap, valid: result.ok };
      drag.next = result.ok ? result.panel : null;
    }
    this.session.changed();
  }

  /** What the dragged item may be drawn up against: the other items of its own kind, not itself. */
  private neighboursOf(drag: Drag, panel: Panel): Neighbour[] {
    const others = drag.kind === 'comb' ? panel.combs : panel.placements;
    return others
      .filter((item) => item.id !== drag.movingId && !(drag.group?.placements.includes(item.id) || drag.group?.combs.includes(item.id)))
      .map((item) => ({ rail: item.rail, slot: item.slot, widthUnits: this.session.widthOf(item) ?? 1 }));
  }

  pointerUp(): void {
    if (this.measuring) {
      this.measuring = false;
      const line = this.session.ruler.line;
      if (line && line.a.x === line.b.x && line.a.y === line.b.y) this.session.ruler.line = null;
      this.session.changed();
      return;
    }
    if (this.band) {
      const area: Rect = rectBetween(this.band.from, this.band.to);
      this.band = null;
      const panel = this.session.project.panel;
      const found = itemsInRect(panel, this.session.widthOf, (item) => {
        const def = this.session.resolve(item.module);
        return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
      }, area);
      this.session.select(groupSelection(found.placements, found.combs));
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const { ghost, next, movingId, newId, kind } = drag;
    const list = kind === 'comb' ? this.session.project.panel.combs : this.session.project.panel.placements;
    if (drag.group) {
      const { origin } = drag.group;
      const moved = ghost !== null && (ghost.rail !== origin.rail || ghost.slot !== origin.slot);
      if (next && moved) this.session.commit({ ...this.session.project, panel: next });
      else this.session.changed();
      return;
    }
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
    const chosen = selectedIds(this.session.selection);
    let project = this.session.project;
    let changed = false;
    for (const id of chosen.combs) {
      const result = removeComb(project.panel, id);
      if (result.ok) {
        project = { ...project, panel: result.panel };
        changed = true;
      }
    }
    for (const id of chosen.placements) {
      const next = deletePlacement(project, id);
      if (next) {
        project = next;
        changed = true;
      }
    }
    if (changed) this.session.commit(project);
    this.session.select({});
  }

  /** Moves the selected modules and combs by whole rows and units; nothing moves if one of them would not fit. */
  nudgeSelection(railDelta: number, slotDelta: number): void {
    const chosen = selectedIds(this.session.selection);
    if (chosen.placements.length + chosen.combs.length === 0) return;
    const result = moveGroup(this.session.project.panel, this.session.widthOf, this.session.combLookup, chosen.placements, chosen.combs, railDelta, slotDelta);
    if (!result.ok) return this.session.notify('There is no room there: a module or the end of the rail is in the way.', true);
    this.session.commit({ ...this.session.project, panel: result.panel });
  }

  selectAll(): void {
    const { panel } = this.session.project;
    this.session.select(groupSelection(panel.placements.map((p) => p.id), panel.combs.map((c) => c.id)));
  }

  copySelection(): void {
    const chosen = selectedIds(this.session.selection);
    const clip = copyItems(this.session.project.panel, chosen.placements, chosen.combs);
    if (clip.placements.length + clip.combs.length === 0) return;
    this.clip = clip;
    this.session.notify(`Copied ${clip.placements.length + clip.combs.length} item(s).`);
  }

  paste(): void {
    if (!this.clip) return;
    const result = pasteItems(this.session.project.panel, this.session.widthOf, this.session.combLookup, this.clip);
    if (!result.ok) {
      this.session.notify(result.error === 'no-room' ? 'There is no room on the rails for the copies.' : 'Nothing is copied.', true);
      return;
    }
    this.session.commit({ ...this.session.project, panel: result.panel });
    this.session.select(groupSelection(result.placementIds, result.combIds));
  }

  duplicateSelection(): void {
    this.copySelection();
    this.paste();
  }

  private grabbedUnits(world: Point, slot: number, widthUnits: number): number {
    const grabbed = (world.x - FRAME_PADDING) / MODULE_UNIT_MM - slot;
    return Math.max(0, Math.min(grabbed, widthUnits));
  }

  private tryDrop(drag: Drag, panel: Panel, snap: { rail: number; slot: number }) {
    const id = drag.movingId ?? drag.newId;
    if (drag.group) {
      const { origin, placements, combs } = drag.group;
      const moved = moveGroup(panel, this.session.widthOf, this.session.combLookup, placements, combs, snap.rail - origin.rail, snap.slot - origin.slot);
      return moved.ok ? { ok: true as const, panel: moved.panel } : { ok: false as const };
    }
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
      group: null,
    };
  }

  private startGroupDrag(kind: Drag['kind'], item: { id: string; module: ModuleRef; rail: number; slot: number }, width: number, world: Point): void {
    const def = this.session.resolve(item.module);
    if (!def) return;
    this.startDrag(kind, def, item.module, width, this.grabbedUnits(world, item.slot, width), item.id);
    const chosen = selectedIds(this.session.selection);
    this.drag!.group = { placements: chosen.placements, combs: chosen.combs, origin: { rail: item.rail, slot: item.slot } };
  }
}
