import type { Mode } from './session';

export interface TourStep {
  title: string;
  text: string;
  /** The element to point at, by id; the step is shown without a pointer when it is not on the page. */
  target: string;
  /** The view to be in for this step. */
  mode: Mode;
}

/** A first walk through the application: where things are, in the order a panel is made. */
export const TOUR_STEPS: readonly TourStep[] = [
  { title: 'Welcome', text: 'A panel is made in two views: the front of the cabinet, and the wiring between its modules. This takes a minute, and the ? button lists the keys.', target: 'stage', mode: 'panel' },
  { title: 'Put modules on the rails', text: 'Drag a module from the library onto a rail. Search by rating or name; your own modules live in My modules, and New module… draws one.', target: 'sidebar', mode: 'panel' },
  { title: 'Edit what is selected', text: 'Click a module to see and edit its label, position and settings here. Shift-click or drag over empty space to select several; the Modules menu lines them up.', target: 'inspector', mode: 'panel' },
  { title: 'Wire it', text: 'Switch to Schematic, then drag from one terminal to another. Give a load its power in the inspector, and the currents and cables follow.', target: 'mode-schematic', mode: 'panel' },
  { title: 'Check it', text: 'Check lists what is wrong and takes you to it; Export > Calculation summary says whether each circuit\'s cable, drop, breaker, RCD and earth hold.', target: 'check', mode: 'panel' },
  { title: 'Keep it', text: 'File > Projects keeps projects in this browser, with earlier states, and Back up everything puts it all in one file. Export prints and saves images.', target: 'menu-file', mode: 'panel' },
];

export const TOUR_DONE_KEY = 'eebox:tour-done';
