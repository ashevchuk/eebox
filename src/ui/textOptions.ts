import { GENERAL_TEXTS, PANEL_TEXTS, SCHEMATIC_TEXTS, SHEET_TEXTS, TEXT_NAMES, type TextKind, type TextVisibility } from '../view/textVisibility';

export interface TextGroup {
  title: string;
  kinds: readonly TextKind[];
}

export const SCREEN_GROUPS: readonly TextGroup[] = [
  { title: 'Panel', kinds: PANEL_TEXTS },
  { title: 'Schematic', kinds: SCHEMATIC_TEXTS },
  { title: 'Notes', kinds: GENERAL_TEXTS },
];

export const EXPORT_GROUPS: readonly TextGroup[] = [...SCREEN_GROUPS, { title: 'Print sheet', kinds: SHEET_TEXTS }];

/** One checkbox per kind of text, under a heading for each group; `onChange` gets the whole new choice. */
export function buildTextOptions(container: HTMLElement, groups: readonly TextGroup[], start: TextVisibility, onChange: (texts: TextVisibility) => void): void {
  let current = start;
  container.replaceChildren();
  for (const group of groups) {
    const heading = document.createElement('div');
    heading.className = 'text-options-heading';
    heading.textContent = group.title;
    container.append(heading);
    for (const kind of group.kinds) {
      const label = document.createElement('label');
      label.className = 'text-option';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = current[kind];
      box.addEventListener('change', () => {
        current = { ...current, [kind]: box.checked };
        onChange(current);
      });
      label.append(box, ` ${TEXT_NAMES[kind]}`);
      container.append(label);
    }
  }
}

/** Sets every kind in the groups at once, leaving the others as they are. */
export function setGroups(texts: TextVisibility, groups: readonly TextGroup[], shown: boolean): TextVisibility {
  const next = { ...texts };
  for (const group of groups) for (const kind of group.kinds) next[kind] = shown;
  return next;
}
