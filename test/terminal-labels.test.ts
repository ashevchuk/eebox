import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { ModuleRef, Panel, Sizes } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import { FRAME_PADDING, placementRect } from '../src/view/geometry';
import { labelBox, terminalLabels } from '../src/view/terminalLabels';

const block: ModuleDef = {
  id: 'blk',
  kind: 'terminal',
  name: 'Block',
  widthUnits: 2,
  heightMm: 90,
  mounting: 'rail',
  poles: 1,
  terminals: [
    { name: '1', conductor: 'L', side: 'top', unit: 0 },
    { name: '2', conductor: 'L', side: 'top', unit: 1 },
    { name: '1b', conductor: 'L', side: 'bottom', unit: 0 },
  ],
};
const breaker: ModuleDef = { id: 'mcb', kind: 'breaker', name: 'MCB', widthUnits: 1, heightMm: 90, mounting: 'rail', poles: 1 };
const comb: ModuleDef = { id: 'comb', kind: 'comb', name: 'Comb', widthUnits: 6, heightMm: 90, mounting: 'rail', poles: 3, comb: { pattern: ['L1', 'L2', 'L3'], side: 'top' } };
const defs: Record<string, ModuleDef> = { blk: block, mcb: breaker, comb };
const resolve = (ref: ModuleRef) => defs[ref.moduleId];
const sizes: Sizes = { widthOf: (p) => resolve(p.module)?.widthUnits, heightOf: () => 90 };

const place = (id: string, moduleId: string, rail: number, slot: number, terminalLabels?: Record<string, string>) => ({
  id,
  module: { libraryId: 'l', moduleId },
  rail,
  slot,
  ...(terminalLabels ? { terminalLabels } : {}),
});
const panelOf = (placements: Panel['placements'], pitch = 150): Panel => ({ ...createPanel([12, 12], pitch), placements });

describe('terminalLabels', () => {
  it('stands the names of the top terminals of a terminal block over their dots, only where a name was given', () => {
    const panel = panelOf([place('p1', 'blk', 1, 0, { 'top:1': 'X1:1', 'bottom:1b': 'ignored' })]);
    const body = placementRect(panel, sizes, panel.placements[0]!);
    const found = terminalLabels(panel, sizes, resolve);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ text: 'X1:1', x: body.x + 8.75, y: body.y - 3 });
  });

  it('are left out for a module that is not a terminal block', () => {
    const panel = panelOf([place('p1', 'mcb', 1, 0, { 'top:L': 'F1' })]);
    expect(terminalLabels(panel, sizes, resolve)).toEqual([]);
  });

  it('run only as far as the row above, or the edge of the plate on the top row', () => {
    const labelled = { 'top:1': 'X1:1' };
    const below = panelOf([place('p1', 'blk', 1, 0, labelled), place('p2', 'mcb', 0, 0)]);
    const gap = 150 - 90;
    expect(terminalLabels(below, sizes, resolve)[0]!.maxLength).toBe(gap - 2 * 3);
    const top = panelOf([place('p1', 'blk', 0, 0, labelled)]);
    const body = placementRect(top, sizes, top.placements[0]!);
    expect(terminalLabels(top, sizes, resolve)[0]!.maxLength).toBe(Math.min(60, body.y - 3 - FRAME_PADDING - 3));
  });

  it('give a box that is as long as the text, or the room it has', () => {
    const label = { text: 'abcd', x: 100, y: 50, maxLength: 20, direction: 'up' as const };
    expect(labelBox(label, (text) => text.length * 4).height).toBe(16);
    expect(labelBox(label, (text) => text.length * 10).height).toBe(20);
  });
});
