let pending = Promise.resolve();
let nextId = 0;

export function chooseAction(options) {
  const result = pending.then(() => showAction(options));
  pending = result.catch(() => {});
  return result;
}
function showAction({ title, message, choices, cancelValue = 'cancel' }) {
  return new Promise(resolve => {
    const opener = document.activeElement;
    const id = `app-confirm-${++nextId}`;
    const dialog = document.createElement('dialog'); dialog.className = 'app-confirm-dialog';
    dialog.setAttribute('aria-labelledby', `${id}-title`); dialog.setAttribute('aria-describedby', `${id}-message`);
    const heading = document.createElement('h2'); heading.id = `${id}-title`; heading.textContent = title; dialog.append(heading);
    const text = document.createElement('p'); text.id = `${id}-message`; text.textContent = message; dialog.append(text);
    for (const choice of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label;
      if (choice.danger) button.classList.add('danger');
      button.onclick = () => dialog.close(choice.value); dialog.append(button);
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(cancelValue); });
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue || cancelValue; dialog.remove();
      document.body.classList.remove('custom-dialog-open'); window.dispatchEvent(new Event('custom-dialog-visibility'));
      if (opener?.isConnected) opener.focus();
      resolve(result);
    }, { once: true });
    document.body.append(dialog); document.body.classList.add('custom-dialog-open');
    window.dispatchEvent(new Event('custom-dialog-visibility'));
    try { dialog.showModal(); dialog.querySelector('button:last-child')?.focus(); }
    catch { dialog.remove(); document.body.classList.remove('custom-dialog-open'); window.dispatchEvent(new Event('custom-dialog-visibility')); if (opener?.isConnected) opener.focus(); resolve(cancelValue); }
  });
}
