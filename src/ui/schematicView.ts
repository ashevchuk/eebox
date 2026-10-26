import {
  addNode,
  connect,
  moveNode,
  removeNode,
  removeWire,
  syncModuleNodes,
  type NodeKind,
  type Schematic,
  type SchematicError,
  type SchematicNode,
} from '../schematic/model';
import {
  PORT_RADIUS,
  freeSpot,
  hitNode,
  hitOutPort,
  hitWire,
  inPort,
  nodeRect,
  outPort,
  schematicBounds,
  wireEndpoints,
  wirePath,
} from '../schematic/geometry';
import { Camera, type Bounds, type Point } from '../view/Camera';
import { LEVER_COLORS } from '../view/render';
import type { Session } from './session';
import type { View } from './view';

const GRID = 10;
const MIN_LABEL_FONT = 8;
const WIRE_HIT_TOLERANCE = 6;
const FREE_NODE_LABELS: Record<Exclude<NodeKind, 'module'>, string> = {
  source: 'Source',
  busbar: 'Busbar',
  load: 'Load',
};
const NODE_COLORS: Record<Exclude<NodeKind, 'module'>, string> = {
  source: '#f5c518',
  busbar: '#9aa1b3',
  load: '#e5e7eb',
};
const ERROR_TEXT: Record<SchematicError['kind'], string> = {
  'unknown-node': 'Unknown node.',
  'unknown-wire': 'Unknown wire.',
  'self-loop': 'A node cannot feed itself.',
  'duplicate-wire': 'These nodes are already connected.',
  'invalid-direction': 'Wires run from supply to consumer: nothing feeds a source, and a load feeds nothing.',
};
const COLORS = {
  background: '#0b0c10',
  wire: '#9aa1b3',
  selection: '#f5c518',
  orphan: '#ef4444',
  text: '#14161d',
};

const snap = (v: number) => Math.round(v / GRID) * GRID;

export class SchematicView implements View {
  readonly camera = new Camera();
  private moving: { id: string; dx: number; dy: number; x: number; y: number } | null = null;
  private wiring: { from: string; cursor: Point } | null = null;

  constructor(private readonly session: Session) {}

  fitBounds(): Bounds {
    return schematicBounds(this.session.project.schematic);
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2 - this.camera.x * this.camera.scale, height / 2 - this.camera.y * this.camera.scale);
    ctx.scale(this.camera.scale, this.camera.scale);

