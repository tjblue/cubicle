import test from 'node:test';
import assert from 'node:assert/strict';
import { matchSessionEvent } from '../src/session-matcher.js';
const event = { provider: 'codex', receivedAt: '2026-11-07T02:14:08.247Z', event: { session_id: '01a1b3bf-d7c5-7223-93ff-369132cf0b26', cwd: 'C:\\Users\\tyler', source: 'resume' } };
const base = { paneId: 'a', terminalId: 'term-a', cwd: 'c:/users/TYLER/', providers: ['codex'], enters: [Date.parse('2026-11-07T02:14:07.598Z')] };
test('matches a single live CLI by time and normalized folder', () => { const x = matchSessionEvent(event, [base]); assert.equal(x.status, 'matched'); assert.equal(x.binding.sessionId, event.event.session_id); });
test('does not choose between two matching panes', () => assert.equal(matchSessionEvent(event, [base, { ...base, paneId:'b' }]).status, 'ambiguous'));
test('does not match wrong provider, folder, or stale input', () => { for (const candidate of [{ ...base, providers:['claude'] }, { ...base, cwd:'C:/elsewhere' }, { ...base, enters:[base.enters[0] - 30000] }]) assert.equal(matchSessionEvent(event, [candidate]).status, 'unmatched'); });
test('ignores unrelated events and invalid IDs', () => { assert.equal(matchSessionEvent({ ...event, event: { ...event.event, source:'compact' } }, [base]).status, 'invalid'); assert.equal(matchSessionEvent({ ...event, event: { ...event.event, session_id:'not-a-uuid' } }, [base]).status, 'invalid'); });
