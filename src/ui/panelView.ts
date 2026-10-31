import { markedBy } from '../electrical/problems';
import { copyItems, pasteItems, type Clip } from '../layout/clipboard';
import { withNoteBounds } from '../layout/annotations';
import { moveGroup } from '../layout/group';
import { addComb, moveComb, nextCombId, removeComb } from '../layout/combs';
import { addDuct, ductsOf, nextDuctId, type Duct } from '../layout/ducts';
import { addFreePlacement, moveFreeGroup, moveFreePlacement, roundMm } from '../layout/free';
import { MAX_RAIL_POSITION_MM, MIN_DUCT_SIZE_MM } from '../layout/limits';
import {
  insertPlacement,
  isFree,
  isOnRail,
  nextPlacementId,
  type ModuleRef,
  type Panel,
  type Placement,
  type ShelfItem,
} from '../layout/placement';
import { placeFromShelf, placeFromShelfFree } from '../layout/shelf';
import type { Project } from '../project';
import { deleteDuct, deletePlacement } from '../project/delete';
import { MODULE_UNIT_MM, type ModuleDef } from '../library/types';
import type { Bounds, Point } from '../view/Camera';
import { Camera } from '../view/Camera';
import { FRAME_PADDING, combAtPoint, ductAt, ductRect, frameRect, itemsInRect, placementAt, placementRect, railAtPoint, railRect, rectBetween, snapToSlot, type Neighbour, type Rect } from '../view/geometry';
import { dimensionsOf, type Dimension } from '../view/dimensions';
import { scopeToPlate } from '../layout/plates';
import { snapRect, snapToGrid, type Guide } from '../view/snap';
import { render, type Ghost } from '../view/render';
import { groupSelection, placementsOfNodes, selectedIds, toggleItem } from './selection';
import { edgeLines, snapToEdges } from '../view/ruler';
import type { Session } from './session';
import type { View } from './view';

/** How close, in screen pixels, a ruler end has to come to an edge to be drawn onto it. */
const RULER_SNAP_PX = 7;
/** How close, in screen pixels, an item dragged over the plate has to come to an edge or a centre to be drawn to it. */
const PLATE_SNAP_PX = 8;

interface Drag {
  kind: 'placement' | 'comb';
  def: ModuleDef;
  /** Width of the dragged item, which differs from the library width for a resized copy. */
  widthUnits: number;
  module: ModuleRef;
  anchorUnits: number;
  /** Where the pointer holds the device, in mm from its top-left corner; it decides where a drop on the plate puts it. */
  grab: Point;
  movingId: string | null;
  /** Set when the drag started on the shelf, so the module keeps its id and properties. */
  shelfId: string | null;
  newId: string;
  ghost: Ghost | null;
  next: Panel | null;
  /** Lines the dragged device is drawn to over the plate. */
  guides: Guide[];
  /** Set when the drag moves everything selected together; `origin` is where the grabbed item started. */
  group: { placements: string[]; combs: string[]; origin: { rail: number; slot: number } } | null;
}

/** Devices fixed to the plate and cable ducts, dragged one by one or together; they never go on a rail. */
interface PlateDrag {
  placements: string[];
  ducts: string[];
  /** Where the grabbed item started, in plate coordinates. */
  origin: Point;
  /** Where the pointer holds it, in mm from its top-left corner. */
  grab: Point;
  size: { width: number; height: number };
  next: Panel | null;
  guides: Guide[];
}

export class PanelView implements View {
  readonly camera = new Camera();
  private drag: Drag | null = null;
  private clip: Clip | null = null;
  private band: { from: Point; to: Point } | null = null;
  private measuring = false;
  private plateDrag: PlateDrag | null = null;
  private ductDraft: { from: Point; to: Point } | null = null;

  constructor(private readonly session: Session) {}

