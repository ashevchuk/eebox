import { removeDuct } from '../layout/ducts';
import { removePlacement } from '../layout/placement';
import type { Project } from '../project';
import { removeUnwiredNodeOf } from '../schematic/model';

/** Deletes a module from its rail together with its schematic node, if the node has no wires. */
export function deletePlacement(project: Project, placementId: string): Project | null {
  const result = removePlacement(project.panel, placementId);
  if (!result.ok) return null;
  return { panel: result.panel, schematic: removeUnwiredNodeOf(project.schematic, placementId) };
}

/** Deletes a duct, and takes it out of the wires that were said to run in it. */
export function deleteDuct(project: Project, ductId: string): Project | null {
  const result = removeDuct(project.panel, ductId);
  if (!result.ok) return null;
  const wires = project.schematic.wires.map((w) => {
    if (w.duct !== ductId) return w;
    const { duct: _gone, ...rest } = w;
    return rest;
  });
  return { panel: result.panel, schematic: { ...project.schematic, wires } };
}
