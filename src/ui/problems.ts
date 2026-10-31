import { nodeTerminalsLookup } from '../electrical/nodeTerminals';
import type { Finding } from '../electrical/problems';
import type { Resolve } from '../electrical/context';
import type { Project } from '../project';
import { computeLayout } from '../schematic/geometry';
import { routeWires } from '../schematic/router';
import type { Bounds } from '../view/Camera';
import { lookupsOf } from '../layout/lookups';
import { ductsOf } from '../layout/ducts';
import { plateOfComb, plateOfPlacement, scopeToPlate } from '../layout/plates';
import { combRect, ductRect, placementRect } from '../view/geometry';
import { groupSelection } from './selection';
import type { Mode, Selection } from './session';

export interface ProblemEntry {
  message: string;
  /** A fault, advice, or a note that points at nothing on a drawing. */
  severity: 'error' | 'advice' | 'note';
  finding?: Finding;
}

/** What Check finds, faults first: each finding with what it marks, then the remarks that name no object. */
export function problemEntries(findings: readonly Finding[], warnings: readonly string[]): ProblemEntry[] {
  const known = new Set(findings.map((f) => f.message));
  const ranked = (f: Finding) => (f.severity === 'error' ? 0 : 1);
  return [
    ...[...findings].sort((a, b) => ranked(a) - ranked(b)).map((finding): ProblemEntry => ({ message: finding.message, severity: finding.severity, finding })),
    ...warnings.filter((message) => !known.has(message)).map((message): ProblemEntry => ({ message, severity: 'note' })),
  ];
}

/** Where to look to see a finding: the view, what to select there and the part of the drawing it is about. */
export interface Focus {
  mode: Mode;
  selection: Selection;
  bounds: Bounds;
}

const union = (boxes: Bounds[]): Bounds => ({
  minX: Math.min(...boxes.map((b) => b.minX)),
  minY: Math.min(...boxes.map((b) => b.minY)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  maxY: Math.max(...boxes.map((b) => b.maxY)),
});

/** Things of a drawing by id: what a finding is about, what is selected, what a search found. */
export interface Objects {
  placements: readonly string[];
  nodes: readonly string[];
  wires: readonly string[];
  combs?: readonly string[];
  ducts?: readonly string[];
}

function panelFocus(project: Project, resolve: Resolve, objects: Objects): Focus | undefined {
  const placements = project.panel.placements.filter((p) => objects.placements.includes(p.id));
  const combs = project.panel.combs.filter((c) => objects.combs?.includes(c.id));
  const ducts = ductsOf(project.panel).filter((d) => objects.ducts?.includes(d.id));
  if (placements.length + combs.length + ducts.length === 0) return undefined;
  // The things of a finding may stand on several plates; the view shows the plate of the first one, and only what is on it.
  const plate = (placements[0] ? plateOfPlacement(project.panel, placements[0]) : undefined) ?? (combs[0] ? plateOfComb(project.panel, combs[0]) : undefined) ?? ducts[0]?.plate;
  const scope = scopeToPlate(project.panel, plate ?? project.panel.plates[0]!.id);
  const onPlate = scope.panel;
  const { sizes, widthOf } = lookupsOf(resolve);
  const shownPlacements = onPlate.placements.filter((p) => placements.some((q) => q.id === p.id));
  const shownCombs = onPlate.combs.filter((c) => combs.some((q) => q.id === c.id));
  const boxes = [
    ...shownPlacements.map((p) => placementRect(onPlate, sizes, p)),
    ...shownCombs.map((c) => combRect(onPlate, c.rail, c.slot, widthOf(c) ?? 1, resolve(c.module)?.comb?.side ?? 'top')),
    ...ducts.filter((d) => d.plate === onPlate.plates[0]!.id).map(ductRect),
  ].map((r) => ({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height }));
  const selection: Selection =
    placements.length + combs.length + ducts.length === 1
      ? groupSelection(placements.map((p) => p.id), combs.map((c) => c.id), ducts.map((d) => d.id))
      : {
          ...(placements.length > 0 ? { placementIds: placements.map((p) => p.id) } : {}),
          ...(combs.length > 0 ? { combIds: combs.map((c) => c.id) } : {}),
          ...(ducts.length > 0 ? { ductIds: ducts.map((d) => d.id) } : {}),
        };
  return { mode: 'panel', selection, bounds: union(boxes) };
}

function schematicFocus(project: Project, resolve: Resolve, objects: Objects): Focus | undefined {
  const wires = project.schematic.wires.filter((w) => objects.wires.includes(w.id));
  const nodes = project.schematic.nodes.filter((n) => objects.nodes.includes(n.id));
  if (wires.length === 0 && nodes.length === 0) return undefined;
  const layout = computeLayout(project.schematic, nodeTerminalsLookup(project.panel, resolve));
  const routes = routeWires(project.schematic, layout);
  const boxes: Bounds[] = [];
  for (const wire of wires) {
    const path = routes.get(wire.id) ?? [];
    if (path.length > 0) boxes.push({ minX: Math.min(...path.map((p) => p.x)), minY: Math.min(...path.map((p) => p.y)), maxX: Math.max(...path.map((p) => p.x)), maxY: Math.max(...path.map((p) => p.y)) });
  }
  for (const node of nodes) {
    const r = layout.get(node.id)?.rect;
    if (r) boxes.push({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height });
  }
  if (boxes.length === 0) return undefined;
  const selection: Selection = wires.length === 1 ? { wireId: wires[0]!.id } : wires.length > 1 ? { wireIds: wires.map((w) => w.id) } : { nodeId: nodes[0]!.id };
  return { mode: 'schematic', selection, bounds: union(boxes) };
}

/**
 * Where a finding is to be shown: the view that is on if it has something of it, else the other one.
 * Wires and nodes are on the schematic, placed modules on the panel.
 */
export function focusOf(project: Project, resolve: Resolve, finding: Finding, current: Mode): Focus | undefined {
  return focusOfObjects(project, resolve, finding, current);
}

export function focusOfObjects(project: Project, resolve: Resolve, objects: Objects, current: Mode): Focus | undefined {
  const order: Mode[] = current === 'panel' ? ['panel', 'schematic'] : ['schematic', 'panel'];
  for (const mode of order) {
    const focus = mode === 'panel' ? panelFocus(project, resolve, objects) : schematicFocus(project, resolve, objects);
    if (focus) return focus;
  }
  return undefined;
}

/** What a selection holds, as objects to focus on. */
export function objectsOfSelection(selection: Selection): Objects {
  const placements = selection.placementIds ?? (selection.placementId ? [selection.placementId] : []);
  const combs = selection.combIds ?? (selection.combId ? [selection.combId] : []);
  const nodes = selection.nodeIds ?? (selection.nodeId ? [selection.nodeId] : []);
  const wires = selection.wireIds ?? (selection.wireId ? [selection.wireId] : []);
  const ducts = selection.ductIds ?? (selection.ductId ? [selection.ductId] : []);
  return { placements, combs, nodes, wires, ...(ducts.length > 0 ? { ducts } : {}) };
}
