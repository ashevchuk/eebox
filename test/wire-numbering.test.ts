import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { connect, emptySchematic, setWireLabel, syncModuleNodes, type Schematic } from '../src/schematic/model';
import { DEFAULT_WIRE_PATTERN, numberWires } from '../src/schematic/numbering';
import { panelOf, place, resolve } from './fixtures';

/** Three wires between two three-pole breakers: w1, w2 and w3. */
function threeWires(): Schematic {
  const panel = panelOf([place('p1', 'mcb3', 0, 0), place('p2', 'mcb3', 0, 6)], [], [24]);
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const terminals = nodeTerminalsLookup(panel, resolve);
  for (const pole of ['L1', 'L2', 'L3']) {
    const wired = connect(schematic, terminals, { node: 'n1', terminal: `bottom:${pole}` }, { node: 'n2', terminal: `top:${pole}` });
    if (!wired.ok) throw new Error(wired.error.kind);
    schematic = wired.schematic;
  }
  return schematic;
}
const labels = (schematic: Schematic) => schematic.wires.map((w) => w.label);
const numbered = (schematic: Schematic, pattern = DEFAULT_WIRE_PATTERN) => {
  const result = numberWires(schematic, pattern);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe('numberWires', () => {
  it('labels every wire that has none, in order, from 1', () => {
    const result = numbered(threeWires());
    expect(labels(result.schematic)).toEqual(['W1', 'W2', 'W3']);
    expect(result.numbered).toBe(3);
  });

  it('keeps a label that is there and goes on after the highest number of the pattern', () => {
    const named = setWireLabel(threeWires(), 'w2', 'W7');
    if (!named.ok) throw new Error('label');
    const result = numbered(named.schematic);
    expect(labels(result.schematic)).toEqual(['W8', 'W7', 'W9']);
  });

  it('does not count a label of another pattern', () => {
    const named = setWireLabel(threeWires(), 'w1', 'Supply');
    if (!named.ok) throw new Error('label');
    expect(labels(numbered(named.schematic).schematic)).toEqual(['Supply', 'W1', 'W2']);
  });

  it('takes a pattern with text on both sides of the number, and special characters in it literally', () => {
    const named = setWireLabel(threeWires(), 'w1', '(A)-4.');
    if (!named.ok) throw new Error('label');
    expect(labels(numbered(named.schematic, '(A)-{n}.').schematic)).toEqual(['(A)-4.', '(A)-5.', '(A)-6.']);
  });

  it('ignores spaces around the pattern, as a label is kept without them', () => {
    expect(labels(numbered(threeWires(), '  W{n} ').schematic)).toEqual(['W1', 'W2', 'W3']);
  });

  it('numbers nothing when every wire has a label', () => {
    const once = numbered(threeWires());
    const again = numbered(once.schematic);
    expect(again.numbered).toBe(0);
    expect(labels(again.schematic)).toEqual(labels(once.schematic));
  });

  it('refuses a pattern without exactly one {n}, and one that makes a label that cannot be kept', () => {
    expect(numberWires(threeWires(), 'W')).toEqual({ ok: false, error: 'no-placeholder' });
    expect(numberWires(threeWires(), '{n}{n}')).toEqual({ ok: false, error: 'no-placeholder' });
    expect(numberWires(threeWires(), `${'x'.repeat(60)}{n}`)).toEqual({ ok: false, error: 'invalid-label' });
  });
});
