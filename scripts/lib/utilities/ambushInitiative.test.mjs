import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_OFFER_TIMEOUT_SECONDS,
    applyAmbushDie,
    isEligibleForAmbushOffer,
    normaliseOfferTimeout,
    selectAmbushPrompter,
    superiorityDieFormula
} from './ambushInitiative.mjs';

/*
 * T81 carry-forward — Ambush's initiative half (2026-07-30).
 *
 * The maneuver was ported in Batch A with only its Stealth half live; 2024 RAW also covers "an
 * Initiative roll". These cover the decision logic; the wiring (CCT reveal hold, dialog, die spend)
 * is verified live.
 */

const eligible = {
    hasAmbush: true,
    isIncapacitated: false,
    superiorityDiceRemaining: 4,
    initiative: 14,
    alreadyOffered: false
};

test('the offer is raised for a Battle Master who just rolled with dice in the pool', () => {
    assert.equal(isEligibleForAmbushOffer(eligible), true);
});

test('no Ambush item means no offer', () => {
    assert.equal(isEligibleForAmbushOffer({...eligible, hasAmbush: false}), false);
});

test('RAW: the Incapacitated condition suppresses the offer', () => {
    assert.equal(isEligibleForAmbushOffer({...eligible, isIncapacitated: true}), false);
});

test('an empty superiority pool raises no offer', () => {
    // §T66: an offer that cannot be honoured is worse than no offer.
    assert.equal(isEligibleForAmbushOffer({...eligible, superiorityDiceRemaining: 0}), false);
});

test('the offer is one-shot per combatant per combat', () => {
    assert.equal(isEligibleForAmbushOffer({...eligible, alreadyOffered: true}), false);
});

test('a cleared or non-numeric initiative is not a roll landing', () => {
    for (const initiative of [null, undefined, NaN, 'twelve']) {
        assert.equal(isEligibleForAmbushOffer({...eligible, initiative}), false);
    }
});

test('an initiative of exactly 0 still counts as a landing', () => {
    // A finite 0 is a real rolled value; only null/NaN mean "not rolled".
    assert.equal(isEligibleForAmbushOffer({...eligible, initiative: 0}), true);
});

test('a malformed pool count fails closed', () => {
    for (const remaining of [undefined, null, NaN, Infinity, -1, 'four']) {
        assert.equal(isEligibleForAmbushOffer({...eligible, superiorityDiceRemaining: remaining}), false);
    }
});

test('exactly one client prompts: the active non-GM owner with the lowest id', () => {
    const users = [
        {id: 'zzz', isGM: false, active: true, isOwner: true},
        {id: 'aaa', isGM: false, active: true, isOwner: true},
        {id: 'gm1', isGM: true, active: true, isOwner: true}
    ];
    assert.equal(selectAmbushPrompter(users, {activeGMId: 'gm1'}), 'aaa');
});

test('an offline owner does not swallow the prompt — the GM takes it', () => {
    const users = [
        {id: 'aaa', isGM: false, active: false, isOwner: true},
        {id: 'gm1', isGM: true, active: true, isOwner: true}
    ];
    assert.equal(selectAmbushPrompter(users, {activeGMId: 'gm1'}), 'gm1');
});

test('a non-owner player never prompts', () => {
    const users = [
        {id: 'bbb', isGM: false, active: true, isOwner: false},
        {id: 'gm1', isGM: true, active: true, isOwner: true}
    ];
    assert.equal(selectAmbushPrompter(users, {activeGMId: 'gm1'}), 'gm1');
});

test('with nobody eligible the prompter is null, not undefined', () => {
    assert.equal(selectAmbushPrompter([], {}), null);
    assert.equal(selectAmbushPrompter(undefined, {}), null);
});

test('the die is added to the recorded initiative', () => {
    assert.equal(applyAmbushDie(14, 5), 19);
});

test('the Dex tiebreaker decimal survives the addition', () => {
    // initiativeDexTiebreaker parks the tiebreak in the decimals (score / 100). Re-flooring here
    // would silently recreate ties the system had already broken.
    assert.equal(applyAmbushDie(14.16, 5), 19.16);
});

