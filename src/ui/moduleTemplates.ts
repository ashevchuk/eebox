import { genericModules } from '../library/genericSeries';
import type { ModuleDef } from '../library/types';

export interface ModuleTemplate {
  id: string;
  label: string;
  build(id: string): ModuleDef;
}

const blank: ModuleTemplate = {
  id: 'blank',
  label: 'Blank, 1 unit',
  build: (id) => ({ id, kind: 'other', name: 'New module', widthUnits: 1, poles: 1 }),
};

/** A template made from a device of the bundled library, so its terminals are laid out sensibly. */
function fromBundled(sourceId: string, id: string, label: string): ModuleTemplate {
  return {
    id,
    label,
    build: (newId) => {
      const source = genericModules().find((m) => m.id === sourceId);
      if (!source) throw new Error(`the bundled library has no ${sourceId}`);
      return { ...structuredClone(source), id: newId, name: 'New module' };
    },
  };
}

export const MODULE_TEMPLATES: readonly ModuleTemplate[] = [
  blank,
  fromBundled('mcb-1p-c16', 'breaker', 'Circuit breaker, 1 pole'),
  fromBundled('contactor-3p-25-230', 'contactor', 'Contactor with a coil'),
  fromBundled('vrelay-1p', 'monitoring-relay', 'Monitoring relay with a contact'),
  fromBundled('impulse-relay-1p', 'lighting-relay', 'Lighting relay'),
  fromBundled('twilight-switch-1p', 'twilight-switch', 'Twilight switch with a sensor'),
  fromBundled('kwh-1p-40', 'meter', 'Energy meter'),
  fromBundled('pilot-light-230', 'indicator', 'Pilot light'),
  fromBundled('psu-24v-1a', 'power-supply', 'Power supply, 24 V DC'),
  fromBundled('changeover-2p-63', 'changeover', 'Changeover switch for a backup input'),
  fromBundled('pen-split-12', 'pen-splitter', 'PEN splitting block'),
];
