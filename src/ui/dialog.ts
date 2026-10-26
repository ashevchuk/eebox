/** An HTML modal in place of the browser's native confirm box, which blocks the whole page. */
export function confirmDialog(message: string, confirmLabel = 'OK', cancelLabel = 'Cancel'): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';

    const text = document.createElement('p');
    text.textContent = message;

    const button = (label: string) => {
      const el = document.createElement('button');
      el.textContent = label;
      return el;
    };
    const cancel = button(cancelLabel);
    const confirm = button(confirmLabel);
    confirm.className = 'primary';

    let answer = false;
    confirm.addEventListener('click', () => {
      answer = true;
      dialog.close();
    });
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    actions.append(cancel, confirm);
    dialog.append(text, actions);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
