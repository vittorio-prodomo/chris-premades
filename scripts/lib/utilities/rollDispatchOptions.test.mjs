import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * T88 guard — a contested roll must fast-forward both halves.
 *
 * `MidiQOL.contestedRoll` dispatches each side through midi's `rollAbility`, which computes
 * `fastForward = displayOptions?.fastForward ?? false` and then `dialog = {configure: !fastForward}`.
 * So omitting fastForward does not mean "use the world's automation settings" — it GUARANTEES
 * dnd5e's roll-configuration dialog, mid-automation, with an Ability dropdown that invites
 * contradicting the choice the macro just made (pick Acrobatics to escape a grapple, get offered
 * Strength). That was T88.
 *
 * ⚠️ This only works against a midi carrying fork patch #12. Before it, `contestedRoll`
 * destructured `rollOptions` and never read them, so BOTH fastForward and advantage/disadvantage
 * were silently dropped. If this assertion holds but dialogs still appear, suspect the midi side:
 * the fork is a source build and needs a rebuild + `systemctl --user restart foundryvtt-v13`,
 * not a plain F5.
 *
 * Kept as a source-level guard because the call sits behind Foundry globals (MidiQOL,
 * CONFIG.DND5E) with no harness on either side, and because the line is a one-word deletion
 * away from silently reverting during an upstream merge.
 */

const rollUtilsPath = fileURLToPath(new URL('./rollUtils.js', import.meta.url));

function functionSource(name) {
    const source = readFileSync(rollUtilsPath, 'utf8');
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `${name} is gone from rollUtils — this guard needs re-pointing`);
    const next = source.indexOf('\nasync function ', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
}

const contestedRollSource = () => functionSource('contestedRoll');
const requestRollSource = () => functionSource('requestRoll');

/**
 * Slice out just the `saveDetails: { ... }` object by matching braces, so the assertions below
 * cannot accidentally read the SIBLING `displayOptions` block that follows it — which is exactly
 * the distinction these tests exist to police.
 */
function saveDetailsBlock(source) {
    const start = source.indexOf('saveDetails: {');
    assert.notEqual(start, -1, 'requestRoll no longer builds a saveDetails object');
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('unbalanced braces in saveDetails');
}

test('contestedRoll fast-forwards both sides', () => {
    const source = contestedRollSource();
    const sides = [...source.matchAll(/rollOptions:\s*\{([^}]*)\}/g)].map(m => m[1]);
    assert.equal(sides.length, 2, 'expected exactly two rollOptions (source and target)');
    for (const side of sides) {
        assert.match(
            side,
            /fastForward:\s*true/,
            'each side must default fastForward:true, or midi raises dnd5e\'s roll-config dialog (T88)'
        );
    }
});

test('a caller can still override the fast-forward default', () => {
    const source = contestedRollSource();
    /*
     * The spread must come AFTER the default, so a caller passing fastForward:false wins.
     * Reversed, the default would clobber the caller and the option would be undeclarable.
     */
    for (const side of ['sourceRollOptions', 'targetRollOptions']) {
        assert.match(
            source,
            new RegExp(`fastForward:\\s*true,\\s*\\.\\.\\.${side}`),
            `${side} must be spread after the fastForward default so a caller can override it`
        );
    }
});

/*
 * T88 — the two defects that actually produced the bug report, both in `requestRoll`.
 * This is the path a FLAT-DC grapple escape takes (2024 Unarmed Strike sets
 * `flatDC: activity.save.dc.value`), which is why the contested-roll guards above never
 * covered it — and why the first attempt at T88 fixed the wrong branch.
 */

test('requestRoll does not pre-seed rollAbilities', () => {
    const source = requestRollSource();
    /*
     * The switch is the only place that may assign a roll target. Pre-seeding
     * `rollAbilities: [ability]` in the literal leaves a SKILL id in the abilities slot for a
     * skill request; midi copies it to `config.ability`, dnd5e finds no such ability, and the
     * dialog's <select> falls back to its first option -- Strength. That is the whole
     * "picked Acrobatics, rolled Strength" report.
     */
    assert.doesNotMatch(
        saveDetailsBlock(source),
        /rollAbilities/,
        'rollAbilities must be set only by the switch, never pre-seeded in the literal (T88)'
    );
});

test('requestRoll puts displayOptions where midi reads it', () => {
    const source = requestRollSource();
    /*
     * midi's rollAbility reads `data.displayOptions`, NOT `data.saveDetails.displayOptions`.
     * Nested, it is silently undefined and `fastForward` defaults to false, which guarantees
     * dnd5e's roll-configuration dialog mid-automation.
     */
    assert.doesNotMatch(
        saveDetailsBlock(source),
        /displayOptions/,
        'displayOptions must not be nested inside saveDetails — midi reads it at the top level (T88)'
    );
    assert.match(
        source,
        /displayOptions:\s*\{\s*fastForward:\s*true,\s*\.\.\.options\s*\}/,
        'requestRoll must send a top-level displayOptions defaulting fastForward:true, with options spread after so a caller can override'
    );
});
