import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendRerollNote, formatRerollNote, buildRerollTooltip } from './rerollNotes.mjs';

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

// --- buildRerollTooltip (T52): the note moves into a hover tooltip on the DAMAGE title ---

test('builds a tooltip in midi\'s attribution shape so its CSS applies', () => {
    const html = buildRerollTooltip('Rerolls', ['↻ Savage Attacker — rerolled 7, kept 9']);
    assert.match(html, /^<div class="midi-attribution-tooltip">/);
    assert.match(html, /<div class="attribution-header">Rerolls<\/div>/);
    assert.match(html, /<ul class="attribution-list">/);
    assert.match(html, /<li class="attribution-item"><span class="attribution-source">↻ Savage Attacker — rerolled 7, kept 9<\/span><\/li>/);
});

test('renders one item per note, in order', () => {
    const html = buildRerollTooltip('Rerolls', ['↻ Savage Attacker — rerolled 7, kept 9', '↻ Piercer — rerolled 2 → 1']);
    assert.equal(html.match(/<li class="attribution-item">/g).length, 2);
    assert.ok(html.indexOf('Savage Attacker') < html.indexOf('Piercer'), 'notes must keep their order');
});

test('omits the header when no title is given', () => {
    const html = buildRerollTooltip('', ['↻ Healer — rerolled 1, kept 4']);
    assert.doesNotMatch(html, /attribution-header/);
    assert.match(html, /attribution-source/);
});

test('returns an empty string when there is nothing to show', () => {
    assert.equal(buildRerollTooltip('Rerolls', []), '');
    assert.equal(buildRerollTooltip('Rerolls', undefined), '');
    assert.equal(buildRerollTooltip('Rerolls', null), '');
    assert.equal(buildRerollTooltip('Rerolls', ['', null, undefined]), '');
});

test('drops non-string entries but keeps the usable ones', () => {
    const html = buildRerollTooltip('Rerolls', [null, '↻ Healer — rerolled 1, kept 4', 42]);
    assert.equal(html.match(/<li class="attribution-item">/g).length, 1);
    assert.match(html, /Healer/);
});

// Item names are user-editable, and this string is handed to Foundry as data-tooltip-html,
// i.e. it IS parsed as HTML - so an item named with a tag must not become live markup.
test('escapes HTML in a note so a crafted item name cannot inject markup', () => {
    const html = buildRerollTooltip('Rerolls', ['↻ <img src=x onerror="boom"> — rerolled 7, kept 9']);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
});

test('escapes an ampersand without double-escaping', () => {
    const html = buildRerollTooltip('Rerolls', ['↻ Sword & Shield — rerolled 7, kept 9']);
    assert.match(html, /Sword &amp; Shield/);
    assert.doesNotMatch(html, /&amp;amp;/);
});

test('escapes the title too', () => {
    const html = buildRerollTooltip('<b>Rerolls</b>', ['↻ Healer — rerolled 1, kept 4']);
    assert.doesNotMatch(html, /<b>/);
    assert.match(html, /&lt;b&gt;Rerolls&lt;\/b&gt;/);
});
