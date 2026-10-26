import { describe, expect, it } from 'vitest';
import { wireEndLabels, wireEndLabelsToCsv, wireList, type WireRow } from '../src/electrical/schedule';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { addNode, connect, emptySchematic, setWireLabel, setWireSection, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

function rows(): WireRow[] {
  const panel = { ...panelOf([place('p1', 'breaker16', 0, 0)]) };
  panel.placements[0] = { ...panel.placements[0]!, label: 'Kitchen' };
  let schematic: Schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -100, conductors: ['L', 'N', 'PE'] }).schematic;
  const terminalsOf = nodeTerminalsLookup(panel, resolve);
  const joined = connect(schematic, terminalsOf, { node: 'n2', terminal: 'bottom:L' }, { node: 'n1', terminal: 'top:L' });
  if (!joined.ok) throw new Error(joined.error.kind);
  schematic = joined.schematic;
  const labelled = setWireLabel(schematic, 'w1', 'Feed');
  if (!labelled.ok) throw new Error('label');
  const sized = setWireSection(labelled.schematic, 'w1', 2.5);
  if (!sized.ok) throw new Error('section');
  return wireList({ panel, schematic: sized.schematic }, resolve);
}

describe('wireEndLabels', () => {
  it('makes one label for each end of a wire, each naming the other end', () => {
    const labels = wireEndLabels(rows());
    expect(labels.map((l) => l.text)).toEqual(['Mains L → Kitchen L', 'Kitchen L → Mains L']);
  });

  it('puts the wire label, conductor and cross-section on the second line, without the side of the terminal', () => {
    const [label] = wireEndLabels(rows());
    expect(label?.detail).toBe('Feed, L, 2.5 mm2');
    expect(label?.text).not.toMatch(/top|bottom/);
  });

  it('leaves out what is not known instead of printing empty commas', () => {
    const [bare] = wireEndLabels([{ wireId: 'w1', from: 'A 1 (top)', to: 'B 2 (bottom)', conductor: 'N' }]);
    expect(bare?.detail).toBe('N');
  });

  it('is one copy of each, and nothing for a project without wires', () => {
    expect(wireEndLabels(rows()).every((l) => l.copies === 1)).toBe(true);
    expect(wireEndLabels([])).toEqual([]);
  });
});

describe('wireEndLabelsToCsv', () => {
  it('has a header, semicolons between the columns and one line per label', () => {
    const csv = wireEndLabelsToCsv(wireEndLabels(rows())).split('\r\n');
    expect(csv[0]).toBe('Label 1;Label 2;Copies');
    expect(csv[1]).toBe('Mains L → Kitchen L;"Feed, L, 2.5 mm2";1'.replace('"Feed, L, 2.5 mm2"', 'Feed, L, 2.5 mm2'));
    expect(csv).toHaveLength(4);
  });

  it('quotes a cell that holds the delimiter or a line break, and doubles quotes', () => {
    const csv = wireEndLabelsToCsv([{ text: 'a;b', detail: 'say "hi"\nnow', copies: 2 }]);
    expect(csv.split('\r\n')[1]).toBe('"a;b";"say ""hi""\nnow";2');
  });

  it('keeps a leading formula character from being run by a spreadsheet', () => {
    const csv = wireEndLabelsToCsv([{ text: '=SUM(A1)', detail: '-X1', copies: 1 }]);
    expect(csv.split('\r\n')[1]).toBe("'=SUM(A1);'-X1;1");
  });
});
