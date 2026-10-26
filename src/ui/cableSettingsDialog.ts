import { DEFAULT_CABLE_SETTINGS, INSTALL_METHODS, cableSettingsToText, parseCableSettings, type CableSettings } from '../electrical/cables';
import { TRIP_CURVES } from '../library/types';
import {
  LOADED_CONDUCTOR_COUNTS,
  SECTION_COLUMNS,
  ampacityId,
  changedIds,
  checkDraft,
  draftOf,
  scalarId,
  tripId,
  type CableDraft,
  type ScalarField,
} from './cableSettingsEditor';
import { downloadBlob } from './download';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const SCALAR_LABELS: Record<ScalarField, string> = {
  lighting: 'Lighting circuits',
  other: 'Other circuits',
  resistivity: 'Resistivity',
  reactance: 'Reactance',
  faultVoltage: 'Voltage',
};

/** Where in the form a cell or field is, in words, for the list of problems. */
function describeId(id: string): string {
  const [kind, a, b, c] = id.split(':');
  if (kind === 'a') return `${a}, ${b} loaded, ${SECTION_COLUMNS[Number(c)]} mm2`;
  if (kind === 'f') return SCALAR_LABELS[a as ScalarField];
  if (kind === 't') return `Trip multiple ${a}`;
  return '';
}

/**
 * An HTML dialog to edit the cable table and the norms in a form. Values that differ from the built-in
 * ones are outlined, a wrong cell is marked where it is, and the settings can be exported to a file and
 * imported from one. Resolves with the new settings, or null on cancel.
 */
