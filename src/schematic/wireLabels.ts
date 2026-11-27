import type { Bounds, Point } from '../view/Camera';
import { pathPointAt, wireLabelBox, type Layout, type Rect } from './geometry';

export interface WireLabel {
  wireId: string;
  text: string;
  path: Point[];
}

/** Space kept between two label boxes, so that neighbouring labels read as two. */
const LABEL_GAP = 2;
/** Places tried along a wire, nearest the middle first: parallel wires have their middles side by side. */
const FRACTIONS = [0.5, ...Array.from({ length: 8 }, (_, i) => [0.5 - (i + 1) * 0.05, 0.5 + (i + 1) * 0.05]).flat()];

/** Side of a cell of the grid that boxes are filed in, so that a box is compared with its neighbours only. */
const CELL = 60;

const overlaps = (a: Bounds, b: Bounds, gap: number) => a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap;
const rectBounds = (r: Rect): Bounds => ({ minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height });

class BoxGrid {
  private readonly cells = new Map<string, Bounds[]>();

  constructor(private readonly gap: number) {}

  private keys(box: Bounds): string[] {
    const keys: string[] = [];
    for (let x = Math.floor((box.minX - this.gap) / CELL); x <= Math.floor((box.maxX + this.gap) / CELL); x++) {
      for (let y = Math.floor((box.minY - this.gap) / CELL); y <= Math.floor((box.maxY + this.gap) / CELL); y++) keys.push(`${x},${y}`);
    }
    return keys;
  }

  add(box: Bounds): void {
    for (const key of this.keys(box)) {
      const cell = this.cells.get(key);
      if (cell) cell.push(box);
      else this.cells.set(key, [box]);
    }
  }

  hits(box: Bounds): boolean {
    return this.keys(box).some((key) => this.cells.get(key)?.some((other) => overlaps(box, other, this.gap)) ?? false);
  }
}

/**
 * Where each wire label is centred: the place along its wire nearest the middle whose box keeps clear of the
 * labels placed before it and of the nodes, else one clear of the labels only, else the middle.
 */
export function placeWireLabels(labels: readonly WireLabel[], layout: Layout): Map<string, Point> {
  const nodes = new BoxGrid(0);
  for (const n of layout.values()) nodes.add(rectBounds(n.rect));
  const placed = new BoxGrid(LABEL_GAP);
  const result = new Map<string, Point>();
  for (const label of labels) {
    let chosen: { at: Point; box: Bounds } | undefined;
    let clearOfLabels: typeof chosen;
    for (const fraction of FRACTIONS) {
      const at = pathPointAt(label.path, fraction);
      const box = wireLabelBox(label.text, at);
      if (placed.hits(box)) continue;
      clearOfLabels ??= { at, box };
      if (!nodes.hits(box)) {
        chosen = { at, box };
        break;
      }
    }
    chosen ??= clearOfLabels ?? { at: pathPointAt(label.path, 0.5), box: wireLabelBox(label.text, pathPointAt(label.path, 0.5)) };
    placed.add(chosen.box);
    result.set(label.wireId, chosen.at);
  }
  return result;
}
