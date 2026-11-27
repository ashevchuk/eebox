import { LEGEND_COLUMN_NAMES, LEGEND_COLUMNS, LEGEND_ORIENTATIONS, LEGEND_PAPERS, MAX_LEGEND_FONT_MM, MIN_LEGEND_FONT_MM, type LegendSettings } from '../layout/legend';

/** Asks which columns, what size of letters and which paper the legend is printed with; null when closed. */
export function openLegendDialog(start: LegendSettings): Promise<LegendSettings | null> {
  const settings: LegendSettings = { ...start, columns: [...start.columns] };
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog print-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Print legend';

    const print = document.createElement('button');
    print.className = 'primary';
    print.textContent = 'Print';
    const columns = document.createElement('fieldset');
    columns.append(Object.assign(document.createElement('legend'), { textContent: 'Columns' }));
    for (const column of LEGEND_COLUMNS) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = settings.columns.includes(column);
      box.addEventListener('change', () => {
        settings.columns = LEGEND_COLUMNS.filter((c) => (c === column ? box.checked : settings.columns.includes(c)));
        print.disabled = settings.columns.length === 0;
      });
      label.append(box, ` ${LEGEND_COLUMN_NAMES[column]}`);
      columns.append(label);
    }

    const size = document.createElement('input');
    size.type = 'number';
    size.min = String(MIN_LEGEND_FONT_MM);
    size.max = String(MAX_LEGEND_FONT_MM);
    size.step = '0.5';
    size.value = String(settings.fontMm);
    size.addEventListener('change', () => {
      const value = Number(size.value);
      if (value >= MIN_LEGEND_FONT_MM && value <= MAX_LEGEND_FONT_MM) settings.fontMm = value;
      else size.value = String(settings.fontMm);
    });
    // Enter would also press the button that opened the dialog, which keeps the focus behind it.
    size.addEventListener('keydown', (e) => e.key === 'Enter' && e.preventDefault());
    const sizeLabel = document.createElement('label');
    sizeLabel.append('Letters ', size, ' mm');

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
      sizeLabel,
      select('Paper', LEGEND_PAPERS, settings.paper, (v) => (settings.paper = v)),
      select('Orientation', LEGEND_ORIENTATIONS, settings.orientation, (v) => (settings.orientation = v)),
    );

    const note = document.createElement('p');
    note.className = 'print-note';
    note.textContent = 'The legend lists the devices on the rails under the numbers and colours of their marking strips. The choice is kept with the project.';

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    let answer: LegendSettings | null = null;
    cancel.addEventListener('click', () => dialog.close());
    print.addEventListener('click', () => {
      answer = settings;
      dialog.close();
    });
    actions.append(cancel, print);
    dialog.append(title, columns, page, note, actions);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
