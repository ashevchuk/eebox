import { describe, expect, it } from 'vitest';
import { conductorsForSystem } from '../src/electrical/earthing';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Project } from '../src/project';
import { addNode, connect, emptySchematic } from '../src/schematic/model';
import { applyEdit, type InspectContext } from '../src/ui/inspector';
import { panelOf, resolve } from './fixtures';

const ctxOf = (project: Project): InspectContext => ({ project, selection: { nodeId: 'n1' }, mode: 'schematic', resolve, snapshot: {}, fromLibraries: resolve });

function projectWith(conductors: Array<'L1' | 'L2' | 'L3' | 'N' | 'PE' | 'PEN'>, wired = false): Project {
  const panel = panelOf([]);
  let schematic = addNode(emptySchematic(), { kind: 'source', label: 'Mains', x: 0, y: 0, conductors }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Oven', x: 0, y: 200, conductors: ['L1', 'N', 'PE'] }).schematic;
  if (wired) {
    const joined = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n1', terminal: 'bottom:N' }, { node: 'n2', terminal: 'top:N' });
    if (!joined.ok) throw new Error(joined.error.kind);
    schematic = joined.schematic;
  }
  return { panel, schematic };
}

describe('conductorsForSystem', () => {
  it('keeps the phases and gives what the system gives', () => {
    expect(conductorsForSystem('TN-S', ['L1', 'L2', 'L3', 'PEN'])).toEqual(['L1', 'L2', 'L3', 'N', 'PE']);
    expect(conductorsForSystem('TN-C-S', ['L', 'N', 'PE'])).toEqual(['L', 'PEN']);
    expect(conductorsForSystem('TT', ['L1', 'PEN'])).toEqual(['L1', 'N', 'PE']);
  });

  it('keeps an optional neutral where the source had one, and has none otherwise', () => {
    expect(conductorsForSystem('IT', ['L1', 'L2', 'L3', 'N', 'PE'])).toEqual(['L1', 'L2', 'L3', 'PE', 'N']);
    expect(conductorsForSystem('IT', ['L1', 'L2', 'L3', 'PEN'])).toEqual(['L1', 'L2', 'L3', 'PE']);
  });
});

describe('choosing the earthing system of a source in the inspector', () => {
  it('gives the source the conductors of the system and states it', () => {
    const result = applyEdit(ctxOf(projectWith(['L1', 'L2', 'L3', 'N', 'PE'])), 'earthing', 'TN-C-S');
    if (!result.ok) throw new Error(result.message);
    expect(result.project.schematic.nodes[0]).toMatchObject({ earthing: 'TN-C-S', conductors: ['L1', 'L2', 'L3', 'PEN'] });
  });

  it('asks before it removes a wire, and does it once confirmed', () => {
    const project = projectWith(['L1', 'L2', 'L3', 'N', 'PE'], true);
    const asked = applyEdit(ctxOf(project), 'earthing', 'TN-C-S');
    expect(asked.ok).toBe(false);
    expect(!asked.ok && asked.needsConfirm?.message).toMatch(/TN-C-S gives the source PEN; this removes 1 wire/);
    const confirmed = applyEdit(ctxOf(project), 'earthing', 'TN-C-S', { confirmed: true });
    if (!confirmed.ok) throw new Error(confirmed.message);
    expect(confirmed.project.schematic.wires).toEqual([]);
    expect(confirmed.project.schematic.nodes[0]?.conductors).toEqual(['L1', 'L2', 'L3', 'PEN']);
  });

  it('changes nothing but the setting when the conductors already fit, and leaves them alone for not stated', () => {
    const project = projectWith(['L1', 'L2', 'L3', 'N', 'PE'], true);
    const same = applyEdit(ctxOf(project), 'earthing', 'TT');
    if (!same.ok) throw new Error(same.message);
    expect(same.project.schematic.wires).toHaveLength(1);
    expect(same.project.schematic.nodes[0]).toMatchObject({ earthing: 'TT', conductors: ['L1', 'L2', 'L3', 'N', 'PE'] });
    const cleared = applyEdit(ctxOf(same.project), 'earthing', 'not stated');
    if (!cleared.ok) throw new Error(cleared.message);
    expect(cleared.project.schematic.nodes[0]).toMatchObject({ conductors: ['L1', 'L2', 'L3', 'N', 'PE'] });
    expect(cleared.project.schematic.nodes[0]).not.toHaveProperty('earthing');
  });
});
