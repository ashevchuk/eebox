import { DEFAULT_PLATE_NAME_SIZE_MM, addPlate, renamePlate } from '../layout/plates';
import { askForText } from './textDialog';
import type { Session } from './session';

/** What a new plate measures until it is resized: a door of an ordinary cabinet. */
const NEW_PLATE_WIDTH_MM = DEFAULT_PLATE_NAME_SIZE_MM.width;
const NEW_PLATE_HEIGHT_MM = DEFAULT_PLATE_NAME_SIZE_MM.height;

const ERROR_TEXT = {
  'too-many': 'A panel has at most 8 plates.',
  'duplicate-name': 'Another plate has that name.',
  'invalid-value': 'A plate needs a name of 1 to 60 characters.',
} as const;

/**
 * The strip of tabs over the panel view, one for each plate, and a button that adds one. Choosing a
 * tab shows that plate; a double click renames it. What is on a plate is not touched by any of it.
 */
export class PlateTabs {
  constructor(
    private readonly container: HTMLElement,
    private readonly session: Session,
    private readonly onSwitch: () => void,
  ) {
    session.subscribe(() => this.render());
    this.render();
  }

  private render(): void {
    const { plates } = this.session.project.panel;
    const current = this.session.plateId;
    const buttons = plates.map((plate) => {
      const tab = document.createElement('button');
      tab.className = `plate-tab${plate.id === current ? ' active' : ''}`;
      tab.title = `${plate.name}: ${plate.widthMm} by ${plate.heightMm} mm. Double-click to rename`;
      const name = document.createElement('span');
      name.textContent = plate.name;
      name.translate = false;
      tab.append(name);
      tab.addEventListener('click', () => this.show(plate.id));
      tab.addEventListener('dblclick', () => void this.rename(plate.id, plate.name));
      return tab;
    });
    const add = document.createElement('button');
    add.className = 'plate-add';
    add.textContent = '+';
    add.title = 'Add a plate, such as a door';
    add.addEventListener('click', () => void this.add());
    this.container.replaceChildren(...buttons, add);
  }

  private show(id: string): void {
    if (id === this.session.plateId) return;
    this.session.plateId = id;
    this.session.select({});
    this.onSwitch();
  }

  private async add(): Promise<void> {
    const { panel } = this.session.project;
    const name = await askForText('Add a plate', 'Name', `Plate ${panel.plates.length + 1}`, 'Add');
    if (name === null) return;
    const result = addPlate(panel, name, NEW_PLATE_WIDTH_MM, NEW_PLATE_HEIGHT_MM);
    if (!result.ok || !result.id) {
      this.session.notify(ERROR_TEXT[(result.ok ? 'invalid-value' : result.error) as keyof typeof ERROR_TEXT] ?? 'That plate cannot be added.', true);
      return;
    }
    this.session.commit({ ...this.session.project, panel: result.panel });
    this.show(result.id);
  }

  private async rename(id: string, current: string): Promise<void> {
    const name = await askForText('Rename the plate', 'Name', current, 'Rename');
    if (name === null || name === current) return;
    const result = renamePlate(this.session.project.panel, id, name);
    if (!result.ok) {
      this.session.notify(ERROR_TEXT[result.error as keyof typeof ERROR_TEXT] ?? 'That plate cannot be renamed.', true);
      return;
    }
    this.session.commit({ ...this.session.project, panel: result.panel });
  }
}
