import { describe, expect, it } from 'vitest';
import type { Project } from '../src/project';
import { addNode, emptySchematic } from '../src/schematic/model';
import { SHORTCUTS, emptyHint } from '../src/ui/help';
import { panelOf, place } from './fixtures';

const empty = (): Project => ({ panel: panelOf([]), schematic: emptySchematic() });

describe('the list of keys', () => {
  it('has groups with a title and entries that say what is pressed and what happens', () => {
    expect(SHORTCUTS.length).toBeGreaterThanOrEqual(4);
    for (const group of SHORTCUTS) {
      expect(group.title).not.toBe('');
      expect(group.entries.length).toBeGreaterThan(0);
      for (const [keys, what] of group.entries) {
        expect(keys.trim()).not.toBe('');
        expect(what.trim()).not.toBe('');
      }
    }
  });

  it('names a key once in a group', () => {
    for (const group of SHORTCUTS) {
      const keys = group.entries.map(([k]) => k);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('lists the keys that the application answers to', () => {
    const everything = SHORTCUTS.flatMap((g) => g.entries.map(([k]) => k)).join(' | ');
    for (const key of ['Ctrl+Z', 'Ctrl+A', 'Ctrl+C, Ctrl+V', 'Ctrl+D', 'R', 'Delete', 'Escape', '?']) expect(everything).toContain(key);
  });
});

describe('the hint of a drawing with nothing on it', () => {
  it('tells what to do on an empty panel, and is gone as soon as a module is on it', () => {
    expect(emptyHint(empty(), 'panel')[0]).toBe('Drag a module from the library onto a rail.');
    expect(emptyHint({ panel: panelOf([place('p1', 'mcb1', 0, 0)]), schematic: emptySchematic() }, 'panel')).toEqual([]);
  });

  it('tells how to start on an empty schematic, and is gone with the first node', () => {
    expect(emptyHint(empty(), 'schematic')[0]).toBe('Nothing to wire yet.');
    const withNode = { ...empty(), schematic: addNode(emptySchematic(), { kind: 'source', label: 'S', x: 0, y: 0, conductors: ['L'] }).schematic };
    expect(emptyHint(withNode, 'schematic')).toEqual([]);
  });

  it('is judged by the view that is shown, not by the other', () => {
    const onlyPanel: Project = { panel: panelOf([place('p1', 'mcb1', 0, 0)]), schematic: emptySchematic() };
    expect(emptyHint(onlyPanel, 'schematic')).not.toEqual([]);
  });
});

describe('drawing the hint', () => {
  it('writes each line in the middle of the view, the first in bold, and nothing for no lines', async () => {
    const { drawHint } = await import('../src/view/hint');
    const { SvgContext } = await import('../src/view/svgContext');
    const svg = new SvgContext(400, 200, (text) => text.length * 6);
    drawHint(svg as unknown as CanvasRenderingContext2D, ['First line', 'Second line'], 400, 200, 1);
    const out = svg.toSvg();
    expect(out).toContain('>First line</text>');
    expect(out).toContain('font-weight="bold"');
    expect(out).toContain('>Second line</text>');
    expect(out).toContain('text-anchor="middle"');
    const none = new SvgContext(400, 200, (text) => text.length * 6);
    drawHint(none as unknown as CanvasRenderingContext2D, [], 400, 200, 1);
    expect(none.toSvg()).not.toContain('<text');
  });
});
