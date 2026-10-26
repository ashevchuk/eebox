import { removePlacement } from '../layout/placement';
import type { Project } from '../project';
import { removeUnwiredNodeOf } from '../schematic/model';

/** Deletes a module from its rail together with its schematic node, if the node has no wires. */
export function deletePlacement(project: Project, placementId: string): Project | null {
  const result = removePlacement(project.panel, placementId);
  if (!result.ok) return null;
  return { panel: result.panel, schematic: removeUnwiredNodeOf(project.schematic, placementId) };
}
