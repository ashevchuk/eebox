import {
  MAX_LABEL_LENGTH,
  MAX_RAILS,
  MAX_RAIL_LENGTH_UNITS,
  MAX_RAIL_PITCH_MM,
  MIN_RAIL_PITCH_MM,
} from '../layout/limits';
import {
  moveRail,
  setRailCount,
  setRailLabel,
  setRailLength,
  setRailPitch,
  type PanelEditResult,
} from '../layout/panel';
import type { Panel } from '../layout/placement';
import type { Session } from './session';

interface RailRow {
  label: HTMLInputElement;
  length: HTMLInputElement;
  pitch: HTMLInputElement | null;
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

  private refresh(): void {
    if (!this.built || this.rows.length !== this.panel.railLengthsUnits.length) this.build();
    this.sync(false);
  }

  /** Inputs the user is typing in are left alone unless a rejected edit must be reverted. */
  private sync(force: boolean): void {
    const set = (input: HTMLInputElement, value: number | string) => {
      if (force || input !== document.activeElement) input.value = String(value);
    };
    set(this.countInput, this.panel.railLengthsUnits.length);
    this.rows.forEach((row, i) => {
      set(row.label, this.panel.railLabels[i] ?? '');
      set(row.length, this.panel.railLengthsUnits[i] ?? 0);
      if (row.pitch) set(row.pitch, this.panel.railPitchesMm[i] ?? 0);
      row.up.disabled = i === 0;
      row.down.disabled = i === this.rows.length - 1;
    });
  }

  private apply(compute: (panel: Panel) => PanelEditResult, rangeText: string): void {
    const result = compute(this.panel);
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
    this.container.replaceChildren(this.text('h3', 'Panel'));

    this.countInput = this.numberInput((value) =>
      this.apply((panel) => setRailCount(panel, value), `Rows: a whole number from 1 to ${MAX_RAILS}.`),
    );
    const countLine = this.text('div', 'Rows ', 'settings-line');
    countLine.append(this.countInput);
    this.container.append(countLine);

    const count = this.panel.railLengthsUnits.length;
    this.rows = [];
    for (let rail = 0; rail < count; rail++) {
      const length = this.numberInput((value) =>
        this.apply(
          (panel) => setRailLength(panel, this.session.widthOf, rail, value),
          `Units: a whole number from 1 to ${MAX_RAIL_LENGTH_UNITS}.`,
        ),
      );
      const up = this.button('↑', 'Move row up', () =>
        this.apply((panel) => moveRail(panel, rail, rail - 1), ''),
      );
      const down = this.button('↓', 'Move row down', () =>
        this.apply((panel) => moveRail(panel, rail, rail + 1), ''),
      );
      const line = this.text('div', `Row ${rail + 1} `, 'settings-line');
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

      let pitch: HTMLInputElement | null = null;
      if (rail < count - 1) {
        pitch = this.numberInput((value) =>
          this.apply(
            (panel) => setRailPitch(panel, rail, value),
            `Spacing: a whole number from ${MIN_RAIL_PITCH_MM} to ${MAX_RAIL_PITCH_MM} mm.`,
          ),
        );
        const gap = this.text('div', '↕ ', 'settings-line settings-gap');
        gap.append(pitch, this.text('span', ' mm between rails'));
        this.container.append(gap);
      }
      this.rows.push({ label, length, pitch, up, down });
    }
  }
}
