import houseText from '../examples/house-panel.json?raw';
import studioText from '../examples/studio-flat.json?raw';
import workshopText from '../examples/workshop-backup.json?raw';
import autoBackupText from '../examples/workshop-auto-backup.json?raw';
import tncsText from '../examples/tn-c-s.json?raw';

export interface Example {
  id: string;
  title: string;
  description: string;
  /** The project file, as it is stored in `examples/`. */
  text: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'studio-flat',
    title: 'Studio flat',
    description: 'Single phase: a main switch and three RCBO circuits (lights, sockets, boiler) under an L+N comb, with cables and voltage drop.',
    text: studioText,
  },
  {
    id: 'house-panel',
    title: 'House panel',
    description: 'Three phase: main switch, RCD, neutral and earth bars, a 3-phase comb over single-pole breakers, and three loads with cables.',
    text: houseText,
  },
  {
    id: 'workshop-backup',
    title: 'Workshop with a backup input',
    description: 'Three phase with a generator: a changeover switch between mains and generator, an RCD, a lathe on a 3-pole breaker and the lighting.',
    text: workshopText,
  },
  {
    id: 'workshop-auto-backup',
    title: 'Automatic backup with a transfer controller',
    description: 'Three phase: a transfer controller watches mains and generator and closes one of two contactors. Switch Mains off in the inspector to see the generator take over.',
    text: autoBackupText,
  },
  {
    id: 'tn-c-s',
    title: 'TN-C-S entry with a PEN conductor',
    description: 'Three phase from a PEN supply: the PEN conductor is split into N and PE in one block, an earth electrode is bonded to the PEN, and three RCBO circuits follow.',
    text: tncsText,
  },
];
