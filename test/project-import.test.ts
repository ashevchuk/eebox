import { describe, expect, it } from 'vitest';
import { buildProjectFile } from '../src/project/file';
import { describeImport, planProjectFiles, projectFileName, sniffFile } from '../src/project/projectImport';
import type { StoredProject } from '../src/project/projectStore';
import { buildWorkspace, workspaceToText } from '../src/project/workspace';
import { emptySchematic } from '../src/schematic/model';
import { panelOf, place, resolve } from './fixtures';

const fileText = (title: string, id = 'p1') =>
  JSON.stringify(buildProjectFile({ panel: { ...panelOf([place(id, 'breaker16', 0, 0)]), title }, schematic: emptySchematic() }, resolve));
const stored = (id: string, title: string, snapshot = false): StoredProject => ({ id, title, savedAt: 1, file: JSON.parse(fileText(title)), ...(snapshot ? { snapshot: true as const } : {}) });

describe('telling what a file is', () => {
  it('knows a project, a backup and a library, and nothing else', () => {
    expect(sniffFile(fileText('A'))).toBe('project');
    expect(sniffFile(workspaceToText(buildWorkspace({ savedAt: 1, current: null, projects: [], libraries: [], snippets: [], settings: {} })))).toBe('workspace');
    expect(sniffFile(JSON.stringify({ schemaVersion: 1, id: 'x', name: 'X', modules: [] }))).toBe('library');
    for (const text of ['', 'nope', '[]', '7', 'null', '{"format":"other"}']) expect(sniffFile(text)).toBe('unknown');
  });
});

describe('the name of a project file', () => {
  it('is made of the title and says that it is an eebox project', () => {
    expect(projectFileName('House panel')).toBe('house-panel.eebox.json');
    expect(projectFileName(undefined)).toBe('panel.eebox.json');
    expect(projectFileName('  ../../etc/passwd  ')).toBe('etc-passwd.eebox.json');
  });
});

describe('importing project files into the list', () => {
  it('adds a project with a new id and the title of its drawing', () => {
    const plan = planProjectFiles([], [{ name: 'a.json', text: fileText('Flat') }], 99);
    expect(plan.put).toHaveLength(1);
    expect(plan.put[0]).toMatchObject({ id: 'project-1', title: 'Flat', savedAt: 99 });
    expect(plan.results[0]).toMatchObject({ outcome: 'added', title: 'Flat' });
  });

  it('leaves a project that is already in the list, but not because an earlier state looks the same', () => {
    expect(planProjectFiles([stored('project-1', 'Flat')], [{ name: 'a.json', text: fileText('Flat') }], 1).results[0]?.outcome).toBe('unchanged');
    const plan = planProjectFiles([stored('snapshot-1', 'Flat', true)], [{ name: 'a.json', text: fileText('Flat') }], 1);
    expect(plan.results[0]?.outcome).toBe('added');
  });

  it('gives several files in one go ids that differ, and a new id never takes one that is stored', () => {
    const plan = planProjectFiles([stored('project-1', 'Old')], [{ name: 'a', text: fileText('A', 'p1') }, { name: 'b', text: fileText('B', 'p2') }], 1);
    expect(plan.put.map((p) => p.id)).toEqual(['project-2', 'project-3']);
  });

  it('refuses a backup, a library and garbage, each with its own words, and keeps what is good', () => {
    const backup = workspaceToText(buildWorkspace({ savedAt: 1, current: null, projects: [], libraries: [], snippets: [], settings: {} }));
    const plan = planProjectFiles(
      [],
      [{ name: 'b.json', text: backup }, { name: 'l.json', text: JSON.stringify({ schemaVersion: 1, id: 'x' }) }, { name: 'g.json', text: 'garbage' }, { name: 'ok.json', text: fileText('Good') }],
      1,
    );
    expect(plan.results.map((r) => r.outcome)).toEqual(['refused', 'refused', 'refused', 'added']);
    expect(plan.results[0]).toMatchObject({ message: expect.stringContaining('Restore from backup') });
    expect(plan.results[1]).toMatchObject({ message: expect.stringContaining('library') });
    expect(plan.put).toHaveLength(1);
  });

  it('says in one line for each file what became of it', () => {
    const plan = planProjectFiles([stored('project-1', 'Flat')], [{ name: 'a.json', text: fileText('Flat') }, { name: 'b.json', text: 'x' }, { name: 'c.json', text: fileText('New') }], 1);
    const lines = describeImport(plan.results).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('already in the list');
    expect(lines[1]).toMatch(/^b\.json: /);
    expect(lines[2]).toContain('added "New"');
  });
});
