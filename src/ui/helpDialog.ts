import { SHORTCUTS } from './help';

/** The list of keys and gestures, in a dialog of its own. */
export function openHelpDialog(onTour?: () => void): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog help-dialog';
  const title = document.createElement('h2');
  title.textContent = 'Keys and gestures';
  dialog.append(title);
  for (const group of SHORTCUTS) {
    const heading = document.createElement('h3');
    heading.textContent = group.title;
    const table = document.createElement('table');
    for (const [keys, what] of group.entries) {
      const row = table.insertRow();
      const key = document.createElement('kbd');
      key.textContent = keys;
      row.insertCell().append(key);
      row.insertCell().textContent = what;
    }
    dialog.append(heading, table);
  }
  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.className = 'primary';
  close.addEventListener('click', () => dialog.close());
  if (onTour) {
    const tour = document.createElement('button');
    tour.textContent = 'Take the tour';
    tour.addEventListener('click', () => {
      dialog.close();
      onTour();
    });
    actions.append(tour);
  }
  actions.append(close);
  dialog.append(actions);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
