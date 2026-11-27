import { describe, expect, it } from 'vitest';
import automation from '../examples/automation-panel.json?raw';
import bars from '../examples/house-panel-bars.json?raw';
import tncs from '../examples/tn-c-s.json?raw';
import autoBackup from '../examples/workshop-auto-backup.json?raw';
import house from '../examples/house-panel.json?raw';
import studio from '../examples/studio-flat.json?raw';
import workshop from '../examples/workshop-backup.json?raw';
import { wireCurrents } from '../src/electrical/loads';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { parseProjectJson } from '../src/project/file';
import { computeLayout, pathMidpoint, wireLabelBox, type Layout } from '../src/schematic/geometry';
import { routeWires } from '../src/schematic/router';
import { placeWireLabels, type WireLabel } from '../src/schematic/wireLabels';
import { wireLabelText } from '../src/ui/schematicView';
import type { Bounds } from '../src/view/Camera';
import { ALL_TEXT } from '../src/view/textVisibility';

const overlap = (a: Bounds, b: Bounds) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const pairsOverlapping = (boxes: Bounds[]) => boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => overlap(a, b))).length;

function labelsOf(text: string): { labels: WireLabel[]; layout: Layout } {
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new Error('example does not load');
  const { project, modules } = parsed.file;
  const resolve = (ref: { libraryId: string; moduleId: string }) => modules[`${ref.libraryId}/${ref.moduleId}`];
  const layout = computeLayout(project.schematic, nodeTerminalsLookup(project.panel, resolve));
  const routes = routeWires(project.schematic, layout);
  const currents = wireCurrents(project, resolve);
  const labels = project.schematic.wires.flatMap((wire) => {
    const path = routes.get(wire.id);
    const label = wireLabelText(wire.label, currents.get(wire.id), ALL_TEXT);
    return path && label ? [{ wireId: wire.id, text: label, path }] : [];
  });
  return { labels, layout };
}

describe('labels of wires', () => {
  it('stand in the middle of a wire that has room there', () => {
    const path = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    expect(placeWireLabels([{ wireId: 'w', text: '10 A', path }], new Map()).get('w')).toEqual({ x: 100, y: 0 });
  });

  it('move along parallel wires a lane apart, so that no two cover each other', () => {
    const labels = [0, 10, 20].map((y) => ({ wireId: `w${y}`, text: '24.3 A', path: [{ x: 0, y }, { x: 300, y }] }));
    const spots = placeWireLabels(labels, new Map());
    const boxes = labels.map((l) => wireLabelBox(l.text, spots.get(l.wireId)!));
    expect(pairsOverlapping(boxes)).toBe(0);
    labels.forEach((l) => expect(spots.get(l.wireId)!.y).toBe(l.path[0]!.y));
  });

  it('cover none of each other in the examples, where the middles of the wires did', () => {
    let middles = 0;
    for (const text of [house, bars, tncs, studio, autoBackup, workshop, automation]) {
      const { labels, layout } = labelsOf(text);
      const spots = placeWireLabels(labels, layout);
      expect(pairsOverlapping(labels.map((l) => wireLabelBox(l.text, spots.get(l.wireId)!)))).toBe(0);
      middles += pairsOverlapping(labels.map((l) => wireLabelBox(l.text, pathMidpoint(l.path))));
    }
    expect(middles).toBeGreaterThan(0);
  });
});
