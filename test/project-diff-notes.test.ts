import { describe, expect, it } from 'vitest';
import type { Annotation } from '../src/layout/annotations';
import type { Project } from '../src/project';
import { diffProjects } from '../src/project/diff';
import { buildProjectFile } from '../src/project/file';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const base = (): Project => ({ panel: panelOf([place('p1', 'breaker16', 0, 0)]), schematic: emptySchematic() });
const noted = (panel?: Annotation[], schematic?: Annotation[]): Project => ({
  panel: { ...base().panel, ...(panel ? { annotations: panel } : {}) },
  schematic: { ...emptySchematic(), ...(schematic ? { annotations: schematic } : {}) },
});
const lines = (a: Project, b: Project) => diffProjects(buildProjectFile(a, resolve), buildProjectFile(b, resolve)).map((c) => `${c.area}/${c.kind}: ${c.text}`);

describe('comparing notes on the drawings', () => {
  it('reports a note that was written, on the drawing it is on', () => {
    const written = lines(noted(), noted([{ id: 'a1', x: 0, y: 0, text: 'Add an RCD' }], [{ id: 'a1', x: 5, y: 5, text: 'Check the PE' }]));
    expect(written).toContain('notes/added: panel: "Add an RCD" (a1)');
    expect(written).toContain('notes/added: schematic: "Check the PE" (a1)');
  });

  it('reports a note that was taken away', () => {
    expect(lines(noted([{ id: 'a1', x: 0, y: 0, text: 'Add an RCD' }]), noted())).toContain('notes/removed: panel: "Add an RCD" (a1)');
  });

  it('reports what changed in a note: the text, the place and the arrow', () => {
    const before = noted([{ id: 'a1', x: 0, y: 0, text: 'Add an RCD' }]);
    const after = noted([{ id: 'a1', x: 50, y: 0, text: 'Add an RCBO', target: { x: 9, y: 9 } }]);
    const line = lines(before, after).find((l) => l.startsWith('notes/changed'))!;
    expect(line).toContain('text "Add an RCD" → "Add an RCBO"');
    expect(line).toContain('moved from 0, 0 to 50, 0 mm');
    expect(line).toContain('arrow added');
  });

  it('finds nothing when the notes are the same', () => {
    const same = [{ id: 'a1', x: 0, y: 0, text: 'Same', target: { x: 1, y: 2 } }];
    expect(lines(noted(same), noted(same))).toEqual([]);
  });
});
