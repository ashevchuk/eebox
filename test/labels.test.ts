import { describe, expect, it } from 'vitest';
import { setCombLabel } from '../src/layout/combs';
import { isStoredLabel, normalizeLabel } from '../src/layout/labels';
import { MAX_LABEL_LENGTH } from '../src/layout/limits';
import { createPanel, moveRail, setRailCount, setRailLabel } from '../src/layout/panel';
import { setPlacementLabel } from '../src/layout/placement';
import { addNode, emptySchematic, renameNode, setWireLabel, type Schematic } from '../src/schematic/model';
import { combAt, panelOf, place } from './fixtures';

describe('label text', () => {
  it('trims, and treats empty or blank text as no label', () => {
    expect(normalizeLabel('  Kitchen sockets  ')).toEqual({ ok: true, label: 'Kitchen sockets' });
    expect(normalizeLabel('')).toEqual({ ok: true, label: undefined });
    expect(normalizeLabel('   ')).toEqual({ ok: true, label: undefined });
  });

  it('accepts exactly the maximum length and rejects one more', () => {
    expect(normalizeLabel('a'.repeat(MAX_LABEL_LENGTH)).ok).toBe(true);
    expect(normalizeLabel('a'.repeat(MAX_LABEL_LENGTH + 1))).toEqual({ ok: false });
  });

  it('rejects control characters, which would break CSV rows and file contents', () => {
    for (const bad of ['a\nb', 'a\tb', 'a\u0000b', 'a\u007fb']) expect(normalizeLabel(bad)).toEqual({ ok: false });
  });

  it('accepts any script and symbols', () => {
    // Cyrillic letters, a comparison sign and an em dash, written as escapes to keep the source ASCII.
    expect(normalizeLabel('\u041a\u0443\u0445\u043d\u044f: \u2265 16 A \u2014 F1').ok).toBe(true);
  });

  it('only counts trimmed, non-empty, short strings as stored labels', () => {
    expect(isStoredLabel('F1')).toBe(true);
    for (const bad of ['', ' F1', 'F1 ', 5, null, undefined, 'x'.repeat(61)]) expect(isStoredLabel(bad)).toBe(false);
  });
});

describe('placement and comb labels', () => {
  const panel = () => panelOf([place('p1', 'mcb1', 0, 0), place('p2', 'mcb1', 0, 1)], [combAt('c1', 'comb1', 0, 0)]);
  const ok = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error('unexpected failure');
    return result as Extract<T, { ok: true }>;
  };

  it('sets and replaces a label, touching only that placement', () => {
    const labelled = ok(setPlacementLabel(panel(), 'p1', ' F1 Lights ')).panel;
    expect(labelled.placements[0]?.label).toBe('F1 Lights');
    expect('label' in labelled.placements[1]!).toBe(false);
    expect(ok(setPlacementLabel(labelled, 'p1', 'F2')).panel.placements[0]?.label).toBe('F2');
  });

  it('clearing removes the label instead of storing an empty one', () => {
    const labelled = ok(setPlacementLabel(panel(), 'p1', 'F1')).panel;
    const cleared = ok(setPlacementLabel(labelled, 'p1', '  ')).panel;
    expect('label' in cleared.placements[0]!).toBe(false);
    expect(cleared).toEqual(panel());
  });

  it('rejects an invalid label and an unknown placement, leaving the panel alone', () => {
    const before = panel();
    expect(setPlacementLabel(before, 'p1', 'x'.repeat(61))).toEqual({ ok: false, error: { kind: 'invalid-label' } });
    expect(setPlacementLabel(before, 'zzz', 'F1')).toEqual({ ok: false, error: { kind: 'unknown-placement' } });
    expect(before).toEqual(panel());
  });

  it('labels a comb the same way', () => {
    const labelled = ok(setCombLabel(panel(), 'c1', 'Phase bus')).panel;
    expect(labelled.combs[0]?.label).toBe('Phase bus');
    expect('label' in ok(setCombLabel(labelled, 'c1', '')).panel.combs[0]!).toBe(false);
    expect(setCombLabel(panel(), 'zzz', 'x')).toEqual({ ok: false, error: { kind: 'unknown-comb' } });
    expect(setCombLabel(panel(), 'c1', 'a\nb')).toEqual({ ok: false, error: { kind: 'invalid-label' } });
  });
});

