import { describe, expect, it } from 'vitest';
import { DEFAULT_LEGEND, legendOf, legendProblem, setLegend, type LegendSettings } from '../src/layout/legend';
import { setMarking } from '../src/layout/marking';
import type { Placement } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { legendCell, legendRows, legendToCsv, numberRange } from '../src/project/legend';
import type { Schematic, SchematicNode, Wire } from '../src/schematic/model';
import { defs, panelOf, place } from './fixtures';

const c16: ModuleDef = { ...defs.mcb1!, id: 'c16', name: 'MCB 1P C16', ratedCurrentA: 16, curve: 'C' };
const b10: ModuleDef = { ...defs.mcb1!, id: 'b10', name: 'MCB 1P B10', ratedCurrentA: 10, curve: 'B' };
const rcd: ModuleDef = { ...defs.rcd4!, id: 'rcd', name: 'RCD 4P 40A', ratedCurrentA: 40 };
const local: Record<string, ModuleDef> = { c16, b10, rcd, nbar: defs.nbar! };
const resolve = (ref: { moduleId: string }) => local[ref.moduleId];

const node = (id: string, kind: SchematicNode['kind'], label: string, extra: Partial<SchematicNode> = {}): SchematicNode => ({ id, kind, label, x: 0, y: 0, ...extra });
const wire = (id: string, a: [string, string], b: [string, string], extra: Partial<Wire> = {}): Wire => ({ id, a: { node: a[0], terminal: a[1] }, b: { node: b[0], terminal: b[1] }, ...extra });

/**
 * Mains (6 mm2 to the RCD) feeds an RCD p1, then a bar p2, and breakers p3 and p4 (kitchen, 2.5 mm2)
 * and p5 (hall, 1.5 mm2).
 */
function house(placements?: Placement[]): Project {
  const panel = panelOf(placements ?? [place('p1', 'rcd', 0, 0), place('p2', 'nbar', 0, 4), place('p3', 'c16', 0, 10), place('p4', 'c16', 0, 11), place('p5', 'b10', 0, 12)]);
  const schematic: Schematic = {
    nodes: [
      ...panel.placements.map((p, i) => node(`m${i + 1}`, 'module', p.id, { placementId: p.id })),
      node('s', 'source', 'Mains', { conductors: ['L1', 'L2', 'L3', 'N'] }),
      node('k1', 'load', 'Kitchen', { conductors: ['L', 'N'], load: { powerW: 2000, crossSectionMm2: 2.5 } }),
      node('k2', 'load', 'Kitchen', { conductors: ['L', 'N'], load: { powerW: 2000, crossSectionMm2: 2.5 } }),
      node('h', 'load', 'Hall light', { conductors: ['L', 'N'], load: { powerW: 100, crossSectionMm2: 1.5 } }),
    ],
    wires: [
      wire('w1', ['s', 'bottom:L1'], ['m1', 'top:L1'], { crossSectionMm2: 6 }),
      wire('w2', ['m1', 'bottom:L1'], ['m3', 'top:L']),
      wire('w3', ['m1', 'bottom:L1'], ['m4', 'top:L']),
      wire('w4', ['m1', 'bottom:L1'], ['m5', 'top:L']),
      wire('w5', ['m3', 'bottom:L'], ['k1', 'top:L']),
      wire('w6', ['m4', 'bottom:L'], ['k2', 'top:L']),
      wire('w7', ['m5', 'bottom:L'], ['h', 'top:L']),
    ],
  };
  return { panel, schematic };
}

