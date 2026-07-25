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

test('appends a note to a null history', () => {
    const result = appendRerollNote(null, {source: 'Savage Attacker', before: 7, after: 9});
    assert.deepEqual(result, [{source: 'Savage Attacker', before: 7, after: 9}]);
});

test('formats with a null note without throwing', () => {
    const line = formatRerollNote('{source} — rerolled {before}, kept {after}', null);
    assert.equal(line, ' — rerolled , kept ');
});

test('an item literally named "{after}" is not re-substituted by a later replacement pass', () => {
    const line = formatRerollNote('{source} — rerolled {before}, kept {after}', {source: '{after}', before: 7, after: 9});
    assert.equal(line, '{after} — rerolled 7, kept 9');
});

test('a source containing $& is inserted literally, not expanded as a replacement pattern', () => {
    const line = formatRerollNote('{source} — rerolled {before}, kept {after}', {source: 'Sword $& of Doom', before: 7, after: 9});
    assert.equal(line, 'Sword $& of Doom — rerolled 7, kept 9');
});

test('carries the forced flag through', () => {
    const result = appendRerollNote([], {source: 'Piercer', before: 2, after: 1, forced: true});
    assert.equal(result[0].forced, true);
});

test('omits forced when the reroll was a choice', () => {
    const result = appendRerollNote([], {source: 'Savage Attacker', before: 7, after: 9});
    assert.equal('forced' in result[0], false);
});

test('forced template drops the "kept" claim', () => {
    const line = formatRerollNote('{source} — rerolled {before} → {after}', {source: 'Piercer', before: 2, after: 1, forced: true});
    assert.equal(line, 'Piercer — rerolled 2 → 1');
});