    const schematic = this.shown();
    const { wireId, nodeId, placementId } = this.session.selection;
    for (const wire of schematic.wires) {
      const ends = wireEndpoints(schematic, wire);
      if (!ends) continue;
      this.strokePath(ctx, wirePath(outPort(ends[0]), inPort(ends[1])), wire.id === wireId ? COLORS.selection : COLORS.wire);
    }
    for (const node of schematic.nodes) {
      const selected = node.id === nodeId || (node.placementId !== undefined && node.placementId === placementId);
      this.drawNode(ctx, node, selected);
    }
    if (this.wiring) {
      const from = schematic.nodes.find((n) => n.id === this.wiring?.from);
      if (from) this.strokePath(ctx, [outPort(from), this.wiring.cursor], COLORS.selection);
    }
  }

  pointerDown(_e: PointerEvent, world: Point): boolean {
    const schematic = this.session.project.schematic;
    const port = hitOutPort(schematic, world);
    if (port) {
      this.wiring = { from: port.id, cursor: world };
      this.selectNode(port);
      return true;
    }
    const node = hitNode(schematic, world);
    if (node) {
      this.moving = { id: node.id, dx: world.x - node.x, dy: world.y - node.y, x: node.x, y: node.y };
      this.selectNode(node);
      return true;
    }
    const wire = hitWire(schematic, world, WIRE_HIT_TOLERANCE);
    this.session.select(wire ? { wireId: wire.id } : {});
    return wire !== undefined;
  }

  pointerMove(_e: PointerEvent, world: Point): void {
    if (this.wiring) {
      this.wiring.cursor = world;
      this.session.changed();
    } else if (this.moving) {
      this.moving.x = snap(world.x - this.moving.dx);
      this.moving.y = snap(world.y - this.moving.dy);
      this.session.changed();
    }
  }

  pointerUp(_e: PointerEvent, world: Point): void {
    const { wiring, moving } = this;
    this.wiring = null;
    this.moving = null;
    const project = this.session.project;
    if (wiring) {
      const target = hitNode(project.schematic, world);
      if (target && target.id !== wiring.from) {
        const result = connect(project.schematic, wiring.from, target.id);
        if (result.ok) this.session.commit({ ...project, schematic: result.schematic });
        else this.session.notify(ERROR_TEXT[result.error.kind], true);
      }
    } else if (moving) {
      const original = project.schematic.nodes.find((n) => n.id === moving.id);
      if (original && (original.x !== moving.x || original.y !== moving.y)) {
        const result = moveNode(project.schematic, moving.id, moving.x, moving.y);
        if (result.ok) this.session.commit({ ...project, schematic: result.schematic });
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

  addFreeNode(kind: Exclude<NodeKind, 'module'>): void {
    const project = this.session.project;
    const spot = freeSpot(project.schematic, kind, { x: snap(this.camera.x), y: snap(this.camera.y) });
    const { schematic, node } = addNode(project.schematic, { kind, label: FREE_NODE_LABELS[kind], ...spot });
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

  private shown(): Schematic {
    const { schematic } = this.session.project;
    const moving = this.moving;
    if (!moving) return schematic;
    return {
      ...schematic,
      nodes: schematic.nodes.map((n) => (n.id === moving.id ? { ...n, x: moving.x, y: moving.y } : n)),
    };
  }

  private selectNode(node: SchematicNode): void {
    this.session.select({ nodeId: node.id, ...(node.placementId ? { placementId: node.placementId } : {}) });
  }

  private strokePath(ctx: CanvasRenderingContext2D, path: Point[], color: string): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }

  private drawNode(ctx: CanvasRenderingContext2D, node: SchematicNode, selected: boolean): void {
    const r = nodeRect(node);
    const placement =
      node.kind === 'module' ? this.session.project.panel.placements.find((p) => p.id === node.placementId) : undefined;
    const def = placement && this.session.resolve(placement.module);
    const orphan = node.kind === 'module' && !placement;

    ctx.fillStyle = node.kind === 'module' ? '#e5e7eb' : NODE_COLORS[node.kind];
    ctx.fillRect(r.x, r.y, r.width, r.height);
    if (def) {
      ctx.fillStyle = LEVER_COLORS[def.kind];
      ctx.fillRect(r.x, r.y, 8, r.height);
    }
    ctx.strokeStyle = selected ? COLORS.selection : orphan ? COLORS.orphan : '#6b7280';
    ctx.lineWidth = selected || orphan ? 3 : 1;
    ctx.strokeRect(r.x, r.y, r.width, r.height);

    if (node.kind !== 'busbar') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 10, r.y, r.width - 12, r.height);
      ctx.clip();
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = orphan ? `${node.label} (missing)` : node.label;
      let fontSize = 12;
      ctx.font = `${fontSize}px sans-serif`;
      while (fontSize > MIN_LABEL_FONT && ctx.measureText(label).width > r.width - 14) {
        fontSize -= 1;
        ctx.font = `${fontSize}px sans-serif`;
      }
      ctx.fillText(label, r.x + r.width / 2 + 4, r.y + r.height / 2);
      ctx.restore();
    }

    ctx.fillStyle = '#14161d';
    ctx.strokeStyle = COLORS.wire;
    ctx.lineWidth = 1.5;
    const ports = [node.kind !== 'source' ? inPort(node) : null, node.kind !== 'load' ? outPort(node) : null];
    for (const port of ports) {
      if (!port) continue;
      ctx.beginPath();
      ctx.arc(port.x, port.y, PORT_RADIUS - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
