import { describe, expect, it } from 'vitest';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import type { Finding } from '../src/electrical/problems';
import { addNode, connect, emptySchematic } from '../src/schematic/model';
import { checkState, shouldPulse, type CheckState } from '../src/ui/checkState';
import { Session, emptyProject } from '../src/ui/session';

const finding = (severity: Finding['severity'], message: string): Finding => ({ message, severity, wires: [], nodes: [], placements: [] });

describe('the state of the Check button', () => {
  it('is clear when nothing was found', () => {
    expect(checkState([])).toEqual({ level: 'clear', errors: 0, advice: 0, total: 0 });
  });

  it('is advice when only advice was found, and counts it', () => {
    expect(checkState([finding('advice', 'a'), finding('advice', 'b')])).toEqual({ level: 'advice', errors: 0, advice: 2, total: 2 });
  });

  it('is error as soon as one fault was found, whatever else there is', () => {
    expect(checkState([finding('advice', 'a'), finding('error', 'b'), finding('advice', 'c')])).toEqual({ level: 'error', errors: 1, advice: 2, total: 3 });
  });
});

describe('when the button pulses', () => {
  const state = (errors: number, advice: number): CheckState => checkState([...Array(errors).fill(finding('error', 'e')), ...Array(advice).fill(finding('advice', 'a'))]);

  it('does not at the first look, which is the state of a project that was just opened', () => {
    expect(shouldPulse(null, state(2, 3))).toBe(false);
  });

  it('does when something new is found, a fault or advice', () => {
    expect(shouldPulse(state(0, 1), state(1, 1))).toBe(true);
    expect(shouldPulse(state(0, 1), state(0, 2))).toBe(true);
  });

  it('does not when nothing new came, or when something went away', () => {
    expect(shouldPulse(state(1, 1), state(1, 1))).toBe(false);
    expect(shouldPulse(state(1, 2), state(0, 1))).toBe(false);
    expect(shouldPulse(state(0, 0), state(0, 0))).toBe(false);
  });
});

/** A source with two phases wired to each other: one fault; and a load whose earth is not wired: one piece of advice. */
function projectWithFindings() {
  const project = emptyProject();
  let schematic = emptySchematic();
  schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: 0, conductors: ['L1', 'L2', 'N', 'PE'] }).schematic;
  schematic = addNode(schematic, { kind: 'load', label: 'Load', x: 0, y: 300, conductors: ['L1', 'N', 'PE'] }).schematic;
  const joined = connect(schematic, nodeTerminalsLookup(project.panel, () => undefined), { node: 'n1', terminal: 'bottom:L1' }, { node: 'n1', terminal: 'bottom:L2' });
  if (!joined.ok) throw new Error(joined.error.kind);
  return { ...project, schematic: joined.schematic };
}

describe('what the drawings mark', () => {
  const sessionWithFindings = () => {
    const session = new Session();
    session.commit(projectWithFindings());
    return session;
  };

  it('has findings to mark, a fault and a piece of advice', () => {
    const levels = sessionWithFindings().findings.map((f) => f.severity).sort();
    expect(levels).toEqual(['advice', 'error']);
  });

  it('is nothing while Check is closed', () => {
    expect(sessionWithFindings().markedFindings).toEqual([]);
  });

  it('is everything while Check is open', () => {
    const session = sessionWithFindings();
    session.checkOpen = true;
    expect(session.markedFindings).toEqual(session.findings);
  });

  it('is nothing while exporting, even with Check open', () => {
    const session = sessionWithFindings();
    session.checkOpen = true;
    session.marksVisible = false;
    expect(session.markedFindings).toEqual([]);
  });

  it('is the finding that was picked in the list, once Check is closed, and only that one', () => {
    const session = sessionWithFindings();
    const picked = session.findings.find((f) => f.severity === 'advice')!;
    session.focusFinding(picked);
    expect(session.markedFindings).toEqual([picked]);
  });

  it('does not list the picked finding twice while Check is open', () => {
    const session = sessionWithFindings();
    session.checkOpen = true;
    session.focusFinding(session.findings[0]!);
    expect(session.markedFindings).toEqual(session.findings);
  });

  it('forgets the picked finding when something else is selected', () => {
    const session = sessionWithFindings();
    session.focusFinding(session.findings[0]!);
    session.select({ nodeId: 'n2' });
    expect(session.markedFindings).toEqual([]);
  });
});
