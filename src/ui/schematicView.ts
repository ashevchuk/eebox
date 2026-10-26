import { energy, type Energy } from '../electrical/energy';
import { formatAmps, wireCurrents } from '../electrical/loads';
import { combContacts } from '../electrical/nets';
import { FREE_NODE_PRESETS, nodeTerminalsLookup } from '../electrical/nodeTerminals';
import {
  PORT_RADIUS,
  computeLayout,
  freeSpot,
  hitNode,
  hitPort,
  hitWire,
  pathMidpoint,
  portOf,
  schematicBounds,
  type Endpoint,
  type Layout,
} from '../schematic/geometry';
import { laneTargets, snapLane, type SnapTarget } from '../schematic/laneSnap';
import type { Lanes } from '../schematic/manualRoute';
import { spreadOverlaps } from '../schematic/overlaps';
import { routeWires } from '../schematic/router';
import { beginDrag, dragLanes, hitSegment, segmentsOf, type Segment, type WireDrag } from '../schematic/wireEditing';
import {
  addNode,
  connect,
  clearWireRoutes,
  connectAll,
  moveNode,
  removeNode,
  removeWire,
  setWireRoute,
  syncModuleNodes,
  type Schematic,
  type SchematicError,
  type SchematicNode,
  type TerminalRef,
  type TerminalsOfNode,
  type Wire,
} from '../schematic/model';
import { CONDUCTORS, type Conductor } from '../library/types';
import type { Project } from '../project';
import { Camera, type Bounds, type Point } from '../view/Camera';
import { drawConductorDot, strokeConductor } from '../view/conductorDraw';
import { theme } from '../view/theme';
import { LEVER_COLORS } from '../view/render';
import type { Session } from './session';
import type { View } from './view';

const GRID = 10;
const MIN_LABEL_FONT = 8;
const WIRE_HIT_TOLERANCE = 6;
/** Screen pixels the pointer has to move before a pressed wire starts to move, and the reach of the snap. */
const WIRE_DRAG_START_PX = 4;
const SNAP_PX = 6;
const GUIDE_COLOR = '#38bdf8';
const GRIP_PX = 4;
const COMB_LINK_OFFSET = 10;
const COMB_LINK_LANE = 5;

export type FreeNodePreset = keyof typeof FREE_NODE_PRESETS;

const ERROR_TEXT: Record<SchematicError['kind'], string> = {
  'unknown-node': 'Unknown node.',
  'unknown-terminal': 'Unknown terminal.',
  'unknown-wire': 'Unknown wire.',
  'same-terminal': 'A terminal cannot be wired to itself.',
  'duplicate-wire': 'These terminals are already wired.',
  'incompatible-conductors': 'Phase, neutral, earth and control conductors cannot be wired to each other.',
  'nothing-to-connect': 'No matching terminals to wire between these nodes.',
  'invalid-label': 'Labels are 1 to 60 characters, without line breaks.',
  'not-a-free-node': 'Only a source or a load has conductors of its own.',
  'invalid-conductors': 'A source or load needs at least one conductor, each used once.',
  'not-a-load': 'Only a load has a power.',
  'not-a-source': 'Only a source can be switched off.',
  'invalid-load': 'The load data is out of range.',
  'invalid-section': 'That cross-section is not in the table.',
  'invalid-route': 'That route cannot be used.',
};
const COLORS = {
  selection: '#f5c518',
  orphan: '#ef4444',
  text: '#14161d',
  valid: '#22c55e',
  invalid: '#ef4444',
  dead: '#9ca3af',
};
const DEAD_WIRE_DASH = [3, 5];
const DEAD_NODE_ALPHA = 0.45;
const NODE_FILL = { module: '#e5e7eb', source: '#f5c518', load: '#a7f3d0' } as const;

const TERMINAL_LABEL_WIDTH = 24;

function fitToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let shortened = text;
  while (shortened.length > 1 && ctx.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
  return `${shortened}…`;
}

const snap = (v: number) => Math.round(v / GRID) * GRID;

interface Frame {
  schematic: Schematic;
  terminalsOf: TerminalsOfNode;
  layout: Layout;
}

