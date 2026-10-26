import { DEFAULT_CABLE_SETTINGS, cableSettingsToText, parseCableSettings, type CableSettings } from '../electrical/cables';

const MAX_SHOWN_ERRORS = 6;

/** An HTML dialog to edit the cable table and norms as text. Resolves with the new settings, or null on cancel. */
export function editCableSettings(current: CableSettings): Promise<CableSettings | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog settings-dialog';

    const title = document.createElement('h2');
    title.textContent = 'Cable settings';
    const help = document.createElement('p');
    help.textContent =
      'Current-carrying capacity per laying method, loaded conductors (2 or 3) and cross-section 1.5, 2.5, 4, 6, 10, 16, 25, 35 mm2; ' +
      'voltage drop limits in percent; resistivity in ohm mm2/m; reactance in ohm/m.';
    const text = document.createElement('textarea');
    text.className = 'settings-text';
    text.spellcheck = false;
    text.value = cableSettingsToText(current);
    const errors = document.createElement('div');
    errors.className = 'editor-errors';

    const button = (label: string) => {
      const el = document.createElement('button');
      el.textContent = label;
      return el;
    };
    const reset = button('Reset to built-in values');
    const cancel = button('Cancel');
    const save = button('Save');
    save.className = 'primary';

    let result: CableSettings | null = null;
    const check = () => {
      const parsed = parseCableSettings(text.value);
      const shown = parsed.ok ? [] : parsed.errors.slice(0, MAX_SHOWN_ERRORS).map((e) => `${e.path || '(settings)'}: ${e.message}`);
      errors.textContent = shown.join('\n');
      save.disabled = !parsed.ok;
      return parsed;
    };
    text.addEventListener('input', check);
    reset.addEventListener('click', () => {
      text.value = cableSettingsToText(DEFAULT_CABLE_SETTINGS);
      check();
    });
    cancel.addEventListener('click', () => dialog.close());
    save.addEventListener('click', () => {
      const parsed = check();
      if (!parsed.ok) return;
      result = parsed.settings;
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    actions.append(reset, cancel, save);
    dialog.append(title, help, text, errors, actions);
    document.body.append(dialog);
    check();
    dialog.showModal();
    text.focus();
  });
}
