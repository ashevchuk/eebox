import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { ModuleRef } from '../src/layout/placement';
import type { ModuleDef } from '../src/library/types';
import type { Project } from '../src/project';
import { loadAutosave, saveAutosave, type KeyValueStore } from '../src/project/autosave';
import { bomToCsv, buildBom } from '../src/project/bom';
import { buildProjectFile, parseProjectFile, parseProjectJson } from '../src/project/file';
import { decodeShare, encodeShare } from '../src/project/share';
import { connect, syncModuleNodes, addNode } from '../src/schematic/model';

const C16: ModuleDef = { id: 'c16', kind: 'breaker', name: 'MCB 1P C16', widthUnits: 1, poles: 1, ratedCurrentA: 16, curve: 'C', sku: 'SKU-1' };
const RCD: ModuleDef = { id: 'rcd', kind: 'rcd', name: 'RCD 2P', widthUnits: 2, poles: 2 };
const defs: Record<string, ModuleDef> = { 'lib/c16': C16, 'lib/rcd': RCD };
const resolve = (ref: ModuleRef) => defs[`${ref.libraryId}/${ref.moduleId}`];
const ref = (moduleId: string): ModuleRef => ({ libraryId: 'lib', moduleId });

function sampleProject(): Project {
  const panel = {
    ...createPanel([12]),
    placements: [
      { id: 'p1', module: ref('c16'), rail: 0, slot: 0 },
      { id: 'p2', module: ref('c16'), rail: 0, slot: 1 },
      { id: 'p3', module: ref('rcd'), rail: 0, slot: 4 },
    ],
  };
  let schematic = syncModuleNodes({ nodes: [], wires: [] }, panel, (r) => resolve(r)?.name ?? r.moduleId);
  const source = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: 0 });
  schematic = source.schematic;
  const wired = connect(schematic, source.node.id, 'n1');
  if (!wired.ok) throw new Error('fixture wiring failed');
  return { panel, schematic: wired.schematic };
}

function errorPaths(raw: unknown): string[] {
  const result = parseProjectFile(raw);
  if (result.ok) throw new Error('expected parse to fail');
  return result.errors.map((e) => e.path);
}

const validFile = () => structuredClone(buildProjectFile(sampleProject(), resolve));

describe('project file', () => {
  it('snapshots only the placed modules', () => {
    const file = buildProjectFile(sampleProject(), resolve);
    expect(Object.keys(file.modules).sort()).toEqual(['lib/c16', 'lib/rcd']);
  });

  it('round-trips through JSON without changes or warnings', () => {
    const file = buildProjectFile(sampleProject(), resolve);
    const result = parseProjectJson(JSON.stringify(file));
    expect(result).toEqual({ ok: true, file, warnings: [] });
  });

  it('reports the path of a bad field deep in the project', () => {
    const file = validFile();
    (file.project.panel.placements[1] as { slot: unknown }).slot = -1;
    expect(errorPaths(file)).toEqual(['project.panel.placements[1].slot']);
  });

  it.each([
    ['a wrong format tag', (f: Record<string, unknown>) => (f.format = 'other'), ['format']],
    ['a newer version', (f: Record<string, unknown>) => (f.version = 2), ['version']],
    ['a missing project', (f: Record<string, unknown>) => delete f.project, ['project']],
  ])('rejects %s', (_label, mutate, paths) => {
    const file = validFile() as unknown as Record<string, unknown>;
    mutate(file);
    expect(errorPaths(file)).toEqual(paths);
  });

  it('rejects duplicate ids and unknown fields', () => {
    const file = validFile();
    file.project.panel.placements[1]!.id = 'p1';
    (file.project.schematic.nodes[0] as unknown as Record<string, unknown>).colour = 'red';
    expect(errorPaths(file)).toEqual(
      expect.arrayContaining(['project.panel.placements[1].id', 'project.schematic.nodes[0].colour']),
    );
  });

  it('rejects a module snapshot whose key does not match its id', () => {
    const file = validFile();
    file.modules['lib/wrong'] = file.modules['lib/c16']!;
    expect(errorPaths(file)).toEqual(['modules["lib/wrong"]']);
  });

  it('rejects a non-object root and non-JSON text', () => {
    expect(errorPaths([])).toEqual(['']);
    const result = parseProjectJson('{ nope');
    expect(result.ok).toBe(false);
  });

  it('loads a structurally valid file with problems and warns about each', () => {
    const file = validFile();
    file.project.panel.placements[1]!.slot = 0;
    file.project.panel.placements.pop();
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error('should load');
    expect(result.warnings).toEqual([
      'placement p2: overlap with p1',
      'node n3: its module is not on the panel',
    ]);
  });
});

