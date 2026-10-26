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
  type Layout,
} from '../schematic/geometry';
import { routeWires } from '../schematic/router';
import {
  addNode,
  connect,
  connectAll,
  moveNode,
  removeNode,
  removeWire,
  syncModuleNodes,
  type Schematic,
  type SchematicError,
  type SchematicNode,
  type TerminalRef,
  type TerminalsOfNode,
} from '../schematic/model';
import { CONDUCTORS, type Conductor } from '../library/types';
import type { Project } from '../project';
import { Camera, type Bounds, type Point } from '../view/Camera';
import { theme } from '../view/theme';
import { LEVER_COLORS } from '../view/render';
import type { Session } from './session';
import type { View } from './view';

const GRID = 10;
const MIN_LABEL_FONT = 8;
const WIRE_HIT_TOLERANCE = 6;
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
  'invalid-load': 'The load data is out of range.',
  'invalid-section': 'That cross-section is not in the table.',
};
const COLORS = {
  selection: '#f5c518',
  orphan: '#ef4444',
  text: '#14161d',
  valid: '#22c55e',
  invalid: '#ef4444',
};
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
    for (const wire of frame.schematic.wires) {
      const path = routes.get(wire.id);
      const conductor = portOf(frame.layout, wire.a)?.terminal.conductor;
      if (path && conductor) this.strokePath(ctx, path, wire.id === wireId ? COLORS.selection : theme().conductors[conductor], 2.5);
    }
    const currents = this.currents();
    for (const wire of frame.schematic.wires) {
      const path = routes.get(wire.id);
      const amps = currents.get(wire.id);
      const text = [wire.label, amps === undefined ? undefined : `${formatAmps(amps)} A`].filter(Boolean).join(' \u00b7 ');
      if (path && text) this.drawWireLabel(ctx, text, pathMidpoint(path));
    }
    for (const { node } of frame.layout.values()) {
      const selected = node.id === nodeId || (node.placementId !== undefined && node.placementId === placementId);
      this.drawNode(ctx, frame, node, selected);
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
    const wire = hitWire(frame.schematic, routeWires(frame.schematic, frame.layout), world, WIRE_HIT_TOLERANCE);
    this.session.select(wire ? { wireId: wire.id } : {});
    return wire !== undefined;
  }

  pointerMove(_e: PointerEvent, world: Point): void {
    if (this.wiring) this.wiring.cursor = world;
    else if (this.bundle) this.bundle.cursor = world;
    else if (this.moving) {
      this.moving.x = snap(world.x - this.moving.dx);
      this.moving.y = snap(world.y - this.moving.dy);
    } else return;
    this.session.changed();
  }

  pointerUp(_e: PointerEvent, world: Point): void {
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
    const shown: Schematic = moving
      ? { ...schematic, nodes: schematic.nodes.map((n) => (n.id === moving.id ? { ...n, x: moving.x, y: moving.y } : n)) }
      : schematic;
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
        this.strokePath(ctx, [a.point, { x: a.point.x, y }, { x: b.point.x, y }, b.point], theme().conductors[pin], 2, [5, 4]);
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

  private currentsCache?: { project: Project; snapshot: Session['snapshot']; libraries: Session['libraries']; value: Map<string, number> };

  /** Wire currents are worth recomputing only when the project, its modules or the libraries changed. */
  private currents(): Map<string, number> {
    const { project, snapshot, libraries } = this.session;
    const cached = this.currentsCache;
    if (cached && cached.project === project && cached.snapshot === snapshot && cached.libraries === libraries) return cached.value;
    const value = wireCurrents(project, this.session.resolve);
    this.currentsCache = { project, snapshot, libraries, value };
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
      ctx.beginPath();
      ctx.arc(point.x, point.y, PORT_RADIUS - 1, 0, Math.PI * 2);
      ctx.fillStyle = theme().conductors[terminal.conductor];
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#14161d';
      ctx.stroke();
    }
  }
}
