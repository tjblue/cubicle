// Attach handlers to each terminal instance so its events keep their pane identity.
export function listenForTerminalAttention(terminal, onAttention) {
  const osc = terminal.parser.registerOscHandler(9, value => {
    // OSC 9;4 is a progress report, not a notification.
    if (value.startsWith('4;')) return false;
    onAttention('notification');
    return true;
  });
  const bell = terminal.onBell(() => onAttention('bell'));
  return () => { osc.dispose(); bell.dispose(); };
}
