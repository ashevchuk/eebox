import type { Project } from '../project';
import type { Mode } from './session';

export interface ShortcutGroup {
  title: string;
  /** Pairs of what is pressed and what happens. */
  entries: Array<[keys: string, what: string]>;
}

/** What the keyboard and the mouse do, as the help dialog lists it; keep it equal to the handlers in `main.ts` and the views. */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Everywhere',
    entries: [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z or Ctrl+Y', 'Redo'],
      ['Space + drag, or the middle button', 'Move the drawing'],
      ['Mouse wheel', 'Zoom, about the pointer'],
      ['Escape', 'Cancel what is being dragged; close a dialog'],
      ['Delete', 'Remove what is selected'],
      ['F', 'Zoom to what is selected, or show everything when nothing is'],
      ['Arrow keys', 'Move what is selected: modules by a unit along the rail and between rails (Alt: a quarter of a unit), schematic nodes by 10 mm (Shift: 50 mm)'],
      ['Tab, Shift+Tab', 'With something selected, select the next or previous module (or node); Escape lets go'],
      ['Enter', 'With something selected, go to its fields in the inspector'],
      ['Ctrl+F', 'Find a module, node or wire by its label, name or id'],
      ['?', 'This list'],
    ],
  },
  {
    title: 'Panel',
    entries: [
      ['Drag from the library', 'Put a module on a rail; others move aside'],
      ['Shift + click', 'Add to the selection'],
      ['Shift + drag on empty space', 'Select what is inside a rectangle'],
      ['Ctrl+A', 'Select all'],
      ['Ctrl+C, Ctrl+V', 'Copy and paste the selection'],
      ['Ctrl+D', 'Duplicate the selection'],
      ['R', 'Ruler: drag from point to point to measure; Escape puts it away'],
    ],
  },
  {
    title: 'Schematic',
    entries: [
      ['Drag from a terminal to a terminal', 'Wire them'],
      ['Shift + drag between nodes', 'Wire every pole at once ("Wire all poles" does the same)'],
      ['Drag a wire', 'Move the piece you took hold of; Escape cancels'],
      ['Drag the piece at a terminal sideways', 'Bend the wire there'],
      ['Shift + click on wires', 'Select several wires'],
      ['Ctrl + click on a node', 'Add the node to the selection, or take it out'],
      ['Ctrl + drag on empty space', 'Select the nodes inside a rectangle'],
      ['Shift + drag on empty space', 'Select the wires inside a rectangle'],
      ['Ctrl+A', 'Select all the nodes'],
      ['Nodes menu', 'Align, distribute and arrange the nodes'],
    ],
  },
  {
    title: 'Module designer, Face',
    entries: [
      ['Click, drag', 'Select a shape and move it; pull its handles to resize it'],
      ['Arrow keys, with Shift', 'Nudge the selected shape by 0.5 mm, or 5 mm'],
      ['Delete', 'Remove the selected shape'],
      ['Enter, double-click', 'Finish a polyline'],
      ['Ctrl+Z', 'Undo'],
    ],
  },
];

/**
 * A few lines for a drawing that has nothing on it yet, so a first-time user is told what to do; empty
 * when there is something to look at. They are drawn on the screen only and never in an export.
 */
export function emptyHint(project: Project, mode: Mode): string[] {
  if (mode === 'panel') {
    const { placements, combs, shelf } = project.panel;
    return placements.length + combs.length + shelf.length > 0 ? [] : ['Drag a module from the library onto a rail.', 'Press ? for the keys.'];
  }
  return project.schematic.nodes.length > 0 ? [] : ['Nothing to wire yet.', 'Nodes > Sync modules brings in the modules of the panel, and the same menu adds a source and loads.'];
}
