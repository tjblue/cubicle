import test from 'node:test';
import assert from 'node:assert/strict';
import { listenForTerminalAttention } from '../src/terminal-attention.js';

test('routes OSC notifications and bells to their own terminals, excluding progress', () => {
  function terminal() {
    const handlers = {};
    return { handlers, parser: { registerOscHandler(id, fn) { assert.equal(id, 9); handlers.osc = fn; return { dispose() { handlers.osc = null; } }; } }, onBell(fn) { handlers.bell = fn; return { dispose() { handlers.bell = null; } }; } };
  }
  const first = terminal(), second = terminal(), events = [];
  const dispose = listenForTerminalAttention(first, kind => events.push(['first', kind]));
  listenForTerminalAttention(second, kind => events.push(['second', kind]));
  assert.equal(first.handlers.osc('4;1;50'), false);
  assert.equal(first.handlers.osc('9;C:\\work'), false);
  assert.equal(first.handlers.osc('Turn complete'), true);
  second.handlers.bell();
  assert.deepEqual(events, [['first', 'notification'], ['second', 'bell']]);
  dispose(); assert.equal(first.handlers.osc, null); assert.equal(first.handlers.bell, null);
});
