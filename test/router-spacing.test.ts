import { describe, expect, it } from 'vitest';
import autoBackup from '../examples/workshop-auto-backup.json?raw';
import house from '../examples/house-panel.json?raw';
import studio from '../examples/studio-flat.json?raw';
import workshop from '../examples/workshop-backup.json?raw';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { parseProjectJson } from '../src/project/file';
import { computeLayout } from '../src/schematic/geometry';
import { findOverlaps } from '../src/schematic/overlaps';
import { routeWires } from '../src/schematic/router';

function closePairs(text: string): number {
  const parsed = parseProjectJson(text);
  if (!parsed.ok) throw new Error('example does not load');
  const { project, modules } = parsed.file;
  const resolve = (ref: { libraryId: string; moduleId: string }) => modules[`${ref.libraryId}/${ref.moduleId}`];
  const layout = computeLayout(project.schematic, nodeTerminalsLookup(project.panel, resolve));
  return findOverlaps(routeWires(project.schematic, layout)).length;
}

describe('the automatic router keeps wires a gap apart in the examples', () => {
  it('has no wires running side by side too close in the small examples', () => {
    expect(closePairs(house)).toBe(0);
    expect(closePairs(studio)).toBe(0);
  });

  it('keeps the busy examples from getting worse than they are now', () => {
    expect(closePairs(autoBackup)).toBeLessThanOrEqual(9);
    expect(closePairs(workshop)).toBeLessThanOrEqual(5);
  });
});
