import { describe, expect, it } from 'vitest';
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
