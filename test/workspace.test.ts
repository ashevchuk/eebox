import { describe, expect, it } from 'vitest';
import { buildProjectFile } from '../src/project/file';
import { MAX_SNAPSHOTS, newSnapshotId, planProjectImport, savedProjects, snapshotsOf, snapshotsToDrop, type StoredProject } from '../src/project/projectStore';
import { WORKSPACE_FORMAT, buildWorkspace, parseWorkspace, workspaceToText } from '../src/project/workspace';
import { emptySchematic } from '../src/schematic/model';
import type { Library } from '../src/library/types';
import { panelOf, place, resolve } from './fixtures';

const fileOf = (id = 'p1') => buildProjectFile({ panel: panelOf([place(id, 'breaker16', 0, 0)]), schematic: emptySchematic() }, resolve);
const stored = (id: string, savedAt: number, extra: Partial<StoredProject> = {}): StoredProject => ({ id, title: id, savedAt, file: fileOf(), ...extra });
const library: Library = { schemaVersion: 1, id: 'mine', name: 'Mine', version: '1', modules: [] } as unknown as Library;

describe('snapshots', () => {
  it('tells saved projects from snapshots and lists snapshots newest first', () => {
    const all = [stored('a', 1), stored('s1', 5, { snapshot: true }), stored('s2', 9, { snapshot: true })];
    expect(savedProjects(all).map((p) => p.id)).toEqual(['a']);
    expect(snapshotsOf(all).map((p) => p.id)).toEqual(['s2', 's1']);
  });

  it('drops the oldest snapshots beyond the limit and never a saved project', () => {
    const snapshots = Array.from({ length: MAX_SNAPSHOTS + 3 }, (_, i) => stored(`s${i}`, i, { snapshot: true }));
    const drop = snapshotsToDrop([stored('keep', 0), ...snapshots]);
    expect(drop.map((p) => p.id)).toEqual(['s2', 's1', 's0']);
  });

  it('gives snapshots in the same millisecond different ids', () => {
    const first = newSnapshotId([], 100);
    const second = newSnapshotId([stored(first, 100, { snapshot: true })], 100);
    expect(first).toBe('snapshot-100');
    expect(second).toBe('snapshot-100-1');
  });
});

describe('project import plan', () => {
  it('adds a new project, leaves an identical one, and renames one whose id is taken by another project', () => {
    const existing = [stored('project-1', 1)];
    const other = { ...stored('project-1', 2), file: fileOf('p9') };
    const plan = planProjectImport(existing, [stored('project-1', 1), stored('fresh', 3), other]);
    expect(plan.unchanged).toBe(1);
    expect(plan.added).toBe(2);
    expect(plan.put.map((p) => p.id)).toEqual(['fresh', 'project-2']);
  });

  it('never gives two imported projects one id', () => {
    const a = { ...stored('x', 1), file: fileOf('p1') };
    const b = { ...stored('x', 2), file: fileOf('p2') };
    const plan = planProjectImport([a], [b, { ...b, file: fileOf('p3') }]);
    expect(new Set(plan.put.map((p) => p.id)).size).toBe(2);
  });
});

describe('workspace file', () => {
  const workspace = () =>
    buildWorkspace({
      savedAt: 5,
      current: fileOf(),
      projects: [stored('project-1', 1), stored('snapshot-2', 2, { snapshot: true })],
      libraries: [library],
      snippets: [],
      settings: { 'eebox:length-unit': 'mm' },
    });

  it('reads back what it wrote', () => {
    const parsed = parseWorkspace(workspaceToText(workspace()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.workspace.format).toBe(WORKSPACE_FORMAT);
    expect(parsed.workspace.projects.map((p) => p.id)).toEqual(['project-1', 'snapshot-2']);
    expect(parsed.workspace.projects[1]?.snapshot).toBe(true);
    expect(parsed.workspace.libraries.map((l) => l.id)).toEqual(['mine']);
    expect(parsed.workspace.settings['eebox:length-unit']).toBe('mm');
    expect(parsed.workspace.current).not.toBeNull();
  });

  it('accepts a backup with nothing in it', () => {
    const parsed = parseWorkspace(workspaceToText(buildWorkspace({ savedAt: 1, current: null, projects: [], libraries: [], snippets: [], settings: {} })));
    expect(parsed.ok).toBe(true);
  });

  it('refuses what is not a backup', () => {
    for (const text of ['', 'nope', '[]', '{}', JSON.stringify({ format: 'eebox-project' }), JSON.stringify({ ...workspace(), version: 2 })]) {
      expect(parseWorkspace(text).ok).toBe(false);
    }
  });

  it('refuses an unknown field, a setting that is not ours and an id that could be a path', () => {
    const base = JSON.parse(workspaceToText(workspace()));
    const messages = (change: (w: Record<string, unknown>) => void) => {
      const w = structuredClone(base);
      change(w);
      const parsed = parseWorkspace(JSON.stringify(w));
      return parsed.ok ? [] : parsed.errors.map((e) => `${e.path}: ${e.message}`);
    };
    expect(messages((w) => (w.extra = 1))).toEqual(['extra: unknown field']);
    expect(messages((w) => ((w.settings as Record<string, string>)['somebody:else'] = 'x')).join()).toContain('not a setting of this application');
    expect(messages((w) => ((w.projects as Array<{ id: string }>)[0]!.id = '../x')).join()).toContain('projects[0].id');
  });

  it('refuses a project inside the backup that does not load, and says where it is', () => {
    const base = JSON.parse(workspaceToText(workspace()));
    base.projects[0].file = { format: 'eebox-project' };
    const parsed = parseWorkspace(JSON.stringify(base));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]?.path.startsWith('projects[0].file')).toBe(true);
  });
});
