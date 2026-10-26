import { describe, expect, it } from 'vitest';
import type { Library, ModuleDef } from '../src/library/types';
import { addNode } from '../src/schematic/model';
import { Session, emptyProject } from '../src/ui/session';

const withNode = () => {
  const project = emptyProject();
  return {
    ...project,
    schematic: addNode(project.schematic, { kind: 'load', label: 'L', x: 0, y: 0 }).schematic,
  };
};

describe('Session', () => {
  it('drops a selection that undo made stale', () => {
    const session = new Session();
    session.commit(withNode());
    session.select({ nodeId: 'n1' });
    session.undo();
    expect(session.selection).toEqual({});
  });

  it('keeps a selection that is still valid after undo', () => {
    const session = new Session();
    session.commit(withNode());
    session.commit({ ...session.project });
    session.select({ nodeId: 'n1' });
    session.undo();
    expect(session.selection).toEqual({ nodeId: 'n1' });
  });

  it('notifies subscribers on every change', () => {
    const session = new Session();
    let calls = 0;
    session.subscribe(() => calls++);
    session.commit(withNode());
    session.select({});
    session.undo();
    expect(calls).toBe(3);
  });

  it('clears history and selection on reset', () => {
    const session = new Session();
    session.commit(withNode());
    session.select({ nodeId: 'n1' });
    session.reset(emptyProject());
    expect(session.canUndo).toBe(false);
    expect(session.selection).toEqual({});
  });
});

describe('Session and the stored module definitions', () => {
  const def = (name: string): ModuleDef => ({ id: 'm', kind: 'breaker', name, widthUnits: 1, poles: 1 });
  const ref = { libraryId: 'lib', moduleId: 'm' };
  const libraryWith = (name: string): Library => ({ schemaVersion: 1, id: 'lib', name: 'Lib', modules: [def(name)], enclosures: [] });

  it('prefers the stored definition over the library, and can look at the library alone', () => {
    const session = new Session();
    session.libraries = [libraryWith('From library')];
    expect(session.resolve(ref)?.name).toBe('From library');
    session.commit(session.project, { 'lib/m': def('Stored') });
    expect(session.resolve(ref)?.name).toBe('Stored');
    expect(session.libraryResolve(ref)?.name).toBe('From library');
  });

  it('keeps the stored definitions across a commit that does not pass any', () => {
    const session = new Session();
    session.commit(session.project, { 'lib/m': def('Stored') });
    session.commit({ ...session.project });
    expect(session.snapshot['lib/m']?.name).toBe('Stored');
  });

  it('undoes and redoes a change of stored definitions together with the project', () => {
    const session = new Session();
    session.commit(session.project, { 'lib/m': def('Old') });
    session.commit(session.project, { 'lib/m': def('New') });
    session.undo();
    expect(session.snapshot['lib/m']?.name).toBe('Old');
    session.redo();
    expect(session.snapshot['lib/m']?.name).toBe('New');
  });

  it('changes its revision even when only the stored definitions change, so autosave notices', () => {
    const session = new Session();
    const before = session.revision;
    session.commit(session.project, { 'lib/m': def('Stored') });
    expect(session.revision).not.toBe(before);
  });

  it('sets the definitions from a loaded file and clears them on reset', () => {
    const session = new Session();
    session.load({ format: 'eebox-project', version: 1, project: emptyProject(), modules: { 'lib/m': def('Loaded') } });
    expect(session.snapshot['lib/m']?.name).toBe('Loaded');
    session.reset(emptyProject());
    expect(session.snapshot).toEqual({});
  });
});