describe('row labels', () => {
  const unwrap = (result: ReturnType<typeof setRailLabel>) => {
    if (!result.ok) throw new Error(result.error);
    return result.panel;
  };

  it('starts without labels, one entry per rail', () => {
    expect(createPanel([12, 12, 12]).railLabels).toEqual(['', '', '']);
    expect(createPanel([]).railLabels).toEqual([]);
  });

  it('sets, trims and clears the label of one row', () => {
    const labelled = unwrap(setRailLabel(createPanel([12, 12]), 1, ' Lighting '));
    expect(labelled.railLabels).toEqual(['', 'Lighting']);
    expect(unwrap(setRailLabel(labelled, 1, '')).railLabels).toEqual(['', '']);
  });

  it('rejects an unknown row and an invalid label', () => {
    expect(setRailLabel(createPanel([12]), 1, 'x')).toEqual({ ok: false, error: 'unknown-rail' });
    expect(setRailLabel(createPanel([12]), 0, 'x'.repeat(61))).toEqual({ ok: false, error: 'invalid-value' });
  });

  it('pads new rows with no label and drops the labels of removed rows', () => {
    const labelled = unwrap(setRailLabel(unwrap(setRailLabel(createPanel([12, 12]), 0, 'A')), 1, 'B'));
    const grown = setRailCount(labelled, 3);
    expect(grown.ok && grown.panel.railLabels).toEqual(['A', 'B', '']);
    const shrunk = setRailCount(labelled, 1);
    expect(shrunk.ok && shrunk.panel.railLabels).toEqual(['A']);
  });

  it('moves a label together with its row', () => {
    let panel = createPanel([12, 12, 12]);
    for (const [i, name] of ['A', 'B', 'C'].entries()) panel = unwrap(setRailLabel(panel, i, name));
    const moved = moveRail(panel, 0, 2);
    expect(moved.ok && moved.panel.railLabels).toEqual(['B', 'C', 'A']);
    const back = moveRail(panel, 2, 0);
    expect(back.ok && back.panel.railLabels).toEqual(['C', 'A', 'B']);
  });
});

describe('wire and node labels', () => {
  const withWire = (): Schematic => ({
    ...emptySchematic(),
    wires: [{ id: 'w1', a: { node: 'n1', terminal: 'top:L' }, b: { node: 'n2', terminal: 'top:L' } }],
  });

  it('labels and clears a wire', () => {
    const labelled = setWireLabel(withWire(), 'w1', 'NYM 3x2.5');
    expect(labelled.ok && labelled.schematic.wires[0]?.label).toBe('NYM 3x2.5');
    const cleared = labelled.ok ? setWireLabel(labelled.schematic, 'w1', '') : labelled;
    expect(cleared.ok && 'label' in cleared.schematic.wires[0]!).toBe(false);
  });

  it('rejects an unknown wire and an invalid wire label', () => {
    expect(setWireLabel(withWire(), 'zzz', 'x')).toEqual({ ok: false, error: { kind: 'unknown-wire' } });
    expect(setWireLabel(withWire(), 'w1', 'a\nb')).toEqual({ ok: false, error: { kind: 'invalid-label' } });
  });

  it('renames a node with a valid label but never clears it', () => {
    const s = addNode(emptySchematic(), { kind: 'load', label: 'Load', x: 0, y: 0, conductors: ['L'] }).schematic;
    const renamed = renameNode(s, 'n1', ' Oven ');
    expect(renamed.ok && renamed.schematic.nodes[0]?.label).toBe('Oven');
    expect(renameNode(s, 'n1', '  ')).toEqual({ ok: false, error: { kind: 'invalid-label' } });
    expect(renameNode(s, 'n1', 'x'.repeat(61))).toEqual({ ok: false, error: { kind: 'invalid-label' } });
    expect(renameNode(s, 'zzz', 'Oven')).toEqual({ ok: false, error: { kind: 'unknown-node' } });
  });
});