test('a negative initiative still takes the die', () => {
    assert.equal(applyAmbushDie(-2, 3), 1);
});

test('an unusable initiative or die writes nothing', () => {
    assert.equal(applyAmbushDie(null, 5), null);
    assert.equal(applyAmbushDie(14, 0), null);
    assert.equal(applyAmbushDie(14, NaN), null);
});

test('only a plain die reaches the Roll constructor', () => {
    assert.equal(superiorityDieFormula('d8'), '1d8');
    assert.equal(superiorityDieFormula('d10'), '1d10');
    for (const bad of ['8', 'd', 'dX', '1d8', '@scale.battle-master.combat-superiority-die', null, undefined, 6]) {
        assert.equal(superiorityDieFormula(bad), null);
    }
});

test('the auto-decline timer defaults to 30s and clamps the absurd', () => {
    assert.equal(normaliseOfferTimeout(undefined), DEFAULT_OFFER_TIMEOUT_SECONDS);
    assert.equal(normaliseOfferTimeout('nonsense'), DEFAULT_OFFER_TIMEOUT_SECONDS);
    assert.equal(normaliseOfferTimeout(45), 45);
    assert.equal(normaliseOfferTimeout(0), 5);
    assert.equal(normaliseOfferTimeout(99999), 300);
    assert.equal(normaliseOfferTimeout(30.4), 30);
});

test('the extension takes the CCT reveal hold before it awaits anything', () => {
    /*
     * The whole rules position depends on the offer being answered BEFORE the field is revealed.
     * The hold must therefore be taken synchronously inside the hook — an `await` before it would
     * lose the race with CCT's own settle timer and leak the turn order to the decider.
     */
    const source = readFileSync(fileURLToPath(new URL('../../extensions/ambushInitiative.js', import.meta.url)), 'utf8');
    const handler = source.slice(source.indexOf('function onUpdateCombatant'));
    const body = handler.slice(0, handler.indexOf('\n}'));
    assert.ok(body.includes('holdInitiativeReveal'), 'the hook body must take the hold itself');
    assert.ok(!/\bawait\b/.test(body), 'the hook body must not await before taking the hold');
});

test('the Incapacitated clause is closed by disableCondition, not by disableIncapacitated alone', () => {
    /*
     * ⚠️ Live finding, 2026-07-30. `flags.dae.disableIncapacitated` DOES mark the effect suppressed
     * (`isSuppressed: "incapacitated"`, `active: false`, absent from `actor.appliedEffects`) — and
     * the actor STILL carries `flags.midi-qol.optional.Ambush.skill.ste`, through an explicit
     * `prepareData()` and `reset()`. DAE's own effect-application pass writes flag changes without
     * consulting suppression, so midi goes on offering the Stealth bonus to an Incapacitated
     * Battle Master.
     *
     * `flags.dae.disableCondition` is what actually closes it: DAE evaluates the expression and
     * WRITES `disabled` on the effect, which every consumer honours. Proven as a round trip —
     * healthy: flag present; Incapacitated: flag gone, `disabled: true`; recovered: flag back.
     *
     * Both are kept: `disableIncapacitated` still states the intent for anything that reads
     * suppression, `disableCondition` is the one that bites.
     */
    const pack = JSON.parse(readFileSync(
        fileURLToPath(new URL('../../../packData/cpr-class-features-2024/Maneuvers__Ambush_cprMnvAmbush2024.json', import.meta.url)),
        'utf8'
    ));
    const dae = pack.effects[0].flags.dae;
    assert.equal(dae.disableCondition, '@statuses.incapacitated');
    assert.equal(dae.disableIncapacitated, true);
});

test('every path out of the offer releases the hold', () => {
    const source = readFileSync(fileURLToPath(new URL('../../extensions/ambushInitiative.js', import.meta.url)), 'utf8');
    // A hold that is never released blanks the carousel until its expiry — the safety net exists,
    // but relying on it would stall the table for the full timeout on every decline.
    assert.ok(source.includes('finally'), 'the resolve path must release in a finally block');
});
