import { PAPER_SIZES_MM, PRINT_PARTS, PRINT_PART_NAMES, anythingToPrint, type Orientation, type Paper, type PrintOptions } from '../project/printOptions';

/** Asks what to print and on which paper; resolves with the choice, or null if cancelled. */
export function openPrintDialog(start: PrintOptions): Promise<PrintOptions | null> {
  const options: PrintOptions = { ...start, parts: { ...start.parts } };
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog print-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Print';

    const parts = document.createElement('fieldset');
    parts.append(Object.assign(document.createElement('legend'), { textContent: 'What to print' }));
    const print = document.createElement('button');
    print.className = 'primary';
    print.textContent = 'Print';
    for (const part of PRINT_PARTS) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = options.parts[part];
      box.addEventListener('change', () => {
        options.parts[part] = box.checked;
        print.disabled = !anythingToPrint(options);
      });
      label.append(box, ` ${PRINT_PART_NAMES[part]}`);
      parts.append(label);
    }

    const select = <T extends string>(name: string, values: readonly T[], current: T, set: (value: T) => void) => {
      const label = document.createElement('label');
      const field = document.createElement('select');
      for (const value of values) field.append(new Option(value, value, false, value === current));
      field.addEventListener('change', () => set(field.value as T));
      label.append(`${name} `, field);
      return label;
    };
    const page = document.createElement('div');
    page.className = 'print-page';
    page.append(
      select('Paper', Object.keys(PAPER_SIZES_MM) as Paper[], options.paper, (v) => (options.paper = v)),
      select('Orientation', ['landscape', 'portrait'] as Orientation[], options.orientation, (v) => (options.orientation = v)),
    );

    const note = document.createElement('p');
    note.className = 'print-note';
    note.textContent = 'The browser shows the pages before it prints. A drawing is scaled to the width of the page; the full-size print has its own item in the menu.';

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    let answer: PrintOptions | null = null;
    cancel.addEventListener('click', () => dialog.close());
    print.addEventListener('click', () => {
      answer = options;
      dialog.close();
    });
    actions.append(cancel, print);
    dialog.append(title, parts, page, note, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
