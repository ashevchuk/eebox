import { describe, expect, it } from 'vitest';
import { DUCT_FILL_LIMIT_PERCENT, WIRE_DIAMETER_MM, ductFills, findDuctFillFindings } from '../src/electrical/ductFill';
import { setDuctDepth } from '../src/layout/ducts';
import { deleteDuct } from '../src/project/delete';
import type { Project } from '../src/project';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { setWireDuct, setWireSection } from '../src/schematic/model';
import { applyEdit, inspect, type InspectContext } from '../src/ui/inspector';
import { panelOf, place, resolve } from './fixtures';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { connect, emptySchematic, syncModuleNodes } from '../src/schematic/model';

/** A duct 100 mm wide, 20 mm high (it is its narrower side that counts) and 50 mm deep: 5000 mm2 inside. */
function build(wiresInDuct = 1, section: number | null = 10): Project {
  const base = panelOf([place('p1', 'breaker16', 0, 0), place('p2', 'breaker16', 0, 4)], [], [24]);
  const duct = { id: 'd1', plate: base.plates[0]!.id, x: 0, y: 200, widthMm: 100, heightMm: 20, depthMm: 50 };
  const panel = { ...base, ducts: [duct] };
  let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
  const terminals = nodeTerminalsLookup(panel, resolve);
  for (const terminal of ['top:L', 'bottom:L'].slice(0, wiresInDuct)) {
    const wired = connect(schematic, terminals, { node: 'n1', terminal }, { node: 'n2', terminal });
    if (!wired.ok) throw new Error(wired.error.kind);
    schematic = wired.schematic;
  }
  for (const wire of [...schematic.wires]) {
    const ducted = setWireDuct(schematic, wire.id, 'd1');
    if (!ducted.ok) throw new Error('duct not set');
    schematic = ducted.schematic;
    if (section !== null) {
      const sized = setWireSection(schematic, wire.id, section);
      if (!sized.ok) throw new Error('section not set');
      schematic = sized.schematic;
    }
  }
  return { panel, schematic };
}

describe('duct fill', () => {
  it('sums the area of the wires said to run in a duct against the inside of the duct', () => {
    const [fill] = ductFills(build(2), resolve);
    const diameter = WIRE_DIAMETER_MM[10]!;
    expect(fill!.counted).toHaveLength(2);
    expect(fill!.ductMm2).toBe(20 * 50);
    expect(fill!.percent).toBeCloseTo((2 * Math.PI * diameter * diameter) / 4 / (20 * 50) * 100, 6);
  });

  it('does not count a wire without a cross-section, and says so', () => {
    const [fill] = ductFills(build(1, null), resolve);
    expect(fill!.counted).toEqual([]);
    expect(fill!.uncounted).toHaveLength(1);
    expect(fill!.percent).toBe(0);
  });

  it('works out nothing for a duct whose depth is not known', () => {
    const project = build();
    const cleared = setDuctDepth(project.panel, 'd1', 0);
    if (!cleared.ok) throw new Error('depth not cleared');
    expect(ductFills({ ...project, panel: cleared.panel }, resolve)).toEqual([]);
  });

  it('gives advice only for a duct filled past the limit', () => {
    expect(findDuctFillFindings(build(1), resolve)).toEqual([]);
    const full = build(2, 35);
    const shallow = setDuctDepth(full.panel, 'd1', 10);
    if (!shallow.ok) throw new Error('depth not set');
    const findings = findDuctFillFindings({ ...full, panel: shallow.panel }, resolve);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'advice', ducts: ['d1'] });
    expect(findings[0]!.message).toContain(`${DUCT_FILL_LIMIT_PERCENT} %`);
  });
});

describe('the duct of a wire', () => {
  const ctx = (project: Project, selection: InspectContext['selection']): InspectContext => ({ project, selection, mode: 'schematic', resolve, snapshot: {}, fromLibraries: resolve });

  it('is chosen in the wire inspector by the name of the duct, and cleared with an empty choice', () => {
    const project = build();
    const wire = project.schematic.wires[0]!;
    const fields = inspect(ctx(project, { wireId: wire.id }))!.fields;
    expect(fields.find((f) => f.key === 'duct')).toMatchObject({ kind: 'select', value: 'Duct (d1)', options: ['', 'Duct (d1)'] });
    const cleared = applyEdit(ctx(project, { wireId: wire.id }), 'duct', '');
    expect(cleared.ok && cleared.project.schematic.wires[0]!.duct).toBeUndefined();
    expect(applyEdit(ctx(project, { wireId: wire.id }), 'duct', 'Duct (d9)').ok).toBe(false);
  });

  it('is taken out of the wires when the duct is deleted', () => {
    const next = deleteDuct(build(), 'd1')!;
    expect(next.panel.ducts).toBeUndefined();
    expect(next.schematic.wires.every((w) => w.duct === undefined)).toBe(true);
    expect(deleteDuct(build(), 'd9')).toBeNull();
  });

  it('survives the project file, and a duct that does not exist is refused', () => {
    const project = build();
    const file = buildProjectFile(project, resolve);
    const parsed = parseProjectJson(JSON.stringify(file));
    expect(parsed.ok && parsed.file.project.schematic.wires[0]!.duct).toBe('d1');
    expect(parsed.ok && parsed.file.project.panel.ducts![0]!.depthMm).toBe(50);
    const raw = JSON.parse(JSON.stringify(file));
    raw.project.schematic.wires[0].duct = 'd9';
    const result = parseProjectJson(JSON.stringify(raw));
    expect(result.ok ? [] : result.errors.map((e) => e.path)).toEqual(['project.schematic.wires[0].duct']);
  });
});