describe('share link', () => {
  it('round-trips a project', async () => {
    const file = buildProjectFile(sampleProject(), resolve);
    const decoded = await decodeShare(await encodeShare(file));
    expect(decoded).toEqual({ ok: true, file, warnings: [] });
  });

  it('produces URL-safe text', async () => {
    expect(await encodeShare(buildProjectFile(sampleProject(), resolve))).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reports garbage instead of throwing', async () => {
    for (const garbage of ['!!!not-base64!!!', 'AAAA', '']) {
      const result = await decodeShare(garbage);
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a payload that inflates past the limit', async () => {
    const big = { ...buildProjectFile(sampleProject(), resolve), padding: 'x'.repeat(2_000_000) };
    const encoded = await encodeShare(big as never);
    expect(encoded.length).toBeLessThan(50_000);
    const result = await decodeShare(encoded, 100_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toContain('exceeds');
  });
});

describe('autosave', () => {
  const memoryStore = (initial: Record<string, string> = {}): KeyValueStore => {
    const data = { ...initial };
    return { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };

  it('returns null when nothing is stored', () => {
    expect(loadAutosave(memoryStore())).toBeNull();
  });

  it('restores what was saved', () => {
    const store = memoryStore();
    const file = buildProjectFile(sampleProject(), resolve);
    expect(saveAutosave(store, file)).toBe(true);
    expect(loadAutosave(store)).toEqual({ ok: true, file, warnings: [] });
  });

  it('reports a corrupt autosave instead of treating it as empty', () => {
    const result = loadAutosave(memoryStore({ 'eebox:autosave': '{broken' }));
    expect(result?.ok).toBe(false);
  });

  it('reports a failed write and an unreadable store', () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(saveAutosave(throwing, buildProjectFile(sampleProject(), resolve))).toBe(false);
    expect(loadAutosave(throwing)?.ok).toBe(false);
  });
});

describe('bill of materials', () => {
  it('groups identical modules and counts them', () => {
    const rows = buildBom(sampleProject().panel, resolve);
    expect(rows.map((r) => [r.moduleId, r.quantity])).toEqual([
      ['c16', 2],
      ['rcd', 1],
    ]);
  });

  it('keeps modules missing from the library as flagged rows', () => {
    const panel = { ...createPanel([4]), placements: [{ id: 'p1', module: ref('ghost'), rail: 0, slot: 0 }] };
    const csv = bomToCsv(buildBom(panel, resolve));
    expect(csv).toContain('lib,ghost,,(missing module)');
  });

  it('writes a header and one CRLF line per row', () => {
    const lines = bomToCsv(buildBom(sampleProject().panel, resolve)).split('\r\n');
    expect(lines[0]).toBe(
      'Library,Module,SKU,Name,Kind,Poles,Rated current (A),Curve,Breaking capacity (kA),Residual current (mA),Width (units),Quantity',
    );
    expect(lines[1]).toBe('lib,c16,SKU-1,MCB 1P C16,breaker,1,16,C,,,1,2');
    expect(lines[3]).toBe('');
  });

  it('quotes commas, quotes and newlines', () => {
    const tricky: ModuleDef = { ...C16, id: 'x', name: 'A, "B"\nC' };
    const panel = { ...createPanel([4]), placements: [{ id: 'p1', module: ref('x'), rail: 0, slot: 0 }] };
    const csv = bomToCsv(buildBom(panel, () => tricky));
    expect(csv).toContain('"A, ""B""\nC"');
  });

  it.each(['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx'])('neutralises the formula %j', (name) => {
    const evil: ModuleDef = { ...C16, id: 'x', name };
    const panel = { ...createPanel([4]), placements: [{ id: 'p1', module: ref('x'), rail: 0, slot: 0 }] };
    const csv = bomToCsv(buildBom(panel, () => evil));
    expect(csv).toContain(`,'${name},`);
  });
});

describe('panel spacing in the project file', () => {
  it('round-trips custom row spacing', () => {
    const project = sampleProject();
    const panel = { ...createPanel([12, 18]), railPitchesMm: [210], placements: project.panel.placements };
    const file = buildProjectFile({ ...project, panel }, resolve);
    expect(parseProjectJson(JSON.stringify(file))).toEqual({ ok: true, file, warnings: [] });
  });

  it('fills the default spacing when an older file has none', () => {
    const file = JSON.parse(JSON.stringify(validFile()));
    file.project.panel.railLengthsUnits = [12, 12, 12];
    delete file.project.panel.railPitchesMm;
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error('should load');
    expect(result.file.project.panel.railPitchesMm).toEqual([150, 150]);
  });

  it('rejects a spacing list that does not match the rows', () => {
    const file = validFile();
    file.project.panel.railPitchesMm = [150];
    expect(errorPaths(file)).toEqual(['project.panel.railPitchesMm']);
  });

  it('rejects out-of-range spacing and absurd rail lengths', () => {
    const file = validFile();
    file.project.panel.railLengthsUnits = [12, 12];
    file.project.panel.railPitchesMm = [50];
    expect(errorPaths(file)).toEqual(['project.panel.railPitchesMm']);
    file.project.panel.railPitchesMm = [150];
    file.project.panel.railLengthsUnits = [1_000_000_000, 12];
    expect(errorPaths(file)).toEqual(['project.panel.railLengthsUnits']);
  });
});