  fitBounds(): Bounds {
    const { panel } = this.session.scope;
    const frame = frameRect(panel);
    return withNoteBounds({ minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height }, panel.plates[0]!.annotations);
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    const { drag, plateDrag } = this;
    const chosenIds = selectedIds(this.session.selection);
    render(
      ctx,
      this.camera,
      {
        panel: this.viewed(drag?.next ?? plateDrag?.next ?? null),
        ...(this.session.project.panel.plates.length > 1 ? { plateName: this.session.scope.panel.plates[0]!.name } : {}),
        resolve: this.session.resolve,
        selectedPlacementId: this.session.selection.placementId ?? null,
        selectedCombId: this.session.selection.combId ?? null,
        selectedRail: this.session.selection.rail !== undefined && this.session.selection.rail >= this.session.scope.offset && this.session.selection.rail < this.session.scope.offset + this.session.scope.panel.rails.length ? this.session.selection.rail - this.session.scope.offset : null,
        selectedIds: new Set([...chosenIds.placements, ...placementsOfNodes(this.session.selection, this.session.project.schematic.nodes), ...chosenIds.combs, ...chosenIds.ducts]),
        moving: drag?.movingId ? { kind: drag.kind, id: drag.movingId } : null,
        ghost: drag?.ghost ?? null,
        guides: drag?.guides ?? plateDrag?.guides ?? [],
        dimensions: this.session.marksVisible ? this.dimensionsOfSelection() : [],
        gridMm: this.session.marksVisible ? this.session.gridMm : 0,
        draftDuct: this.ductDraft ? this.draftRect(this.ductDraft) : null,
        band: this.band ? rectBetween(this.band.from, this.band.to) : null,
        ruler: this.session.ruler.line,
        bare: this.session.bareDrawing,
        texts: this.session.texts,
        selectedAnnotationId: this.session.selection.annotationId ?? null,
        annotations: this.session.notesOf('panel'),
        marked: this.session.marksVisible ? new Map([...markedBy(this.session.findings, 'placements'), ...markedBy(this.session.findings, 'ducts')]) : new Map(),
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
  /** What the stage shows: the plate on view of the panel that is being dragged to, or of the one that is not. */
  private viewed(panel: Panel | null): Panel {
    return panel ? scopeToPlate(panel, this.session.plateId).panel : this.session.scope.panel;
  }

  private snapped(world: Point): Point {
    const info = (item: { module: ModuleRef; widthUnits?: number }) => {
      const def = this.session.resolve(item.module);
      return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
    };
    const edges = edgeLines(this.session.scope.panel, this.session.sizes, info);
    return snapToEdges(world, edges, RULER_SNAP_PX / this.camera.scale);
  }

  /**
   * Distances from the one selected thing, or the one being dragged, to what is beside it. Nothing is
   * shown for a group, a rail or when nothing is selected.
   */
  private dimensionsOfSelection(): Dimension[] {
    const panel = this.viewed(this.drag?.next ?? this.plateDrag?.next ?? null);
    const chosen = selectedIds(this.session.selection);
    const ids = [...chosen.placements, ...chosen.ducts];
    if (ids.length !== 1 || chosen.combs.length > 0) return [];
    const id = ids[0]!;
    const { sizes } = this.session;
    const placement = panel.placements.find((p) => p.id === id);
    const duct = ductsOf(panel).find((d) => d.id === id);
    const box = placement ? placementRect(panel, sizes, placement) : duct ? ductRect(duct) : undefined;
    if (!box) return [];
    const others = [...panel.placements.filter((p) => p.id !== id).map((p) => placementRect(panel, sizes, p)), ...ductsOf(panel).filter((d) => d.id !== id).map(ductRect)];
    return dimensionsOf(box, others, { x: FRAME_PADDING, y: FRAME_PADDING });
  }

  /** The rectangle between two points of a duct being drawn, in world coordinates. */
  private draftRect(draft: { from: Point; to: Point }): Rect {
    return rectBetween(draft.from, draft.to);
  }

  /** Where a body at `rect` may be drawn to: the edges and centres of everything else on the plate. */
  private snapTargets(except: { placements: readonly string[]; ducts: readonly string[] }): Rect[] {
    const { panel } = this.session.scope;
    const { sizes } = this.session;
    return [
      { x: FRAME_PADDING, y: FRAME_PADDING, width: 0, height: 0 },
      ...panel.rails.map((_r, rail) => railRect(panel, rail)),
      ...panel.placements.filter((p) => !except.placements.includes(p.id)).map((p) => placementRect(panel, sizes, p)),
      ...ductsOf(panel).filter((d) => !except.ducts.includes(d.id)).map(ductRect),
    ];
  }

  /** The place on the plate a body held at `grab` takes when the pointer is at `world`, drawn to the nearby edges. */
  private plateSpot(world: Point, grab: Point, size: { width: number; height: number }, except: { placements: readonly string[]; ducts: readonly string[] }, free: boolean): { x: number; y: number; guides: Guide[] } {
    const raw = { x: world.x - grab.x, y: world.y - grab.y, ...size };
    const snapped = free ? { x: raw.x, y: raw.y, guides: [] } : snapToGrid(snapRect(raw, this.snapTargets(except), PLATE_SNAP_PX / this.camera.scale), this.session.gridMm, { x: FRAME_PADDING, y: FRAME_PADDING });
    const inside = (v: number) => Math.max(0, Math.min(MAX_RAIL_POSITION_MM, roundMm(v - FRAME_PADDING)));
    return { x: inside(snapped.x), y: inside(snapped.y), guides: snapped.guides };
  }

  pointerDown(e: PointerEvent, world: Point): boolean {
    if (this.session.ruler.on) {
      const start = this.snapped(world);
      this.session.ruler.line = { a: start, b: start };
      this.measuring = true;
      this.session.changed();
      return true;
    }
    if (this.session.ductTool) {
      const start = this.snapped(world);
      this.ductDraft = { from: start, to: start };
      this.session.changed();
      return true;
    }
    const panel = this.session.scope.panel;
    const comb = combAtPoint(
      panel,
      this.session.sizes,
      (item) => {
        const def = this.session.resolve(item.module);
        return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
      },
      world,
    );
    const chosen = selectedIds(this.session.selection);
    const inGroup = (kind: 'placement' | 'comb' | 'duct', id: string) =>
      this.session.selection.placementIds !== undefined || this.session.selection.combIds !== undefined
        ? (kind === 'placement' ? chosen.placements : kind === 'comb' ? chosen.combs : chosen.ducts).includes(id)
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
    const hit = placementAt(panel, this.session.sizes, world);
    const duct = hit ? undefined : ductAt(panel, world);
    if (!hit && !duct && e.shiftKey) {
      this.band = { from: world, to: world };
      return true;
    }
    if (!hit && duct) {
      if (e.shiftKey) {
        this.session.select(toggleItem(this.session.selection, 'duct', duct.id));
        return true;
      }
      if (!inGroup('duct', duct.id)) this.session.select({ ductId: duct.id });
      this.startPlateDrag(world, ductRect(duct), { x: duct.x, y: duct.y });
      return true;
    }
    if (!hit) {
      const rail = railAtPoint(panel, world);
      this.session.select(rail === undefined ? {} : { rail: rail + this.session.scope.offset });
      return false;
    }
    if (e.shiftKey) {
      this.session.select(toggleItem(this.session.selection, 'placement', hit.id));
      return true;
    }
    if (inGroup('placement', hit.id)) {
      if (isFree(hit)) this.startPlateDrag(world, placementRect(panel, this.session.sizes, hit), { x: hit.x, y: hit.y });
      else this.startGroupDrag('placement', hit, this.session.widthOf(hit) ?? 1, world);
      return true;
    }
    this.session.select({ placementId: hit.id });
    const def = this.session.resolve(hit.module);
    if (def) {
      const width = hit.widthUnits ?? def.widthUnits;
      const body = placementRect(panel, this.session.sizes, hit);
      const grab = { x: world.x - body.x, y: world.y - body.y };
      this.startDrag('placement', def, hit.module, width, isOnRail(hit) ? this.grabbedUnits(world, hit.slot, width) : width / 2, hit.id, null, grab);
    }
    return true;
  }

  /** Starts moving the selected devices on the plate and ducts together by the one that was pressed. */
  private startPlateDrag(world: Point, body: Rect, origin: Point): void {
    const chosen = selectedIds(this.session.selection);
    this.plateDrag = {
      placements: chosen.placements,
      ducts: chosen.ducts,
      origin,
      grab: { x: world.x - body.x, y: world.y - body.y },
      size: { width: body.width, height: body.height },
      next: null,
      guides: [],
    };
  }

  pointerMove(e: PointerEvent, world: Point, overCanvas: boolean): void {
    if (this.measuring && this.session.ruler.line) {
      this.session.ruler.line = { a: this.session.ruler.line.a, b: this.snapped(world) };
      this.session.changed();
      return;
    }
    if (this.ductDraft) {
      this.ductDraft = { ...this.ductDraft, to: this.snapped(world) };
      this.session.changed();
      return;
    }
    if (this.band) {
      this.band = { ...this.band, to: world };
      this.session.changed();
      return;
    }
    const plate = this.plateDrag;
    if (plate) {
      const spot = this.plateSpot(world, plate.grab, plate.size, plate, e.altKey);
      const result = moveFreeGroup(this.session.project.panel, plate.placements, plate.ducts, spot.x - plate.origin.x, spot.y - plate.origin.y);
      plate.next = result.ok ? result.panel : null;
      plate.guides = spot.guides;
      this.session.changed();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const panel = this.session.scope.panel;
    const full = this.session.project.panel;
    drag.ghost = null;
    drag.next = null;
    drag.guides = [];
    const onRailAllowed = drag.kind === 'comb' || drag.def.mounting !== 'plate';
    const onPlateAllowed = drag.kind === 'placement' && drag.def.mounting !== 'rail';
    const snap = overCanvas && onRailAllowed ? snapToSlot(panel, world, drag.widthUnits, drag.anchorUnits, this.neighboursOf(drag, panel)) : null;
    if (snap) {
      const result = this.tryDrop(drag, full, snap);
      drag.ghost = { module: drag.def, widthUnits: drag.widthUnits, ...snap, valid: result.ok };
      drag.next = result.ok ? result.panel : null;
    } else if (overCanvas && onPlateAllowed) {
      const size = { width: drag.widthUnits * MODULE_UNIT_MM, height: drag.def.heightMm };
      const spot = this.plateSpot(world, drag.grab, size, { placements: drag.movingId ? [drag.movingId] : [], ducts: [] }, e.altKey);
      const result = this.tryDropOnPlate(drag, full, spot);
      drag.ghost = { module: drag.def, widthUnits: drag.widthUnits, x: spot.x, y: spot.y, valid: result.ok };
      drag.next = result.ok ? result.panel : null;
      drag.guides = spot.guides;
    }
    this.session.changed();
  }

  /** What the dragged item may be drawn up against: the other items of its own kind, not itself. */
  private neighboursOf(drag: Drag, panel: Panel): Neighbour[] {
    const others = drag.kind === 'comb' ? panel.combs : panel.placements.filter(isOnRail);
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
    if (this.ductDraft) {
      this.finishDuct();
      return;
    }
    if (this.band) {
      const area: Rect = rectBetween(this.band.from, this.band.to);
      this.band = null;
      const panel = this.session.scope.panel;
      const found = itemsInRect(panel, this.session.sizes, (item) => {
        const def = this.session.resolve(item.module);
        return def?.comb ? { widthUnits: item.widthUnits ?? def.widthUnits, side: def.comb.side } : undefined;
      }, area);
      this.session.select(groupSelection(found.placements, found.combs, found.ducts));
      return;
    }
    const plate = this.plateDrag;
    if (plate) {
      this.plateDrag = null;
      if (plate.next && JSON.stringify(plate.next) !== JSON.stringify(this.session.project.panel)) this.session.commit({ ...this.session.project, panel: plate.next });
      else this.session.changed();
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    const { ghost, next, movingId, newId, kind } = drag;
    const list: Array<{ id: string; rail?: number; slot?: number; x?: number; y?: number }> = kind === 'comb' ? this.session.project.panel.combs : this.session.project.panel.placements;
    if (drag.group) {
      const { origin } = drag.group;
      const moved = ghost !== null && (ghost.rail !== origin.rail || ghost.slot !== origin.slot);
      if (next && moved) this.session.commit({ ...this.session.project, panel: next });
      else this.session.changed();
      return;
    }
    const unchanged =
      movingId !== null &&
      list.some((p) => p.id === movingId && (ghost?.x !== undefined ? p.x === ghost.x && p.y === ghost.y : ghost?.rail !== undefined && p.rail === ghost.rail + this.session.scope.offset && p.slot === ghost.slot));
    if (next && !unchanged) {
      this.session.commit({ ...this.session.project, panel: next });
      const id = movingId ?? newId;
      this.session.select(kind === 'comb' ? { combId: id } : { placementId: id });
    } else {
      this.session.changed();
    }
  }

  /** Makes the duct that was drawn, if it came out big enough; the tool stays on for the next one. */
  private finishDuct(): void {
    const draft = this.ductDraft;
    this.ductDraft = null;
    if (!draft) return;
    const rect = this.draftRect(draft);
    if (rect.width < MIN_DUCT_SIZE_MM || rect.height < MIN_DUCT_SIZE_MM) {
      this.session.changed();
      return;
    }
    const panel = this.session.project.panel;
    const duct: Duct = {
      id: nextDuctId(panel),
      plate: this.session.plateId,
      x: Math.max(0, roundMm(rect.x - FRAME_PADDING)),
      y: Math.max(0, roundMm(rect.y - FRAME_PADDING)),
      widthMm: roundMm(rect.width),
      heightMm: roundMm(rect.height),
    };
    const result = addDuct(panel, duct);
    if (!result.ok) {
      this.session.notify('That duct cannot be made there.', true);
      return;
    }
    this.session.commit({ ...this.session.project, panel: result.panel });
    this.session.select({ ductId: duct.id });
  }

  /** Stops what is being drawn or dragged, without changing anything; true if there was something. */
  cancel(): boolean {
    const busy = this.ductDraft !== null || this.plateDrag !== null || this.drag !== null;
    this.ductDraft = null;
    this.plateDrag = null;
    this.drag = null;
    if (busy) this.session.changed();
    return busy;
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
    for (const id of chosen.ducts) {
      const next = deleteDuct(project, id);
      if (next) {
        project = next;
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

  /**
   * Moves what is selected: modules and combs by whole rows and units, devices on the plate and ducts
   * by millimetres. Nothing moves if one of the modules on a rail would not fit.
   */
  nudgeSelection(step: { rail: number; slot: number }, mm: { dx: number; dy: number }): void {
    const chosen = selectedIds(this.session.selection);
    let panel = this.session.project.panel;
    const onRail = chosen.placements.filter((id) => panel.placements.some((p) => p.id === id && isOnRail(p)));
    const onPlate = chosen.placements.filter((id) => !onRail.includes(id));
    if (onRail.length + chosen.combs.length + onPlate.length + chosen.ducts.length === 0) return;
    if (onRail.length + chosen.combs.length > 0) {
      const result = moveGroup(panel, this.session.widthOf, this.session.combLookup, onRail, chosen.combs, step.rail, step.slot);
      if (!result.ok) return this.session.notify('There is no room there: a module or the end of the rail is in the way.', true);
      panel = result.panel;
    }
    if (onPlate.length + chosen.ducts.length > 0) {
      const result = moveFreeGroup(panel, onPlate, chosen.ducts, mm.dx, mm.dy);
      if (result.ok) panel = result.panel;
    }
    this.session.commit({ ...this.session.project, panel });
  }

  selectAll(): void {
    const { panel } = this.session.scope;
    this.session.select(groupSelection(panel.placements.map((p) => p.id), panel.combs.map((c) => c.id), ductsOf(panel).map((d) => d.id)));
  }

  copySelection(): void {
    const chosen = selectedIds(this.session.selection);
    const clip = copyItems(this.session.project.panel, chosen.placements, chosen.combs, chosen.ducts);
    const count = clip.placements.length + clip.combs.length + clip.free.length + clip.ducts.length;
    if (count === 0) return;
    this.clip = clip;
    this.session.notify(`Copied ${count} item(s).`);
  }

  paste(): void {
    if (!this.clip) return;
    // Devices on the plate and ducts land on the plate on view, wherever they were copied from.
    const clip = { ...this.clip, free: this.clip.free.map((f) => ({ ...f, plate: this.session.plateId })), ducts: this.clip.ducts.map((d) => ({ ...d, plate: this.session.plateId })) };
    const result = pasteItems(this.session.project.panel, this.session.widthOf, this.session.combLookup, clip);
    if (!result.ok) {
      this.session.notify(result.error === 'no-room' ? 'There is no room on the rails for the copies.' : 'Nothing is copied.', true);
      return;
    }
    this.session.commit({ ...this.session.project, panel: result.panel });
    this.session.select(groupSelection(result.placementIds, result.combIds, result.ductIds));
  }

  duplicateSelection(): void {
    this.copySelection();
    this.paste();
  }

  private grabbedUnits(world: Point, slot: number, widthUnits: number): number {
    const grabbed = (world.x - FRAME_PADDING) / MODULE_UNIT_MM - slot;
    return Math.max(0, Math.min(grabbed, widthUnits));
  }

  /** `snap` is a place on the plate on view, its rows numbered from its first one; the panel numbers them all. */
  private tryDrop(drag: Drag, panel: Panel, snap: { rail: number; slot: number }) {
    const id = drag.movingId ?? drag.newId;
    const place = { rail: snap.rail + this.session.scope.offset, slot: snap.slot };
    if (drag.group) {
      const { origin, placements, combs } = drag.group;
      const moved = moveGroup(panel, this.session.widthOf, this.session.combLookup, placements, combs, snap.rail - origin.rail, snap.slot - origin.slot);
      return moved.ok ? { ok: true as const, panel: moved.panel } : { ok: false as const };
    }
    if (drag.shelfId) return placeFromShelf(panel, this.session.widthOf, drag.shelfId, place.rail, place.slot);
    if (drag.kind === 'comb') {
      const { combLookup } = this.session;
      return drag.movingId
        ? moveComb(panel, combLookup, drag.movingId, place.rail, place.slot)
        : addComb(panel, combLookup, { id, module: drag.module, ...place });
    }
    const moved = panel.placements.find((p) => p.id === drag.movingId);
    const { x: _x, y: _y, plate: _plate, ...rest } = moved ?? { id, module: drag.module };
    return insertPlacement(panel, this.session.widthOf, { ...rest, ...place }, drag.movingId ?? undefined);
  }

  /** Puts the dragged device on the plate; it may stand on other things, which the checks flag later. */
  private tryDropOnPlate(drag: Drag, panel: Panel, spot: { x: number; y: number }) {
    const plate = this.session.plateId;
    if (drag.shelfId) return placeFromShelfFree(panel, this.session.widthOf, drag.shelfId, plate, spot.x, spot.y);
    if (drag.movingId) return moveFreePlacement(panel, drag.movingId, spot.x, spot.y, plate);
    return addFreePlacement(panel, this.session.widthOf, { id: drag.newId, module: drag.module, plate, x: spot.x, y: spot.y });
  }

  private startDrag(
    kind: Drag['kind'],
    def: ModuleDef,
    module: ModuleRef,
    widthUnits: number,
    anchorUnits: number,
    movingId: string | null,
    shelfId: string | null = null,
    grab: Point = { x: (widthUnits * MODULE_UNIT_MM) / 2, y: def.heightMm / 2 },
  ): void {
    const panel = this.session.project.panel;
    this.drag = {
      kind,
      def,
      widthUnits,
      module,
      anchorUnits,
      grab,
      movingId,
      shelfId,
      newId: shelfId ?? (kind === 'comb' ? nextCombId(panel) : nextPlacementId(panel)),
      ghost: null,
      next: null,
      guides: [],
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
