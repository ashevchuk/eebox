import { describe, expect, it } from 'vitest';
import { parseProjectJson } from '../src/project/file';
import housePanel from '../examples/house-panel.json?raw';
import { EXAMPLES } from '../src/examples';

describe('example projects', () => {
  it('house-panel.json loads and passes the project check', () => {
    const result = parseProjectJson(housePanel);
    if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    expect(result.warnings).toEqual([]);
    expect(result.file.project.panel.placements).toHaveLength(11);
    expect(result.file.project.schematic.wires.length).toBeGreaterThan(0);
  });
});

const files = import.meta.glob('../examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('the examples of the File menu', () => {
  it('are the files of the examples folder, each listed once', () => {
    expect(EXAMPLES.map((e) => e.text).sort()).toEqual(Object.values(files).sort());
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(new Set(EXAMPLES.map((e) => e.title)).size).toBe(EXAMPLES.length);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s loads and passes the project check', (_id, example) => {
    const result = parseProjectJson(example.text);
    if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    expect(result.warnings).toEqual([]);
    expect(result.file.project.panel.placements.length).toBeGreaterThan(3);
    expect(example.description.length).toBeGreaterThan(20);
  });

  it('show what the application can do: loads with cables, a backup input, an RCD', () => {
    const text = EXAMPLES.map((e) => e.text).join('');
    expect(text).toContain('"crossSectionMm2"');
    expect(text).toContain('"lengthM"');
    expect(text).toContain('changeover-4p-63');
    expect(text).toContain('rcd-4p-40-30');
  });
});
