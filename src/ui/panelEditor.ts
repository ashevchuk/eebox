import {
  MAX_LABEL_LENGTH,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_POSITION_MM,
} from '../layout/limits';
import {
  moveRail,
  setRailLabel,
  setRailLength,
  setRailPosition,
  type PanelEditResult,
} from '../layout/panel';
import { setRailCountOnPlate, type PlateResult } from '../layout/plates';
import type { Panel } from '../layout/placement';
import type { Session } from './session';

interface RailRow {
  label: HTMLInputElement;
  length: HTMLInputElement;
  x: HTMLInputElement;
  y: HTMLInputElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
}

const ERROR_TEXT = {
  'unknown-rail': 'That row does not exist.',
  'rail-not-empty': 'Move or delete the modules in the rows you are removing first.',
  'modules-do-not-fit': 'Modules on this row would not fit; move or delete them first.',
} as const;

/** Edits the number of rows, the length of each rail, the spacing between rails and the row order. */
export class PanelEditor {
  private countInput!: HTMLInputElement;
  private rows: RailRow[] = [];
  private built = false;
  private builtFor = '';

  constructor(
    private readonly container: HTMLElement,
    private readonly session: Session,
  ) {
    session.subscribe(() => this.refresh());
    this.refresh();
  }

  private get panel(): Panel {
    return this.session.project.panel;
  }

  /** The rows of the plate on view: the first of them in the panel, and how many there are. */
  private get plateRows(): { offset: number; count: number; plate: string } {
    const { offset, panel } = this.session.scope;
    return { offset, count: panel.rails.length, plate: this.session.plateId };
  }

  private refresh(): void {
    const { offset, count, plate } = this.plateRows;
    const key = `${plate}:${offset}:${count}`;
    if (!this.built || this.builtFor !== key) this.build();
    this.sync(false);
  }

  /** Inputs the user is typing in are left alone unless a rejected edit must be reverted. */
  private sync(force: boolean): void {
    const set = (input: HTMLInputElement, value: number | string) => {
      if (force || input !== document.activeElement) input.value = String(value);
    };
    const { offset } = this.plateRows;
    set(this.countInput, this.rows.length);
    this.rows.forEach((row, i) => {
      const rail = this.panel.rails[offset + i];
      set(row.label, rail?.label ?? '');
      set(row.length, rail?.lengthUnits ?? 0);
      set(row.x, rail?.x ?? 0);
      set(row.y, rail?.y ?? 0);
      row.up.disabled = i === 0;
      row.down.disabled = i === this.rows.length - 1;
    });
  }

  private apply(compute: (panel: Panel) => PanelEditResult | PlateResult, rangeText: string): void {
    const raw = compute(this.panel);
    const result: PanelEditResult = raw.ok ? raw : { ok: false, error: raw.error === 'not-empty' ? 'rail-not-empty' : raw.error === 'invalid-value' ? 'invalid-value' : 'unknown-rail' };
    if (result.ok) {
      this.session.commit({ ...this.session.project, panel: result.panel });
      return;
    }
    this.session.notify(result.error === 'invalid-value' ? rangeText : ERROR_TEXT[result.error], true);
    this.sync(true);
  }

  private numberInput(onChange: (value: number) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.addEventListener('change', () => onChange(input.valueAsNumber));
    return input;
  }

  private textInput(onChange: (value: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = MAX_LABEL_LENGTH;
    input.placeholder = 'Row label';
    input.className = 'row-label';
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }

  private text(tag: string, content: string, className?: string): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = content;
    if (className) el.className = className;
    return el;
  }

  private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  private build(): void {
    this.built = true;
    const { offset, count, plate } = this.plateRows;
    this.builtFor = `${plate}:${offset}:${count}`;
    this.container.replaceChildren(this.text('h3', 'Panel'));

    this.countInput = this.numberInput((value) =>
      this.apply((panel) => (Number.isInteger(value) && value >= 1 ? setRailCountOnPlate(panel, plate, value) : { ok: false, error: 'invalid-value' }), `Rows: a whole number from 1 to ${MAX_RAILS}.`),
    );
    const countLine = this.text('div', 'Rows ', 'settings-line');
    countLine.append(this.countInput);
    this.container.append(countLine);

    this.rows = [];
    for (let local = 0; local < count; local++) {
      const rail = offset + local;
      const length = this.numberInput((value) =>
        this.apply(
          (panel) => setRailLength(panel, this.session.widthOf, rail, value),
          `Units: a whole number from 1 to ${MAX_RAIL_LENGTH_UNITS}.`,
        ),
      );
      const up = this.button('↑', 'Move row up', () =>
        this.apply((panel) => moveRail(panel, rail, rail - 1), ''),
      );
      up.disabled = local === 0;
      const down = this.button('↓', 'Move row down', () =>
        this.apply((panel) => moveRail(panel, rail, rail + 1), ''),
      );
      down.disabled = local === count - 1;
      const line = this.text('div', `Row ${local + 1} `, 'settings-line');
      line.addEventListener('focusin', () => this.session.select({ rail }));
      line.append(length, this.text('span', ' units '), up, down);
      const label = this.textInput((value) =>
        this.apply(
          (panel) => setRailLabel(panel, rail, value),
          `Row label: up to ${MAX_LABEL_LENGTH} characters, without line breaks.`,
        ),
      );
      const labelLine = this.text('div', '', 'settings-line');
      labelLine.addEventListener('focusin', () => this.session.select({ rail }));
      labelLine.append(label);
      this.container.append(line, labelLine);

      const place = (axis: 'x' | 'y') =>
        this.numberInput((value) =>
          this.apply(
            (panel) => setRailPosition(panel, rail, axis === 'x' ? value : panel.rails[rail]?.x ?? 0, axis === 'y' ? value : panel.rails[rail]?.y ?? 0),
            `Position: a number from 0 to ${MAX_RAIL_POSITION_MM} mm.`,
          ),
        );
      const x = place('x');
      const y = place('y');
      const positionLine = this.text('div', '', 'settings-line settings-gap');
      positionLine.addEventListener('focusin', () => this.session.select({ rail }));
      positionLine.append(this.text('span', 'x '), x, this.text('span', ' y '), y, this.text('span', ' mm'));
      this.container.append(positionLine);
      this.rows.push({ label, length, x, y, up, down });
    }
  }
}
