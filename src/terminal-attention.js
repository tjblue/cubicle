// Attach handlers to each terminal instance so its events keep their pane identity.
export function listenForTerminalAttention(terminal, onAttention) {
  const osc = terminal.parser.registerOscHandler(9, value => {
    // Progress and shell working-directory reports are not notifications.
    if (value.startsWith('4;') || value.startsWith('9;')) return false;
    onAttention('notification');
    return true;
  });
  const bell = terminal.onBell(() => onAttention('bell'));
  return () => { osc.dispose(); bell.dispose(); };
}
