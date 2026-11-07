import houseText from '../examples/house-panel.json?raw';
import houseVerticalText from '../examples/house-panel-vertical.json?raw';
import studioText from '../examples/studio-flat.json?raw';
import workshopText from '../examples/workshop-backup.json?raw';
import autoBackupText from '../examples/workshop-auto-backup.json?raw';
import tncsText from '../examples/tn-c-s.json?raw';
import automationText from '../examples/automation-panel.json?raw';

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
    id: 'house-panel-vertical',
    title: 'House panel with vertical bars',
    description: 'The house panel with its neutral and earth bars as bars of one row of 12 terminals on a vertical rail beside the rows: the input on the first terminal, the loads on the next ones.',
    text: houseVerticalText,
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
  {
    id: 'automation-panel',
    title: 'Pump station with automation',
    description: 'Two plates: on the back plate a main switch, an RCD, breakers and a 24 V supply on rails, two soft starters and a meter on the plate, three cable ducts, a controller, an analog input module and a terminal strip carrying a 4-20 mA pressure signal; the door has the indicator lamps.',
    text: automationText,
  },
];
