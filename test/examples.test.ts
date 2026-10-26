import { describe, expect, it } from 'vitest';
import { parseProjectJson } from '../src/project/file';
import housePanel from '../examples/house-panel.json?raw';

describe('example projects', () => {
  it('house-panel.json loads and passes the project check', () => {
    const result = parseProjectJson(housePanel);
    if (!result.ok) throw new Error(result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    expect(result.warnings).toEqual([]);
    expect(result.file.project.panel.placements).toHaveLength(11);
    expect(result.file.project.schematic.wires.length).toBeGreaterThan(0);
  });
});
