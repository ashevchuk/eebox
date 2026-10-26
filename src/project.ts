import type { Panel } from './layout/placement';
import type { Schematic } from './schematic/model';

/** Everything the user edits; one History entry covers both parts. */
export interface Project {
  panel: Panel;
  schematic: Schematic;
}
