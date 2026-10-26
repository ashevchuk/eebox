import { applyEdit, inspect, type InspectContext, type InspectorField, type InspectorView as View } from './inspector';
import type { Session } from './session';

interface Control {
  field: InspectorField;
  input?: HTMLInputElement;
  hint?: HTMLElement;
  value?: HTMLElement;
  boxes?: Map<string, HTMLInputElement>;
}

/** Renders whatever `inspect` describes for the selection, and sends every edit through `applyEdit`. */
export class InspectorView {
  private signature = '';
  private controls = new Map<string, Control>();

  constructor(
    private readonly container: HTMLElement,
    private readonly session: Session,
    private readonly confirm: (message: string) => Promise<boolean>,
  ) {
    session.subscribe(() => this.refresh(false));
    this.refresh(false);
  }

  /** True while one of its fields has the focus. */
  owns(element: Element | null): boolean {
    return element !== null && this.container.contains(element);
  }

  private context(): InspectContext {
    const { project, selection, mode, resolve } = this.session;
    return { project, selection, mode, resolve };
  }

  /** `force` also rewrites the field being typed in, to revert an edit that was refused. */
  refresh(force: boolean): void {
    const view = inspect(this.context());
    if (!view) {
      this.signature = '';
      this.controls.clear();
      const hint = document.createElement('p');
      hint.className = 'inspector-empty';
      hint.textContent = 'Select a module, comb, row, node or wire to see and edit its properties.';
      this.container.replaceChildren(hint);
      return;
    }
    const signature = JSON.stringify([view.title, view.fields.map((f) => [f.key, f.kind, f.options])]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.build(view);
    }
    this.sync(view, force);
  }

  private build(view: View): void {
    this.controls.clear();
    const title = document.createElement('h3');
    title.textContent = view.title;
    this.container.replaceChildren(title);
    for (const field of view.fields) {
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
          box.addEventListener('change', () => void this.edit(field.key, this.ticked(control)));
          const wrap = document.createElement('label');
          wrap.append(box, ` ${option}`);
          control.boxes.set(option, box);
          cell.append(wrap);
        }
      } else {
        const input = document.createElement('input');
        input.type = field.kind === 'integer' ? 'number' : 'text';
        if (field.kind === 'integer') input.step = '1';
        else input.maxLength = 60;
        input.addEventListener('change', () => void this.edit(field.key, input.value));
        control.input = input;
        control.hint = document.createElement('div');
        control.hint.className = 'inspector-hint';
        cell.append(input, control.hint);
      }
      this.controls.set(field.key, control);
      row.append(label, cell);
      this.container.append(row);
    }
  }

  private sync(view: View, force: boolean): void {
    for (const field of view.fields) {
      const control = this.controls.get(field.key);
      if (!control) continue;
      control.field = field;
      if (control.value) control.value.textContent = String(field.value);
      if (control.boxes) {
        const ticked = new Set(field.value as string[]);
        control.boxes.forEach((box, option) => (box.checked = ticked.has(option)));
      }
      if (control.input) {
        const { input } = control;
        if (force || input !== document.activeElement) input.value = String(field.value);
        input.placeholder = field.placeholder ?? '';
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        if (control.hint) control.hint.textContent = field.hint ?? '';
      }
    }
  }

  private ticked(control: Control): string[] {
    return [...(control.boxes ?? [])].filter(([, box]) => box.checked).map(([option]) => option);
  }

  private async edit(key: string, raw: string | string[]): Promise<void> {
    let result = applyEdit(this.context(), key, raw);
    if (!result.ok && result.needsConfirm) {
      if (!(await this.confirm(result.needsConfirm.message))) {
        this.refresh(true);
        return;
      }
      result = applyEdit(this.context(), key, raw, { confirmed: true });
    }
    if (result.ok) {
      this.session.commit(result.project);
      if (result.selection) this.session.select(result.selection);
      return;
    }
    this.session.notify(result.message, true);
    this.refresh(true);
  }
}