describe('the legend of a panel', () => {
  it('lists the devices only, joins neighbours that say the same, and keeps the numbers of their strips', () => {
    const rows = legendRows(house(), resolve);
    expect(rows.map((r) => [r.numbers, r.text, r.rating, r.sections])).toEqual([
      [[1], '', '40', [6]],
      [[3, 4], 'Kitchen', 'C16', [2.5]],
      [[5], 'Hall light', 'B10', [1.5]],
    ]);
  });

  it('names the group by its RCD and gives the rows the colour of their strips', () => {
    const rows = legendRows(house(), resolve);
    expect(rows.map((r) => r.group)).toEqual(['RCD 4P 40A', 'RCD 4P 40A', 'RCD 4P 40A']);
    expect(new Set(rows.map((r) => r.colour)).size).toBe(1);
  });

  it('keeps apart neighbours that differ in rating, and joins their designations when it joins them', () => {
    const project = house();
    const placements = project.panel.placements.map((p) => (p.id === 'p3' ? { ...p, ref: 'QF1' } : p.id === 'p4' ? { ...p, ref: 'QF2' } : p));
    expect(legendRows({ ...project, panel: { ...project.panel, placements } }, resolve)[1]?.refs).toEqual(['QF1', 'QF2']);
    const other = house([place('p1', 'rcd', 0, 0), place('p2', 'nbar', 0, 4), place('p3', 'c16', 0, 10), place('p4', 'b10', 0, 11), place('p5', 'b10', 0, 12)]);
    const marked = setMarking(other.panel, 'p4', 'text', 'Kitchen');
    if (!marked.ok) throw new Error('mark');
    expect(legendRows({ ...other, panel: marked.panel }, resolve).map((r) => r.numbers)).toEqual([[1], [3], [4], [5]]);
  });

  it('writes number runs as a range, and the cells of a row column by column', () => {
    expect(numberRange([3, 4, 5, 7, 9, 10])).toBe('3–5, 7, 9, 10');
    expect(numberRange([2])).toBe('2');
    const row = legendRows(house(), resolve)[1]!;
    expect(['number', 'text', 'rating', 'section', 'group'].map((c) => legendCell(row, c as never))).toEqual(['3, 4', 'Kitchen', 'C16', '2.5', 'RCD 4P 40A']);
  });

  it('goes into a CSV with every column', () => {
    const lines = legendToCsv(legendRows(house(), resolve), (k) => k).split('\r\n');
    expect(lines[0]).toBe('Number,Designation,Icon,Description,Group,Rating,Cross-section');
    expect(lines[2]).toBe('"3, 4",,,Kitchen,RCD 4P 40A,C16,2.5');
  });
});

describe('the settings of the legend', () => {
  const panel = panelOf([]);
  const settings = (over: Partial<LegendSettings>): LegendSettings => ({ ...DEFAULT_LEGEND, ...over });

  it('default to number, description, rating and cross-section on A4 portrait, and are not stored while they are the defaults', () => {
    expect(legendOf(panel)).toEqual(DEFAULT_LEGEND);
    const same = setLegend(panel, settings({ columns: ['section', 'number', 'rating', 'text'] }));
    expect(same.ok && 'legend' in same.panel).toBe(false);
  });

  it('keep the columns in their printed order and refuse what is out of bounds', () => {
    const set = setLegend(panel, settings({ columns: ['section', 'ref', 'number'], fontMm: 4 }));
    expect(set.ok && set.panel.legend?.columns).toEqual(['number', 'ref', 'section']);
    expect(setLegend(panel, settings({ columns: [] })).ok).toBe(false);
    expect(setLegend(panel, settings({ fontMm: 20 })).ok).toBe(false);
    expect(legendProblem({ ...DEFAULT_LEGEND, paper: 'Letter' })).toContain('paper');
    expect(legendProblem({ ...DEFAULT_LEGEND, columns: ['number', 'number'] })).toContain('each once');
  });

  it('travel in a project file', () => {
    const set = setLegend(panel, settings({ columns: ['number', 'icon', 'text'], orientation: 'landscape' }));
    if (!set.ok) throw new Error(set.message);
    const parsed = parseProjectJson(JSON.stringify(buildProjectFile({ panel: set.panel, schematic: { nodes: [], wires: [] } }, resolve)));
    expect(parsed.ok && parsed.file.project.panel.legend).toEqual(set.panel.legend);
    const bad = buildProjectFile({ panel: { ...panel, legend: { ...DEFAULT_LEGEND, fontMm: 1 } }, schematic: { nodes: [], wires: [] } }, resolve);
    expect(parseProjectJson(JSON.stringify(bad)).ok).toBe(false);
  });
});
