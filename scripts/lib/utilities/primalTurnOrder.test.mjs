import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { liftPrimalSort } from './primalTurnOrder.mjs';

/*
 * T153 — the Primal Companion beast's initiative−0.01 loses ties.
 *
 * Warpey 20, Xender ALSO 20 → the beast at 19.99 acted after Xender instead of right after its
 * hunter. No numeric offset can win this: with the hunters tied, equality leaves no room between
 * them. So the beast now MIRRORS the hunter's initiative and the turn-order COMPARATOR is lifted:
 * a beast inherits its hunter's whole sort identity and loses ties only to the hunter — a
 * lexicographic key, so it stays transitive and core's turn bookkeeping is untouched.
 */

// A stand-in comparator: initiative desc, then name asc — the dnd5e shape.
const base = (a, b) => (b.initiative - a.initiative) || a.name.localeCompare(b.name);
const mk = (name, initiative, hunter = null) => ({id: name, name, initiative, hunter});
const resolve = c => c.hunter ? {anchor: c.hunter, isBeast: true} : {anchor: c, isBeast: false};

function orderOf(list) {
    return [...list].sort(liftPrimalSort(base, resolve)).map(c => c.name);
}

test('T153: the beast lands immediately after its hunter despite a tied third combatant', () => {
    const warpey = mk('Warpey', 20);
    const xender = mk('Xender', 20);
    const beast = mk('Beast', 20, warpey);
    // Every input permutation must produce the same order, beast glued to Warpey.
    const lists = [
        [warpey, xender, beast], [warpey, beast, xender], [xender, warpey, beast],
        [xender, beast, warpey], [beast, warpey, xender], [beast, xender, warpey]
    ];
    for (const list of lists) {
        const order = orderOf(list);
        assert.equal(order.indexOf('Beast'), order.indexOf('Warpey') + 1, order.join(','));
    }
});

test('T153: a beast whose hunter is absent sorts as itself', () => {
    const goblin = mk('Goblin', 15);
    const beast = mk('Beast', 10, null);
    assert.deepEqual(orderOf([beast, goblin]), ['Goblin', 'Beast']);
});

test('T153: two beasts of one hunter stay behind the hunter, ordered by the base comparator', () => {
    const warpey = mk('Warpey', 20);
    const a = mk('Abeast', 20, warpey);
    const z = mk('Zbeast', 20, warpey);
    assert.deepEqual(orderOf([z, warpey, a]), ['Warpey', 'Abeast', 'Zbeast']);
});

test('T153: anchors that tie under the base comparator still separate deterministically', () => {
    // Identical name + initiative (base compare = 0): the id fallback must keep each hunter's
    // block contiguous instead of letting Array.sort stability interleave them.
    const h1 = {id: 'aaa', name: 'Twin', initiative: 20};
    const h2 = {id: 'zzz', name: 'Twin', initiative: 20};
    const b1 = {id: 'b1', name: 'Beast1', initiative: 20, hunter: h1};
    const sorted = [h2, b1, h1].sort(liftPrimalSort(base, resolve));
    const idxHunter = sorted.findIndex(c => c.id === 'aaa');
    const idxBeast = sorted.findIndex(c => c.id === 'b1');
    assert.equal(idxBeast, idxHunter + 1);
});

test('T153: the fork wires the lifted comparator and mirrors the hunter initiative', () => {
    const source = readFileSync(fileURLToPath(new URL('../../macros/2024/classFeatures/ranger/beastMaster/primalCompanion.js', import.meta.url)), 'utf8');
    assert.match(source, /libWrapper\.register\('chris-premades', 'CONFIG\.Combat\.documentClass\.prototype\._sortCombatants'/,
        'the comparator lift is what places the beast; nothing else wraps this target');
    // ⚠️ MIXED, not WRAPPER: the lifted comparator legitimately short-circuits (beast vs its own
    // hunter never consults the base comparator), and libWrapper UNREGISTERS a WRAPPER the first
    // time it fails to chain — silently reverting the whole feature at the first tie it handles
    // (watched live). CPR's own canUsePatch uses MIXED for the same reason.
    assert.match(source, /'MIXED'/);
    assert.ok(!source.includes("'WRAPPER'"), 'WRAPPER gets unregistered on the first short-circuit');
    assert.match(source, /Hooks\.once\('setup'/, 'register after dnd5e has installed its Combat document class');
    assert.ok(!/- 0\.01/.test(source), 'the numeric offset can never win a tie — the beast mirrors the hunter');
});
