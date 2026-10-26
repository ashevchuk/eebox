import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { setPanelTitle } from '../src/layout/panel';
import { cableMarkers, labelStrips } from '../src/project/labels';
import { addNode, connect, emptySchematic, setNodeLoad, setWireLabel, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

describe('labelStrips', () => {
  const texts = (lines: ReturnType<typeof labelStrips>) => lines.map((l) => l.cells.map((c) => c.text));

  it('gives every module a cell as wide as the module, placed by its distance from the line start', () => {
    const panel = panelOf([place('p1', 'mcb1', 0, 2), place('p2', 'mcb3', 0, 5)]);
    expect(labelStrips(panel, resolve)).toEqual([
      { rail: 0, cells: [{ offsetUnits: 0, widthUnits: 1, text: 'MCB 1P' }, { offsetUnits: 3, widthUnits: 3, text: 'MCB 3P' }] },
    ]);
  });

  it('prefers the label the user gave, falls back to the module name and then to its id', () => {
    const panel = panelOf([{ ...place('p1', 'mcb1', 0, 0), label: 'Kitchen' }, place('p2', 'mcb1', 0, 1), place('p3', 'ghost', 0, 2)]);
    expect(texts(labelStrips(panel, resolve))).toEqual([['Kitchen', 'MCB 1P', 'ghost']]);
  });

  it('uses the width of a placed copy that differs from the module', () => {
    const panel = panelOf([{ ...place('p1', 'nbar', 0, 0), widthUnits: 8 }]);
    expect(labelStrips(panel, resolve)[0]!.cells[0]!.widthUnits).toBe(8);
  });

  it('cuts a long rail into lines at a module boundary, so that no module is split', () => {
    const panel = panelOf([0, 1, 2, 3, 4, 5].map((i) => place(`p${i}`, 'mcb3', 0, i * 3)), [], [24]);
    const lines = labelStrips(panel, resolve, 9);
    expect(lines.map((l) => l.cells.length)).toEqual([3, 3]);
    expect(lines[1]!.cells.map((c) => c.offsetUnits)).toEqual([0, 3, 6]);
  });

  it('starts every rail on its own line and carries the row label', () => {
    const panel = { ...panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 1, 0)], [], [12, 12]), railLabels: ['Incoming', ''] };
    const lines = labelStrips(panel, resolve);
    expect(lines.map((l) => l.rail)).toEqual([0, 1]);
    expect(lines[0]!.railLabel).toBe('Incoming');
    expect(lines[1]).not.toHaveProperty('railLabel');
  });

  it('has nothing for an empty panel and ignores the panel title', () => {
    expect(labelStrips(panelOf([]), resolve)).toEqual([]);
    const titled = setPanelTitle(panelOf([]), 'House');
    expect(titled.ok && labelStrips(titled.panel, resolve)).toEqual([]);
  });
});

describe('cableMarkers', () => {
  function circuit(): { schematic: Schematic } {
    const panel = panelOf([place('p1', 'breaker16', 0, 0)]);
    let schematic: Schematic = emptySchematic();
    schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L', 'N', 'PE'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 0, conductors: ['L', 'N', 'PE'] }).schematic;
    schematic = addNode(schematic, { kind: 'load', label: 'Spare', x: 0, y: 0, conductors: ['L', 'N', 'PE'] }).schematic;
    const wired = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n1', terminal: 'bottom:L' }, { node: 'n2', terminal: 'top:L' });
    if (!wired.ok) throw new Error(wired.error.kind);
    return { schematic: wired.schematic };
  }
  const project = (schematic: Schematic) => ({ panel: panelOf([]), schematic });

  it('makes two markers, one for each end, for a load that has a wire, and none for one without', () => {
    expect(cableMarkers(project(circuit().schematic))).toEqual([{ text: 'Oven', copies: 2 }]);
  });

  it('adds the cores and cross-section when the cable is chosen', () => {
    const loaded = setNodeLoad(circuit().schematic, 'n2', { powerW: 1000, crossSectionMm2: 2.5 });
    if (!loaded.ok) throw new Error(loaded.error.kind);
    expect(cableMarkers(project(loaded.schematic))).toEqual([{ text: 'Oven', detail: '3x2.5 mm2', copies: 2 }]);
  });

  it('adds each distinct wire label once, unless it only repeats the name of a load', () => {
    const base = circuit().schematic;
    const first = setWireLabel(base, base.wires[0]!.id, 'Cable K1');
    if (!first.ok) throw new Error(first.error.kind);
    expect(cableMarkers(project(first.schematic)).map((m) => m.text)).toEqual(['Oven', 'Cable K1']);
    const same = setWireLabel(base, base.wires[0]!.id, 'Oven');
    if (!same.ok) throw new Error(same.error.kind);
    expect(cableMarkers(project(same.schematic)).map((m) => m.text)).toEqual(['Oven']);
  });
});
