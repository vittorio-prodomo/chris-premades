import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRerollNote, formatRerollNote } from './rerollNotes.mjs';

test('appends a note to an empty history', () => {
    const result = appendRerollNote(undefined, {source: 'Savage Attacker', before: 7, after: 9});
    assert.deepEqual(result, [{source: 'Savage Attacker', before: 7, after: 9}]);
});

test('appends alongside an existing note without mutating the original', () => {
    const existing = [{source: 'Piercer', before: 1, after: 5}];
    const result = appendRerollNote(existing, {source: 'Savage Attacker', before: 7, after: 9});
    assert.equal(result.length, 2);
    assert.equal(existing.length, 1, 'must not mutate the input array');
});

test('ignores an exact duplicate', () => {
    const existing = [{source: 'Savage Attacker', before: 7, after: 9}];
    const result = appendRerollNote(existing, {source: 'Savage Attacker', before: 7, after: 9});
    assert.equal(result.length, 1);
});

test('keeps two notes from the same source with different values', () => {
    const existing = [{source: 'Piercer', before: 1, after: 5}];
    const result = appendRerollNote(existing, {source: 'Piercer', before: 2, after: 6});
    assert.equal(result.length, 2);
});

test('rejects a note with no source', () => {
    assert.deepEqual(appendRerollNote([], {before: 1, after: 2}), []);
});

test('rejects a note with a missing value', () => {
    assert.deepEqual(appendRerollNote([], {source: 'Healer', before: 1}), []);
});

test('formats a note into the template', () => {
    const line = formatRerollNote('{source} — rerolled {before}, kept {after}', {source: 'Savage Attacker', before: 7, after: 9});
    assert.equal(line, 'Savage Attacker — rerolled 7, kept 9');
});

test('formats numeric zero correctly', () => {
    const line = formatRerollNote('{before}->{after}', {source: 'X', before: 0, after: 3});
    assert.equal(line, '0->3');
});
