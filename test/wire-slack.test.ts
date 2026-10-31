import { describe, expect, it } from 'vitest';
import { DEFAULT_WIRE_SLACK_MM, MAX_WIRE_SLACK_MM } from '../src/layout/limits';
import { setWireSlack } from '../src/layout/panel';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { emptySchematic } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { panelOf, resolve } from './fixtures';

const projectWith = (slack?: number) => {
  const panel = panelOf([], [], [12]);
  return { panel: slack === undefined ? panel : { ...panel, wireSlackMm: slack }, schematic: emptySchematic() };
};
const ctx = (project: ReturnType<typeof projectWith>): InspectContext => ({ project, selection: {}, mode: 'panel', resolve, snapshot: {}, fromLibraries: resolve });

describe('the wire slack of a panel', () => {
  it('is kept by the panel model within its limits', () => {
    expect(setWireSlack(panelOf([]), -1)).toEqual({ ok: false, error: 'invalid-value' });
    expect(setWireSlack(panelOf([]), MAX_WIRE_SLACK_MM + 1)).toEqual({ ok: false, error: 'invalid-value' });
    const zero = setWireSlack(panelOf([]), 0);
    expect(zero.ok && zero.panel.wireSlackMm).toBe(0);
  });

  it('is edited in the inspector, shown as the default when none is set, and the default is not stored', () => {
    expect(inspect(ctx(projectWith()))!.fields.find((f) => f.key === 'wireSlack')).toMatchObject({ value: DEFAULT_WIRE_SLACK_MM });
    const set = applyEdit(ctx(projectWith()), 'wireSlack', '40');
    expect(set.ok && set.project.panel.wireSlackMm).toBe(40);
    const back = applyEdit(ctx(projectWith(40)), 'wireSlack', String(DEFAULT_WIRE_SLACK_MM));
    expect(back.ok && 'wireSlackMm' in back.project.panel).toBe(false);
    expect(applyEdit(ctx(projectWith()), 'wireSlack', String(MAX_WIRE_SLACK_MM + 1)).ok).toBe(false);
  });

  it('survives the project file, and only a number in range that is not the default is read', () => {
    const file = buildProjectFile(projectWith(40), resolve);
    const parsed = parseProjectJson(JSON.stringify(file));
    expect(parsed.ok && parsed.file.project.panel.wireSlackMm).toBe(40);
    for (const bad of [-5, MAX_WIRE_SLACK_MM + 1, DEFAULT_WIRE_SLACK_MM, '20']) {
      const raw = JSON.parse(JSON.stringify(file));
      raw.project.panel.wireSlackMm = bad;
      const result = parseProjectJson(JSON.stringify(raw));
      expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(['project.panel.wireSlackMm']);
    }
  });
});
