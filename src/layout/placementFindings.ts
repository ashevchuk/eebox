import type { Finding } from '../electrical/problems';
import type { Resolve } from '../electrical/context';
import type { Project } from '../project';
import { FRAME_PADDING, ductRect, placementRect, railRect, type Rect } from '../view/geometry';
import { ductsOf } from './ducts';
import { scopeToPlate } from './plates';
import { VERTICAL_RAIL_KINDS, isVertical } from './rail';
import { isFree, isOnRail, type Panel, type Plate, type Sizes } from './placement';

/** Overlaps smaller than this are rounding, not two things on one place. */
const EPSILON_MM = 0.01;

interface Body {
  id: string;
  kind: 'device' | 'duct';
  name: string;
  rect: Rect;
  /** The rail the device clips on; none for a device on the plate and for a duct. */
  rail?: number;
}

const overlapsBy = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width - EPSILON_MM && b.x < a.x + a.width - EPSILON_MM && a.y < b.y + b.height - EPSILON_MM && b.y < a.y + a.height - EPSILON_MM;

/** The distance between two rectangles that do not overlap, along the line that joins their nearest points. */
export function gapBetween(a: Rect, b: Rect): number {
  const gapX = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gapY = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(gapX, gapY);
}

const round1 = (mm: number): number => Math.round(mm * 10) / 10;

const marking = (...bodies: Body[]): Pick<Finding, 'placements' | 'ducts'> => ({
  placements: bodies.filter((b) => b.kind === 'device').map((b) => b.id),
  ducts: bodies.filter((b) => b.kind === 'duct').map((b) => b.id),
});

/**
 * What is wrong with where things stand on the panel: two things on one place, a device on a rail it
 * was not made for or on the plate when it was made for a rail, a loose device or duct on a rail, and,
 * when a clearance is asked for, a loose device or duct that is closer to another thing than that.
 * Modules next to each other on one rail are the model's business and are not looked at here.
 */
export function findPlacementFindings(project: Project, sizes: Sizes, resolve: Resolve): Finding[] {
  return project.panel.plates.flatMap((plate) => {
    const { panel, offset } = scopeToPlate(project.panel, plate.id);
    return findOnPlate(panel, offset, plate, sizes, resolve);
  });
}

/** The same for what stands on one plate, which is looked at as a panel of its own: `offset` is the number of the first of its rows in the whole panel. */
function findOnPlate(panel: Panel, offset: number, plate: Plate, sizes: Sizes, resolve: Resolve): Finding[] {
  const bodies: Body[] = [
    ...panel.placements.map((p): Body => ({
      id: p.id,
      kind: 'device',
      name: p.label ?? resolve(p.module)?.name ?? p.id,
      rect: placementRect(panel, sizes, p),
      ...(isOnRail(p) ? { rail: p.rail } : {}),
    })),
    ...ductsOf(panel).map((d): Body => ({ id: d.id, kind: 'duct', name: `duct ${d.label ?? d.id}`, rect: ductRect(d) })),
  ];
  const findings: Finding[] = [];
  const add = (severity: Finding['severity'], message: string, ...marked: Body[]) =>
    findings.push({ message, severity, wires: [], nodes: [], ...marking(...marked) });

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const [a, b] = [bodies[i]!, bodies[j]!];
      if (a.kind === 'duct' && b.kind === 'duct') continue;
      if (a.rail !== undefined && a.rail === b.rail) continue;
      if (overlapsBy(a.rect, b.rect)) {
        add('error', `${a.name} (${a.id}) stands on ${b.name} (${b.id}).`, a, b);
        continue;
      }
      const loose = a.rail === undefined || b.rail === undefined;
      if (panel.clearanceMm !== undefined && loose) {
        const gap = gapBetween(a.rect, b.rect);
        if (gap < panel.clearanceMm) add('advice', `${a.name} (${a.id}) is ${round1(gap)} mm from ${b.name} (${b.id}), closer than the ${panel.clearanceMm} mm kept clear.`, a, b);
      }
    }
  }

  const rails = panel.rails.map((_r, rail) => ({ rail, rect: railRect(panel, rail) }));
  for (const body of bodies.filter((b) => b.rail === undefined)) {
    for (const { rail, rect } of rails) {
      if (overlapsBy(body.rect, rect)) add('advice', `${body.name} (${body.id}) stands on the rail of row ${rail + offset + 1}.`, body);
    }
  }

  const area: Rect = { x: FRAME_PADDING, y: FRAME_PADDING, width: plate.widthMm, height: plate.heightMm };
  const within = (r: Rect) => r.x >= area.x - EPSILON_MM && r.y >= area.y - EPSILON_MM && r.x + r.width <= area.x + area.width + EPSILON_MM && r.y + r.height <= area.y + area.height + EPSILON_MM;
  for (const body of bodies) if (!within(body.rect)) add('error', `${body.name} (${body.id}) reaches outside the plate ${plate.name}.`, body);
  rails.forEach(({ rail, rect }) => {
    if (!within(rect)) add('error', `The rail of row ${rail + offset + 1} reaches outside the plate ${plate.name}.`);
  });

  for (const placement of panel.placements) {
    const def = resolve(placement.module);
    const mounting = def?.mounting;
    const body = bodies.find((b) => b.id === placement.id)!;
    if (def && isOnRail(placement) && isVertical(panel.rails[placement.rail]) && !VERTICAL_RAIL_KINDS.includes(def.kind)) {
      add('advice', `${body.name} (${body.id}) is made for a horizontal rail, not for a vertical one.`, body);
    }
    if (mounting === 'plate' && isOnRail(placement)) add('advice', `${body.name} (${body.id}) is made for the plate, not for a rail.`, body);
    if (mounting === 'rail' && isFree(placement)) add('advice', `${body.name} (${body.id}) is made for a DIN rail, not for the plate.`, body);
  }
  return findings;
}
