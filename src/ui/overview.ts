import { nodeTerminalsLookup } from '../electrical/nodeTerminals';
import type { Resolve } from '../electrical/context';
import type { Project } from '../project';
import { computeLayout, schematicBounds, boundsWithRoutes } from '../schematic/geometry';
import { routeWires } from '../schematic/router';
import type { Bounds, Point } from '../view/Camera';
import { combRect, frameRect, moduleRect } from '../view/geometry';
import type { Mode } from './session';

export interface OverviewBox {
  box: Bounds;
  color: string;
}

/** The whole drawing in few shapes, for the map in the corner. */
export interface Overview {
  bounds: Bounds;
  boxes: OverviewBox[];
  paths: Point[][];
}

const MODULE_COLOR = '#94a3b8';
const COMB_COLOR = '#f59e0b';
const NODE_COLOR = '#cbd5e1';
const SOURCE_COLOR = '#facc15';
const LOAD_COLOR = '#86efac';

const boxOf = (r: { x: number; y: number; width: number; height: number }): Bounds => ({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height });

export function overviewOf(project: Project, resolve: Resolve, mode: Mode): Overview {
  if (mode === 'panel') {
    const { panel } = project;
    const widthOf = (item: { module: Parameters<Resolve>[0]; widthUnits?: number }) => item.widthUnits ?? resolve(item.module)?.widthUnits ?? 1;
    return {
      bounds: boxOf(frameRect(panel)),
      boxes: [
        ...panel.placements.map((p) => ({ box: boxOf(moduleRect(panel, p.rail, p.slot, widthOf(p))), color: MODULE_COLOR })),
        ...panel.combs.map((c) => ({ box: boxOf(combRect(panel, c.rail, c.slot, widthOf(c), resolve(c.module)?.comb?.side ?? 'top')), color: COMB_COLOR })),
      ],
      paths: [],
    };
  }
  const layout = computeLayout(project.schematic, nodeTerminalsLookup(project.panel, resolve));
  const routes = routeWires(project.schematic, layout);
  const kindOf = new Map(project.schematic.nodes.map((n) => [n.id, n.kind]));
  return {
    bounds: boundsWithRoutes(schematicBounds(layout), routes),
    boxes: [...layout].map(([id, item]) => ({
      box: boxOf(item.rect),
      color: kindOf.get(id) === 'source' ? SOURCE_COLOR : kindOf.get(id) === 'load' ? LOAD_COLOR : NODE_COLOR,
    })),
    paths: [...routes.values()],
  };
}
