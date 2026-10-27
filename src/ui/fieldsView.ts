import type { InspectorAction, InspectorField, InspectorView as Model } from './inspector';

interface Control {
  field: InspectorField;
  input?: HTMLInputElement | HTMLTextAreaElement;
  select?: HTMLSelectElement;
  hint?: HTMLElement;
  value?: HTMLElement;
  boxes?: Map<string, HTMLInputElement>;
}

export interface FieldsHandlers {
  onEdit(key: string, raw: string | string[]): void;
  onAction(action: InspectorAction): void;
}

const NONE_LABEL = '(none)';

/**
 * Draws a list of described fields and reports edits and button presses. It knows nothing about
 * what the fields mean: the inspector and the library editor both describe themselves with fields.
 */
export class FieldsView {
  private signature = '';
  private controls = new Map<string, Control>();

  constructor(
    private readonly container: HTMLElement,
    private readonly handlers: FieldsHandlers,
    /** Puts the buttons under the title instead of after the fields, for forms too long to scroll to the end. */
    private readonly buttonsFirst = false,
  ) {}

  /** True while one of its fields has the focus. */
  owns(element: Element | null): boolean {
    return element !== null && this.container.contains(element);
  }

  /** `force` also rewrites the field being typed in, to revert an edit that was refused. */
  render(model: Model, force = false): void {
    const signature = JSON.stringify([
      model.title,
      model.fields.map((f) => [f.key, f.kind, f.options, f.label]),
      model.actions,
    ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(model);
    }
    this.sync(model, force);
  }

  private build(model: Model): void {
    this.controls.clear();
    const title = document.createElement('h3');
    title.textContent = model.title;
    this.container.replaceChildren(title);
    const bar = this.actionBar(model);
    if (bar && this.buttonsFirst) this.container.append(bar);
    for (const field of model.fields) {
      const row = document.createElement('div');
      row.className = 'inspector-field';
      const label = document.createElement('label');
      label.textContent = field.label;
      const control: Control = { field };
      const cell = document.createElement('div');
      cell.className = 'inspector-control';

      if (field.kind === 'readonly') {
        control.value = document.createElement('div');
        control.value.className = 'inspector-value';
        cell.append(control.value);
      } else if (field.kind === 'choices') {
        control.boxes = new Map();
        cell.className = 'inspector-control inspector-choices';
        for (const option of field.options ?? []) {
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.addEventListener('change', () => this.handlers.onEdit(field.key, this.ticked(control)));
          const wrap = document.createElement('label');
          wrap.append(box, ` ${option}`);
          control.boxes.set(option, box);
          cell.append(wrap);
        }
      } else if (field.kind === 'select') {
        const select = document.createElement('select');
        for (const option of field.options ?? []) {
          const element = document.createElement('option');
          element.value = option;
          element.textContent = option === '' ? NONE_LABEL : option;
          select.append(element);
        }
        select.addEventListener('change', () => this.handlers.onEdit(field.key, select.value));
        control.select = select;
        cell.append(select);
      } else if (field.kind === 'longtext') {
        const area = document.createElement('textarea');
        area.rows = 4;
        area.maxLength = field.max ?? 2000;
        area.addEventListener('change', () => this.handlers.onEdit(field.key, area.value));
        control.input = area;
        control.hint = document.createElement('div');
        control.hint.className = 'inspector-hint';
        cell.append(area, control.hint);
      } else {
        const input = document.createElement('input');
        input.type = field.kind === 'text' ? 'text' : 'number';
        if (field.kind === 'integer') input.step = '1';
        if (field.kind === 'number') input.step = 'any';
        if (field.kind === 'text') input.maxLength = 300;
        input.addEventListener('change', () => this.handlers.onEdit(field.key, input.value));
        control.input = input;
        control.hint = document.createElement('div');
        control.hint.className = 'inspector-hint';
        cell.append(input, control.hint);
      }
      this.controls.set(field.key, control);
      row.append(label, cell);
      this.container.append(row);
    }
    if (bar && !this.buttonsFirst) this.container.append(bar);
  }

  private actionBar(model: Model): HTMLElement | undefined {
    if (model.actions.length === 0) return undefined;
    const bar = document.createElement('div');
    bar.className = this.buttonsFirst ? 'inspector-actions first' : 'inspector-actions';
    for (const action of model.actions) {
      const button = document.createElement('button');
      button.textContent = action.label;
      button.addEventListener('click', () => this.handlers.onAction(action));
      bar.append(button);
    }
    return bar;
  }

  private sync(model: Model, force: boolean): void {
    for (const field of model.fields) {
      const control = this.controls.get(field.key);
      if (!control) continue;
      control.field = field;
      if (control.value) control.value.textContent = String(field.value);
      if (control.boxes) {
        const ticked = new Set(field.value as string[]);
        control.boxes.forEach((box, option) => (box.checked = ticked.has(option)));
      }
      if (control.select && (force || control.select !== document.activeElement)) control.select.value = String(field.value);
      if (control.input) {
        const { input } = control;
        if (force || input !== document.activeElement) input.value = String(field.value);
        input.placeholder = field.placeholder ?? '';
        if (input instanceof HTMLInputElement) {
          if (field.min !== undefined) input.min = String(field.min);
          if (field.max !== undefined) input.max = String(field.max);
        }
        if (control.hint) control.hint.textContent = field.hint ?? '';
      }
    }
  }

  private ticked(control: Control): string[] {
    return [...(control.boxes ?? [])].filter(([, box]) => box.checked).map(([option]) => option);
  }
}
