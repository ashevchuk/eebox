import { CONDUCTORS, type Conductor } from '../library/types';
import {
  BUILT_IN_SCHEMES,
  colourSchemeToText,
  coloursOf,
  parseColourScheme,
  styleOf,
  type ColourChoice,
  type ColourScheme,
  type ConductorColour,
  type Ground,
  type SchemeId,
} from '../view/colourScheme';
import { downloadBlob } from './download';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const MEANING: Record<Conductor, string> = {
  L: 'phase, decided by what feeds it',
  L1: 'phase 1 (A)',
  L2: 'phase 2 (B)',
  L3: 'phase 3 (C)',
  N: 'neutral',
  PE: 'protective earth',
  PEN: 'neutral and protective earth in one',
  C: 'contact, signal',
  DCP: 'DC plus',
  DCN: 'DC minus',
};

const GROUND_CSS: Record<Ground, string> = { dark: '#0b0c10', light: '#ffffff' };

/** A short piece of wire as it is drawn on a ground: with its outline and its stripe. */
function sample(colour: ConductorColour, conductor: Conductor, ground: Ground): HTMLElement {
  const holder = element('div', 'colour-ground');
  holder.style.background = GROUND_CSS[ground];
  const wire = element('div', 'colour-wire');
  const style = styleOf({ [conductor]: colour } as ColourScheme, conductor, ground);
  wire.style.background = style.stripe ? `repeating-linear-gradient(90deg, ${style.color} 0 7px, ${style.stripe} 7px 14px)` : style.color;
  wire.style.boxShadow = style.outline ? `0 0 0 1.5px ${style.outline}` : 'none';
  holder.append(wire);
  return holder;
}

/**
 * An HTML dialog to choose the colours conductors are drawn in: one of the built-in schemes, or colours
 * of your own, edited one conductor at a time and exported to or imported from a file. Resolves with the
 * choice, or null on cancel.
 */
export function chooseColours(current: ColourChoice): Promise<ColourChoice | null> {
  return new Promise((resolve) => {
    const dialog = element('dialog', 'app-dialog colours-dialog');
    let scheme: SchemeId = current.scheme;
    let custom: ColourScheme = current.custom;
    let draft: ColourScheme = coloursOf(current);

    const select = element('select');
    for (const built of BUILT_IN_SCHEMES) select.append(new Option(built.name, built.id));
    select.append(new Option('Custom', 'custom'));
    select.value = scheme;

    const table = element('table', 'colours-table');
    const head = table.createTHead().insertRow();
    for (const text of ['Conductor', 'Colour', 'Stripe', 'On the screen', 'On paper']) head.append(element('th', undefined, text));
    const body = table.createTBody();
    const previews = new Map<Conductor, HTMLElement[]>();
    const colourInputs = new Map<Conductor, { color: HTMLInputElement; stripeOn: HTMLInputElement; stripe: HTMLInputElement }>();

    const setDraft = (conductor: Conductor, value: ConductorColour) => {
      draft = { ...draft, [conductor]: value };
      scheme = 'custom';
      custom = draft;
      select.value = 'custom';
      renderPreview(conductor);
    };

    function renderPreview(conductor: Conductor): void {
      const cells = previews.get(conductor)!;
      cells[0]!.replaceChildren(sample(draft[conductor], conductor, 'dark'));
      cells[1]!.replaceChildren(sample(draft[conductor], conductor, 'light'));
    }

    for (const conductor of CONDUCTORS) {
      const row = body.insertRow();
      const name = row.insertCell();
      name.append(element('strong', undefined, conductor), element('span', 'colours-meaning', ` ${MEANING[conductor]}`));
      const color = element('input');
      color.type = 'color';
      color.setAttribute('aria-label', `${conductor} colour`);
      const stripeOn = element('input');
      stripeOn.type = 'checkbox';
      stripeOn.setAttribute('aria-label', `${conductor} has a stripe`);
      const stripe = element('input');
      stripe.type = 'color';
      stripe.setAttribute('aria-label', `${conductor} stripe colour`);
      row.insertCell().append(color);
      const stripeCell = row.insertCell();
      stripeCell.append(stripeOn, stripe);
      const dark = row.insertCell();
      const light = row.insertCell();
      previews.set(conductor, [dark, light]);
      colourInputs.set(conductor, { color, stripeOn, stripe });

      const read = (): ConductorColour => ({ color: color.value, ...(stripeOn.checked ? { stripe: stripe.value } : {}) });
      color.addEventListener('input', () => setDraft(conductor, read()));
      stripe.addEventListener('input', () => setDraft(conductor, read()));
      stripeOn.addEventListener('change', () => {
        stripe.disabled = !stripeOn.checked;
        setDraft(conductor, read());
      });
    }

    function fill(next: ColourScheme): void {
      for (const conductor of CONDUCTORS) {
        const { color, stripeOn, stripe } = colourInputs.get(conductor)!;
        const value = next[conductor];
        color.value = value.color;
        stripeOn.checked = value.stripe !== undefined;
        stripe.value = value.stripe ?? '#f2d21b';
        stripe.disabled = value.stripe === undefined;
        renderPreview(conductor);
      }
    }

    select.addEventListener('change', () => {
      scheme = select.value as SchemeId;
      draft = coloursOf({ scheme, custom });
      status.textContent = '';
      fill(draft);
    });

    const status = element('div', 'editor-errors');
    const button = (label: string, className?: string) => element('button', className, label);
    const importButton = button('Import…');
    const exportButton = button('Export…');
    const cancel = button('Cancel');
    const save = button('Save', 'primary');
    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;

    importButton.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const picked = file.files?.[0];
      file.value = '';
      if (!picked) return;
      const parsed = parseColourScheme(await picked.text());
      if (!parsed.ok) {
        status.textContent = `${picked.name} was not imported:\n${parsed.errors.slice(0, 4).map((e) => `${e.path || '(file)'}: ${e.message}`).join('\n')}`;
        return;
      }
      scheme = 'custom';
      custom = parsed.scheme;
      draft = parsed.scheme;
      select.value = 'custom';
      status.textContent = '';
      fill(draft);
    });
    exportButton.addEventListener('click', () => {
      downloadBlob(new Blob([colourSchemeToText(draft)], { type: 'application/json' }), 'colour-scheme.json');
    });
    cancel.addEventListener('click', () => dialog.close());

    let result: ColourChoice | null = null;
    save.addEventListener('click', () => {
      result = { scheme, custom };
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });

    const help = element(
      'p',
      'settings-hint',
      'Wires and terminals are drawn in these colours on the screen, in exports and in print. A colour that would be lost on the ground, such as black on the dark screen or yellow on paper, gets an outline. A stripe is drawn as alternating dashes on a wire and as half of a terminal.',
    );
    const chooser = element('label', 'colours-chooser');
    chooser.append(element('span', undefined, 'Scheme'), select);
    const actions = element('div', 'app-dialog-actions settings-actions');
    const files = element('div', 'settings-files');
    files.append(importButton, exportButton);
    actions.append(files, cancel, save);
    dialog.append(element('h2', undefined, 'Colours of the conductors'), help, chooser, table, status, actions, file);
    document.body.append(dialog);
    fill(draft);
    dialog.showModal();
    select.focus();
  });
}