export class SchematicView implements View {
  readonly camera = new Camera();
  private moving: { id: string; dx: number; dy: number; x: number; y: number } | null = null;
  private wiring: { from: TerminalRef; cursor: Point } | null = null;
  private bundle: { from: string; cursor: Point } | null = null;
  /** A wire being pulled by one of its pieces; it starts to move only after the pointer has gone a few pixels. */
  private wireDrag: {
    wireId: string;
    a: Endpoint;
    b: Endpoint;
    drag: WireDrag;
    downAt: Point;
    started: boolean;
    lanes: Lanes;
    targets: Record<'x' | 'y', SnapTarget[]>;
    guide: { axis: 'x' | 'y'; value: number } | null;
  } | null = null;
  /** The piece of a wire under the pointer, for the cursor and the highlight. */
  private hover: { wireId: string; segment: Segment } | null = null;
  /** While on, dragging from a node wires all its poles to the node it is dropped on, as Shift does. */
  bundleMode = false;

  constructor(private readonly session: Session) {}

  fitBounds(): Bounds {
    return schematicBounds(this.frame().layout);
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme().background;
    ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2 - this.camera.x * this.camera.scale, height / 2 - this.camera.y * this.camera.scale);
    ctx.scale(this.camera.scale, this.camera.scale);

    const frame = this.frame();
    const { wireId, nodeId, placementId } = this.session.selection;
    this.drawCombLinks(ctx, frame);
    const routes = routeWires(frame.schematic, frame.layout);
    const { currents, power } = this.analysis();
    for (const wire of frame.schematic.wires) {
      const path = routes.get(wire.id);
      const conductor = portOf(frame.layout, wire.a)?.terminal.conductor;
      if (!path || !conductor) continue;
      const dead = power.deadWires.has(wire.id);
      if (wire.id === wireId || dead) this.strokePath(ctx, path, wire.id === wireId ? COLORS.selection : COLORS.dead, 2.5, dead ? DEAD_WIRE_DASH : undefined);
      else strokeConductor(ctx, path, conductor, 2.5);
    }
    this.drawWireEditing(ctx, frame, routes);
    for (const { node } of frame.layout.values()) {
      const selected = node.id === nodeId || (node.placementId !== undefined && node.placementId === placementId);
      const dead = power.deadNodes.has(node.id);
      if (dead) {
        ctx.save();
        ctx.globalAlpha = DEAD_NODE_ALPHA;
      }
      this.drawNode(ctx, frame, node, selected);
      if (dead) ctx.restore();
    }
    // Drawn after the nodes so that a label whose midpoint falls on a node is not half hidden by it.
    for (const wire of frame.schematic.wires) {
      const path = routes.get(wire.id);
      const amps = currents.get(wire.id);
      const text = [wire.label, amps === undefined ? undefined : `${formatAmps(amps)} A`].filter(Boolean).join(' \u00b7 ');
      if (path && text) this.drawWireLabel(ctx, text, pathMidpoint(path));
    }
    this.drawPreview(ctx, frame);
  }

  pointerDown(e: PointerEvent, world: Point): boolean {
    const frame = this.frame();
    const portHit = hitPort(frame.schematic, frame.layout, world);
    if (portHit) {
      this.wiring = { from: { node: portHit.node.id, terminal: portHit.port.terminal.id }, cursor: world };
      this.selectNode(portHit.node);
      return true;
    }
    const node = hitNode(frame.schematic, frame.layout, world);
    if (node && (e.shiftKey || this.bundleMode)) {
      this.bundle = { from: node.id, cursor: world };
      this.selectNode(node);
      return true;
    }
    if (node) {
      this.moving = { id: node.id, dx: world.x - node.x, dy: world.y - node.y, x: node.x, y: node.y };
      this.selectNode(node);
      return true;
    }
    const routes = routeWires(frame.schematic, frame.layout);
    const wire = hitWire(frame.schematic, routes, world, this.reach(WIRE_HIT_TOLERANCE));
    this.session.select(wire ? { wireId: wire.id } : {});
    if (wire) this.prepareWireDrag(frame, routes, wire, world);
    return wire !== undefined;
  }

  /** The highlight of the wire under the pointer, the grips of the selected wire, and the guide while a piece is pulled. */
  private drawWireEditing(ctx: CanvasRenderingContext2D, frame: Frame, routes: Map<string, Point[]>): void {
    const px = 1 / this.camera.scale;
    const { wireId } = this.session.selection;
    const hovered = this.hover && this.hover.wireId !== wireId ? routes.get(this.hover.wireId) : undefined;
    if (hovered) this.strokePath(ctx, hovered, 'rgba(255, 255, 255, 0.28)', 5.5);
    const selected = wireId ? routes.get(wireId) : undefined;
    if (selected) {
      ctx.save();
      const segments = segmentsOf(selected);
      for (const segment of segments) {
        const x = (segment.a.x + segment.b.x) / 2;
        const y = (segment.a.y + segment.b.y) / 2;
        const atTerminal = segment.index === 0 || segment.index === segments.length - 1;
        const size = (atTerminal ? GRIP_PX - 1 : GRIP_PX) * px;
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = '#14161d';
        ctx.fillStyle = atTerminal ? '#14161d' : COLORS.selection;
        ctx.beginPath();
        ctx.rect(x - size, y - size, size * 2, size * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    const guide = this.wireDrag?.started ? this.wireDrag.guide : null;
    if (guide) {
      const bounds = schematicBounds(frame.layout);
      ctx.save();
      ctx.strokeStyle = GUIDE_COLOR;
      ctx.lineWidth = px;
      ctx.setLineDash([6 * px, 5 * px]);
      ctx.beginPath();
      if (guide.axis === 'x') {
        ctx.moveTo(guide.value, bounds.minY - 100);
        ctx.lineTo(guide.value, bounds.maxY + 100);
      } else {
        ctx.moveTo(bounds.minX - 100, guide.value);
        ctx.lineTo(bounds.maxX + 100, guide.value);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Hit and snap distances are given in screen pixels, so they feel the same at any zoom. */
  private reach(pixels: number): number {
    return pixels / this.camera.scale;
  }

  private prepareWireDrag(frame: Frame, routes: Map<string, Point[]>, wire: Wire, world: Point): void {
    const path = routes.get(wire.id);
    const ends = this.endpointsOf(frame, wire);
    const segment = path && hitSegment(path, world, this.reach(WIRE_HIT_TOLERANCE));
    if (!path || !ends || !segment) return;
    const drag = beginDrag(ends.a, ends.b, path, segment, world, wire.route);
    const others = new Set([wire.id]);
    this.wireDrag = {
      wireId: wire.id,
      ...ends,
      drag,
      downAt: world,
      started: false,
      lanes: drag.lanes,
      targets: { x: laneTargets('x', frame.layout, routes, others), y: laneTargets('y', frame.layout, routes, others) },
      guide: null,
    };
  }

  private endpointsOf(frame: Frame, wire: Wire): { a: Endpoint; b: Endpoint } | undefined {
    const a = portOf(frame.layout, wire.a);
    const b = portOf(frame.layout, wire.b);
    return a && b ? { a: { point: a.point, side: a.terminal.side }, b: { point: b.point, side: b.terminal.side } } : undefined;
  }

  /** What the pointer would do at this place: pull a piece of a wire sideways or up and down. */
  cursorAt(world: Point): string | undefined {
    if (this.wireDrag?.started) return this.wireDrag.drag.kind === 'lane' && !this.wireDrag.drag.vertical ? 'ns-resize' : 'ew-resize';
    if (this.moving || this.wiring || this.bundle) return undefined;
    const frame = this.frame();
    if (hitPort(frame.schematic, frame.layout, world) || hitNode(frame.schematic, frame.layout, world)) return undefined;
    return this.hover ? (this.hover.segment.vertical ? 'ew-resize' : 'ns-resize') : undefined;
  }

  /** Puts a wire drag in progress back as it was. Returns whether there was one. */
  cancel(): boolean {
    if (!this.wireDrag?.started) return false;
    this.wireDrag = null;
    this.session.changed();
    return true;
  }

  private updateHover(world: Point): void {
    const frame = this.frame();
    const overNode = hitPort(frame.schematic, frame.layout, world) || hitNode(frame.schematic, frame.layout, world);
    const routes = routeWires(frame.schematic, frame.layout);
    const wire = overNode ? undefined : hitWire(frame.schematic, routes, world, this.reach(WIRE_HIT_TOLERANCE));
    const path = wire && routes.get(wire.id);
    const segment = path && hitSegment(path, world, this.reach(WIRE_HIT_TOLERANCE));
    const next = wire && segment ? { wireId: wire.id, segment } : null;
    const same = this.hover?.wireId === next?.wireId && this.hover?.segment.index === next?.segment.index;
    this.hover = next;
    this.session.hoverWireId = next?.wireId ?? null;
    if (!same) this.session.changed();
  }

  pointerMove(_e: PointerEvent, world: Point): void {
    const pulled = this.wireDrag;
    if (pulled) {
      if (!pulled.started && Math.hypot(world.x - pulled.downAt.x, world.y - pulled.downAt.y) < this.reach(WIRE_DRAG_START_PX)) return;
      pulled.started = true;
      const tolerance = this.reach(SNAP_PX);
      pulled.guide = null;
      const snap = (value: number, axis: 'x' | 'y') => {
        const result = snapLane(value, pulled.targets[axis], tolerance);
        if (result.target && result.target.kind !== 'grid') pulled.guide = { axis, value: result.value };
        return result.value;
      };
      pulled.lanes = dragLanes(pulled.a, pulled.b, pulled.drag, world, snap);
      this.session.changed();
      return;
    }
    if (!this.wiring && !this.bundle && !this.moving) {
      this.updateHover(world);
      return;
    }
    if (this.wiring) this.wiring.cursor = world;
    else if (this.bundle) this.bundle.cursor = world;
    else if (this.moving) {
      this.moving.x = snap(world.x - this.moving.dx);
      this.moving.y = snap(world.y - this.moving.dy);
    } else return;
    this.session.changed();
  }

  pointerUp(_e: PointerEvent, world: Point): void {
    const pulled = this.wireDrag;
    this.wireDrag = null;
    if (pulled?.started) {
      const changed = pulled.lanes.length !== pulled.drag.lanes.length || pulled.lanes.some((v, i) => Math.abs(v - pulled.drag.lanes[i]!) > 1e-6);
      const { project } = this.session;
      const result = changed ? setWireRoute(project.schematic, pulled.wireId, pulled.lanes) : null;
      if (result?.ok) this.session.commit({ ...project, schematic: result.schematic });
      this.session.changed();
      return;
    }
    const { wiring, bundle, moving } = this;
    this.wiring = null;
    this.bundle = null;
    this.moving = null;
    const project = this.session.project;
    const frame = this.frame();
    const commit = (schematic: Schematic) => this.session.commit({ ...project, schematic });

    if (wiring) {
      const target = hitPort(frame.schematic, frame.layout, world);
      const to = target && { node: target.node.id, terminal: target.port.terminal.id };
      if (to && (to.node !== wiring.from.node || to.terminal !== wiring.from.terminal)) {
        const result = connect(frame.schematic, frame.terminalsOf, wiring.from, to);
        if (result.ok) commit(result.schematic);
        else this.session.notify(ERROR_TEXT[result.error.kind], true);
      }
    } else if (bundle) {
      const target = hitNode(frame.schematic, frame.layout, world);
      if (target && target.id !== bundle.from) {
        const result = connectAll(frame.schematic, frame.terminalsOf, bundle.from, target.id);
        if (result.ok) {
          commit(result.schematic);
          this.session.notify(`Wired ${result.added} conductor${result.added === 1 ? '' : 's'}.`);
        } else {
          this.session.notify(ERROR_TEXT[result.error.kind], true);
        }
      }
    } else if (moving) {
      const original = project.schematic.nodes.find((n) => n.id === moving.id);
      if (original && (original.x !== moving.x || original.y !== moving.y)) {
        const result = moveNode(project.schematic, moving.id, moving.x, moving.y);
        if (result.ok) commit(result.schematic);
      }
    }
    this.session.changed();
  }

  deleteSelection(): void {
    const { nodeId, wireId } = this.session.selection;
    const { schematic } = this.session.project;
    const result = nodeId ? removeNode(schematic, nodeId) : wireId ? removeWire(schematic, wireId) : null;
    if (result?.ok) this.session.commit({ ...this.session.project, schematic: result.schematic });
    this.session.select({});
  }

  addFreeNode(preset: FreeNodePreset): void {
    const { kind, label, conductors } = FREE_NODE_PRESETS[preset];
    const project = this.session.project;
    const prototype = { kind, label, conductors: [...conductors] };
    const spot = freeSpot(this.frame().layout, prototype, { x: snap(this.camera.x), y: snap(this.camera.y) });
    const { schematic, node } = addNode(project.schematic, { ...prototype, ...spot });
    this.session.commit({ ...project, schematic });
    this.selectNode(node);
  }

  /** Moves apart the wires that lie on top of each other, in one undoable step. */
  spreadWires(): void {
    const project = this.session.project;
    const frame = this.frame();
    const paths = routeWires(frame.schematic, frame.layout);
    const ends = new Map<string, { a: Endpoint; b: Endpoint }>();
    for (const wire of frame.schematic.wires) {
      const e = this.endpointsOf(frame, wire);
      if (e) ends.set(wire.id, e);
    }
    const { routes, remaining } = spreadOverlaps(paths, ends);
    if (routes.size === 0) {
      this.session.notify(remaining === 0 ? 'No wires lie on top of each other.' : `${remaining} overlaps could not be separated.`, remaining > 0);
      return;
    }
    let schematic = project.schematic;
    for (const [id, lanes] of routes) {
      const result = setWireRoute(schematic, id, lanes);
      if (result.ok) schematic = result.schematic;
    }
    this.session.commit({ ...project, schematic });
    const moved = `Moved ${routes.size} wire${routes.size === 1 ? '' : 's'} apart.`;
    this.session.notify(remaining > 0 ? `${moved} ${remaining} overlaps are left; move those wires by hand.` : moved, remaining > 0);
  }

  routeAllAutomatically(): void {
    const project = this.session.project;
    const { schematic, cleared } = clearWireRoutes(project.schematic);
    if (cleared === 0) {
      this.session.notify('No wire has a route drawn by hand.');
      return;
    }
    this.session.commit({ ...project, schematic });
    this.session.notify(`Routed ${cleared} wire${cleared === 1 ? '' : 's'} automatically.`);
  }

  syncModules(): void {
    const project = this.session.project;
    const label = (ref: Parameters<Session['resolve']>[0]) => this.session.resolve(ref)?.name ?? ref.moduleId;
    const schematic = syncModuleNodes(project.schematic, project.panel, label);
    const added = schematic.nodes.length - project.schematic.nodes.length;
    if (added === 0) {
      this.session.notify('Every placed module already has a node.');
      return;
    }
    this.session.commit({ ...project, schematic });
    this.session.notify(`Added ${added} module node${added === 1 ? '' : 's'}.`);
  }

  private frame(): Frame {
    const { panel, schematic } = this.session.project;
    const terminalsOf = nodeTerminalsLookup(panel, this.session.resolve);
    const moving = this.moving;
    const dragged = this.wireDrag?.started ? this.wireDrag : null;
    const withNode: Schematic = moving
      ? { ...schematic, nodes: schematic.nodes.map((n) => (n.id === moving.id ? { ...n, x: moving.x, y: moving.y } : n)) }
      : schematic;
    const shown: Schematic = dragged
      ? { ...withNode, wires: withNode.wires.map((w) => (w.id === dragged.wireId ? { ...w, route: dragged.lanes } : w)) }
      : withNode;
    return { schematic: shown, terminalsOf, layout: computeLayout(shown, terminalsOf) };
  }

  private selectNode(node: SchematicNode): void {
    this.session.select({ nodeId: node.id, ...(node.placementId ? { placementId: node.placementId } : {}) });
  }

  private strokePath(ctx: CanvasRenderingContext2D, path: Point[], color: string, width: number, dash: number[] = []): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash);
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Comb contacts have no wires of their own; show the terminals each comb pin ties together. */
  private drawCombLinks(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const { panel } = this.session.project;
    const groups = new Map<string, { pin: Conductor; points: Array<{ point: Point; dir: number }> }>();
    for (const contact of combContacts(panel, this.session.resolve)) {
      const node = frame.schematic.nodes.find((n) => n.placementId === contact.placementId);
      const port = node && portOf(frame.layout, { node: node.id, terminal: contact.terminalId });
      if (!port) continue;
      const key = `${contact.combId}/${contact.pin}`;
      const group = groups.get(key) ?? { pin: contact.pin, points: [] };
      group.points.push({ point: port.point, dir: port.terminal.side === 'top' ? -1 : 1 });
      groups.set(key, group);
    }
    for (const { pin, points } of groups.values()) {
      const sorted = [...points].sort((a, b) => a.point.x - b.point.x);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1]!;
        const b = sorted[i]!;
        const lane = COMB_LINK_OFFSET + CONDUCTORS.indexOf(pin) * COMB_LINK_LANE;
        const y = (a.dir === 1 ? Math.max : Math.min)(a.point.y, b.point.y) + a.dir * lane;
        strokeConductor(ctx, [a.point, { x: a.point.x, y }, { x: b.point.x, y }, b.point], pin, 2, [5, 4]);
      }
    }
  }

  private drawPreview(ctx: CanvasRenderingContext2D, frame: Frame): void {
    if (this.wiring) {
      const from = portOf(frame.layout, this.wiring.from);
      if (!from) return;
      const target = hitPort(frame.schematic, frame.layout, this.wiring.cursor);
      let color: string = COLORS.selection;
      if (target) {
        const to = { node: target.node.id, terminal: target.port.terminal.id };
        color = connect(frame.schematic, frame.terminalsOf, this.wiring.from, to).ok ? COLORS.valid : COLORS.invalid;
        ctx.beginPath();
        ctx.arc(target.port.point.x, target.port.point.y, PORT_RADIUS + 3, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      this.strokePath(ctx, [from.point, target?.port.point ?? this.wiring.cursor], color, 2, [6, 4]);
    } else if (this.bundle) {
      const target = hitNode(frame.schematic, frame.layout, this.bundle.cursor);
      const from = frame.layout.get(this.bundle.from)?.rect;
      if (!from) return;
      const to = target && target.id !== this.bundle.from ? frame.layout.get(target.id)?.rect : undefined;
      const end = to ? { x: to.x + to.width / 2, y: to.y + to.height / 2 } : this.bundle.cursor;
      this.strokePath(ctx, [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }, end], COLORS.selection, 3, [8, 5]);
    }
  }

  private analysisCache?: {
    project: Project;
    snapshot: Session['snapshot'];
    libraries: Session['libraries'];
    value: { currents: Map<string, number>; power: Energy };
  };

  /** Currents and voltage are worth recomputing only when the project, its modules or the libraries changed. */
  private analysis(): { currents: Map<string, number>; power: Energy } {
    const { project, snapshot, libraries } = this.session;
    const cached = this.analysisCache;
    if (cached && cached.project === project && cached.snapshot === snapshot && cached.libraries === libraries) return cached.value;
    const value = { currents: wireCurrents(project, this.session.resolve), power: energy(project, this.session.resolve) };
    this.analysisCache = { project, snapshot, libraries, value };
    return value;
  }

  private drawWireLabel(ctx: CanvasRenderingContext2D, text: string, at: Point): void {
    ctx.save();
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 8;
    ctx.fillStyle = theme().wireLabelBackground;
    ctx.fillRect(at.x - width / 2, at.y - 7, width, 14);
    ctx.fillStyle = theme().wireLabelText;
    ctx.fillText(text, at.x, at.y);
    ctx.restore();
  }

  private drawNode(ctx: CanvasRenderingContext2D, frame: Frame, node: SchematicNode, selected: boolean): void {
    const layout = frame.layout.get(node.id);
    if (!layout) return;
    const r = layout.rect;
    const { panel } = this.session.project;
    const placement = node.kind === 'module' ? panel.placements.find((p) => p.id === node.placementId) : undefined;
    const shelved = node.kind === 'module' ? panel.shelf.find((s) => s.id === node.placementId) : undefined;
    const def = placement && this.session.resolve(placement.module);
    const orphan = node.kind === 'module' && !placement;

    ctx.fillStyle = NODE_FILL[node.kind];
    ctx.fillRect(r.x, r.y, r.width, r.height);
    if (def) {
      ctx.fillStyle = LEVER_COLORS[def.kind];
      ctx.fillRect(r.x, r.y, 6, r.height);
    }
    ctx.strokeStyle = selected ? COLORS.selection : orphan ? COLORS.orphan : '#6b7280';
    ctx.lineWidth = selected || orphan ? 3 : 1;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x + 8, r.y, r.width - 10, r.height);
    ctx.clip();
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = orphan
      ? `${shelved?.label ?? node.label} (${shelved ? 'on the shelf' : 'missing'})`
      : (placement?.label ?? node.label);
    let fontSize = 12;
    ctx.font = `${fontSize}px sans-serif`;
    while (fontSize > MIN_LABEL_FONT && ctx.measureText(label).width > r.width - 16) {
      fontSize -= 1;
      ctx.font = `${fontSize}px sans-serif`;
    }
    ctx.fillText(label, r.x + r.width / 2 + 3, r.y + r.height / 2);
    ctx.font = '8px sans-serif';
    for (const { terminal, point } of layout.ports) {
      const custom = placement?.terminalLabels?.[terminal.id];
      ctx.fillText(custom ? fitToWidth(ctx, custom, TERMINAL_LABEL_WIDTH) : terminal.name, point.x, point.y + (terminal.side === 'top' ? 9 : -9));
    }
    ctx.restore();

    for (const { terminal, point } of layout.ports) {
      drawConductorDot(ctx, point.x, point.y, PORT_RADIUS - 1, terminal.conductor, 1.5);
    }
  }
}