export function editCableSettings(current: CableSettings): Promise<CableSettings | null> {
  return new Promise((resolve) => {
    const dialog = element('dialog', 'app-dialog settings-dialog');
    let draft: CableDraft = draftOf(current);
    const inputs = new Map<string, HTMLInputElement>();
    let importMessage = '';

    const numberInput = (id: string, value: () => string, set: (text: string) => void): HTMLInputElement => {
      const input = element('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.spellcheck = false;
      input.value = value();
      input.addEventListener('input', () => {
        set(input.value);
        importMessage = '';
        refresh();
      });
      inputs.set(id, input);
      return input;
    };

    const table = element('table', 'settings-table');
    const head = table.createTHead().insertRow();
    head.append(element('th', undefined, 'Laying method, loaded conductors'));
    for (const section of SECTION_COLUMNS) head.append(element('th', undefined, `${section} mm²`));
    const body = table.createTBody();
    for (const method of INSTALL_METHODS) {
      for (const loaded of LOADED_CONDUCTOR_COUNTS) {
        const row = body.insertRow();
        if (loaded === LOADED_CONDUCTOR_COUNTS[0]) row.className = 'first-of-method';
        row.insertCell().textContent = `${method} · ${loaded} loaded`;
        SECTION_COLUMNS.forEach((_section, index) => {
          row.insertCell().append(
            numberInput(ampacityId(method, loaded, index), () => draft.ampacity[method][loaded][index]!, (text) => (draft.ampacity[method][loaded][index] = text)),
          );
        });
      }
    }

    const field = (label: string, unit: string, input: HTMLInputElement): HTMLElement => {
      const row = element('label', 'settings-field');
      row.append(element('span', 'settings-label', label), input, element('span', 'settings-unit', unit));
      return row;
    };
    const scalar = (name: ScalarField, unit: string) =>
      field(SCALAR_LABELS[name], unit, numberInput(scalarId(name), () => draft.scalars[name], (text) => (draft.scalars[name] = text)));

    const group = (title: string, hint: string | undefined, ...children: HTMLElement[]): HTMLElement => {
      const section = element('section', 'settings-group');
      section.append(element('h3', undefined, title));
      if (hint) section.append(element('p', 'settings-hint', hint));
      section.append(...children);
      return section;
    };

    const trips = element('div', 'settings-trips');
    for (const curve of TRIP_CURVES) {
      trips.append(field(`Curve ${curve}`, '× rating', numberInput(tripId(curve), () => draft.trip[curve], (text) => (draft.trip[curve] = text))));
    }

    const scroll = element('div', 'settings-scroll');
    scroll.append(
      group('Current-carrying capacity, A', 'Per laying method, number of loaded conductors (2 or 3) and cross-section. Each value has to be larger than the one on its left.', table),
      group(
        'Voltage drop limit, % of the phase voltage',
        undefined,
        scalar('lighting', '%'),
        scalar('other', '%'),
      ),
      group('Cable conductor', 'Used for the voltage drop and the fault loop.', scalar('resistivity', 'Ω·mm²/m'), scalar('reactance', 'Ω/m')),
      group(
        'Fault loop check',
        'The voltage that drives the fault current, and the multiple of its rating at which a breaker of each curve trips at once.',
        scalar('faultVoltage', 'V'),
        trips,
      ),
    );

    const errors = element('div', 'editor-errors');
    const button = (label: string, className?: string) => element('button', className, label);
    const importButton = button('Import…');
    const exportButton = button('Export…');
    const reset = button('Reset to built-in values');
    const cancel = button('Cancel');
    const save = button('Save', 'primary');
    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;

    function refresh(): void {
      const check = checkDraft(draft);
      const changed = changedIds(draft, DEFAULT_CABLE_SETTINGS);
      const bad = new Set(check.problems.map((p) => p.id));
      for (const [id, input] of inputs) {
        input.classList.toggle('invalid', bad.has(id));
        input.classList.toggle('changed', !bad.has(id) && changed.has(id));
        input.title = check.problems.find((p) => p.id === id)?.message ?? (changed.has(id) ? 'Differs from the built-in value' : '');
      }
      const lines = check.problems.map((p) => (p.id ? `${describeId(p.id)}: ${p.message}` : p.message));
      errors.textContent = [importMessage, ...lines.slice(0, 6), lines.length > 6 ? `${lines.length - 6} more` : ''].filter(Boolean).join('\n');
      save.disabled = check.settings === null;
      exportButton.disabled = check.settings === null;
    }

    function show(settings: CableSettings): void {
      draft = draftOf(settings);
      for (const method of INSTALL_METHODS) {
        for (const loaded of LOADED_CONDUCTOR_COUNTS) {
          draft.ampacity[method][loaded].forEach((value, i) => (inputs.get(ampacityId(method, loaded, i))!.value = value));
        }
      }
      for (const name of Object.keys(draft.scalars) as ScalarField[]) inputs.get(scalarId(name))!.value = draft.scalars[name];
      for (const curve of TRIP_CURVES) inputs.get(tripId(curve))!.value = draft.trip[curve];
      refresh();
    }

    let result: CableSettings | null = null;
    reset.addEventListener('click', () => {
      importMessage = '';
      show(DEFAULT_CABLE_SETTINGS);
    });
    importButton.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const picked = file.files?.[0];
      file.value = '';
      if (!picked) return;
      const parsed = parseCableSettings(await picked.text());
      if (!parsed.ok) {
        const shown = parsed.errors.slice(0, 4).map((e) => `${e.path || '(settings)'}: ${e.message}`);
        importMessage = `${picked.name} was not imported:\n${shown.join('\n')}`;
        refresh();
        return;
      }
      importMessage = '';
      show(parsed.settings);
    });
    exportButton.addEventListener('click', () => {
      const { settings } = checkDraft(draft);
      if (settings) downloadBlob(new Blob([cableSettingsToText(settings)], { type: 'application/json' }), 'cable-settings.json');
    });
    cancel.addEventListener('click', () => dialog.close());
    save.addEventListener('click', () => {
      const { settings } = checkDraft(draft);
      if (!settings) return;
      result = settings;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    const title = element('h2', undefined, 'Cable settings');
    const help = element(
      'p',
      'settings-hint',
      'Used to size cables, to check the voltage drop and the fault loop. Values that differ from the built-in ones are outlined. The built-in ampacities match IEC 60364-5-52:2009; the other built-in values are not verified.',
    );
    const actions = element('div', 'app-dialog-actions settings-actions');
    const files = element('div', 'settings-files');
    files.append(importButton, exportButton, reset);
    actions.append(files, cancel, save);
    dialog.append(title, help, scroll, errors, actions, file);
    document.body.append(dialog);
    refresh();
    dialog.showModal();
    inputs.values().next().value?.focus();
  });
}
