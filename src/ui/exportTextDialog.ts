import { EXPORT_GROUPS, buildTextOptions, setGroups } from './textOptions';
import type { TextVisibility } from '../view/textVisibility';

/** Asks which text PNG, SVG and print carry; resolves with the choice, or null if cancelled. */
export function openExportTextDialog(start: TextVisibility): Promise<TextVisibility | null> {
  let chosen = start;
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog export-text-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Text in exports and print';
    const note = document.createElement('p');
    note.className = 'print-note';
    note.textContent = 'These choices apply to PNG, SVG, the print sheet and the full-size print, and are kept apart from what the screen shows. Untick everything for a clean drawing.';
    const options = document.createElement('div');
    options.className = 'text-options';
    const render = () => buildTextOptions(options, EXPORT_GROUPS, chosen, (texts) => (chosen = texts));
    render();
    const preset = (label: string, shown: boolean) => {
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => {
        chosen = setGroups(chosen, EXPORT_GROUPS, shown);
        render();
      });
      return button;
    };
    const presets = document.createElement('div');
    presets.className = 'text-presets';
    presets.append(preset('All text', true), preset('No text', false));
    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    let answer: TextVisibility | null = null;
    cancel.addEventListener('click', () => dialog.close());
    const apply = document.createElement('button');
    apply.className = 'primary';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      answer = chosen;
      dialog.close();
    });
    actions.append(cancel, apply);
    dialog.append(title, note, presets, options, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
