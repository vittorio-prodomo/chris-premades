import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T151 — Faerie Fire leaves its template behind, invisible.
 *
 * The 20-ft cube has no post-cast function: FF (2014 and 2024 alike) lights the creatures caught
 * at cast; the zone does not persist. But the spell's duration is 1 minute, so the template evades
 * midi's "Auto remove instantaneous templates" bucket, and the concentration-expiry bucket only
 * fires when concentration ends — so the template sits there for the whole minute, invisible,
 * and animation autorecs latch onto it (a later Flaming Sphere cast previewed inside the stale
 * Faerie Fire cube). The macro deletes it itself once the cast has resolved.
 */
const macroPath = fileURLToPath(new URL('../../macros/2014/spells/faerieFire.js', import.meta.url));

test('T151: the Faerie Fire macro deletes its own template once the cast resolves', () => {
    const source = readFileSync(macroPath, 'utf8');
    assert.match(source, /genericUtils\.remove\(templateDoc\)/,
        'the template has no post-cast function and neither midi Specials bucket ever removes it');
});

test('T151: the template dies AFTER the target effects exist, and on the whiffed path too', () => {
    /*
     * ⚠️ Caught live: the template is a concentration DEPENDENT, and midi deletes a concentration
     * whose LAST dependent vanishes (the Witch Bolt defect-2 mechanism). Deleting the template
     * before the failedSaves loop therefore killed concentration and the target effects were
     * created unlinked. The deletion must come AFTER the loop — by then the target effects are
     * dependents of their own — and the old empty-failedSaves early return must be gone so a
     * whiffed cast still cleans the cube up (concentration going with it is midi's own
     * nothing-applied behavior, and RAW-harmless: there is nothing left to sustain).
     */
    const source = readFileSync(macroPath, 'utf8');
    const deleteAt = source.indexOf('genericUtils.remove(templateDoc)');
    const loopAt = source.indexOf('for (let target of workflow.failedSaves)');
    assert.ok(deleteAt > -1 && loopAt > -1);
    assert.ok(deleteAt > loopAt, 'deletion must follow the target-effect loop or concentration dies with the template');
    assert.ok(!source.includes('if (!workflow.failedSaves.size) return;'),
        'the early return would strand the cube on a whiffed cast');
});
