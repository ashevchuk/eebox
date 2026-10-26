import { describe, expect, it } from 'vitest';
import autoBackup from '../examples/workshop-auto-backup.json?raw';
import { energy } from '../src/electrical/energy';
import { parseProjectJson } from '../src/project/file';
import { setSourceOff } from '../src/schematic/model';
import type { Project } from '../src/project';

function load() {
  const result = parseProjectJson(autoBackup);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
  const { file } = result;
  const resolve = (ref: { libraryId: string; moduleId: string }) => file.modules[`${ref.libraryId}/${ref.moduleId}`];
  const nodeLabelled = (project: Project, label: string) => project.schematic.nodes.find((n) => n.label === label)!.id;
  const withOff = (project: Project, ...labels: string[]): Project => {
    let schematic = project.schematic;
    for (const label of labels) {
      const switched = setSourceOff(schematic, nodeLabelled(project, label), true);
      if (!switched.ok) throw new Error(switched.error.kind);
      schematic = switched.schematic;
    }
    return { ...project, schematic };
  };
  return { project: file.project, resolve, nodeLabelled, withOff };
}

const placementLabelled = (project: Project, label: string) => project.panel.placements.find((p) => p.label === label)!.id;

describe('the automatic backup example', () => {
  it('feeds the machines from the mains and keeps the generator contactor open', () => {
    const { project, resolve, nodeLabelled } = load();
    const power = energy(project, resolve);
    expect(power.deadNodes.has(nodeLabelled(project, 'Machines'))).toBe(false);
    expect(power.inputsOf(placementLabelled(project, 'KM1 mains'))).toEqual({ coil: true });
    expect(power.inputsOf(placementLabelled(project, 'KM2 generator'))).toEqual({ coil: false });
  });

  it('moves to the generator when the mains go away', () => {
    const { project, resolve, nodeLabelled, withOff } = load();
    const power = energy(withOff(project, 'Mains'), resolve);
    expect(power.deadNodes.has(nodeLabelled(project, 'Machines'))).toBe(false);
    expect(power.inputsOf(placementLabelled(project, 'KM1 mains'))).toEqual({ coil: false });
    expect(power.inputsOf(placementLabelled(project, 'KM2 generator'))).toEqual({ coil: true });
  });

  it('is dead when both supplies are gone', () => {
    const { project, resolve, nodeLabelled, withOff } = load();
    expect(energy(withOff(project, 'Mains', 'Generator'), resolve).deadNodes.has(nodeLabelled(project, 'Machines'))).toBe(true);
  });

  it('keeps the generator off the machines while the mains are present', () => {
    const { project, resolve, nodeLabelled, withOff } = load();
    const power = energy(withOff(project, 'Generator'), resolve);
    expect(power.inputsOf(placementLabelled(project, 'KM2 generator'))).toEqual({ coil: false });
    expect(power.deadNodes.has(nodeLabelled(project, 'Machines'))).toBe(false);
  });
});
