import {actorUtils, constants, dialogUtils, effectUtils, genericUtils, socketUtils, tokenUtils, workflowUtils} from '../../../../../utils.js';
import {determineSuperiorityDie} from '../../../../2014/classFeatures/fighter/battleMaster/superiorityDice.js';
import {maneuversGoadingAttack as goadingAttackLegacy} from '../../../../2014/classFeatures/fighter/battleMaster/maneuvers.js';
import {superiorityDice as superiorityDiceLegacy} from '../../../../2014/classFeatures/fighter/battleMaster/superiorityDice.js';

// CPR's 23 maneuvers are registered ONLY in the legacy registry, and premade lookup picks the pack
// by the item's ruleset (`integrations/ddbi.js` maps 2014 -> legacy, 2024 -> modern), so a 2024-rules
// Battle Master could never match any of them. These are the first three ported forward, chosen
// because they are the ones actually on the table.

// 2024 PHB, Riposte: "When a creature misses you with a melee attack roll, you can take a Reaction
// and expend one Superiority Die to make a melee attack roll with a weapon or an Unarmed Strike
// against the creature. If you hit, add the Superiority Die to the attack's damage."
//
// ⚠️ Upstream binds `maneuversRiposte` to `useBrace` (2014 maneuvers.js:597) — Brace's handler. The
// two are mechanically near-identical, so it works by accident rather than being broken, but it is a
// maintenance trap: tuning Brace silently retunes Riposte. The modern entry gets its own handler,
// which also adds the Unarmed Strike option 2024 introduced. Legacy stays weapon-only on purpose —
// 2014 Riposte reads "melee weapon attack".
async function useRiposte({workflow}) {
    if (workflow.targets.size !== 1) return;
    let attacks = workflow.token.actor.items.filter(i => {
        if (constants.unarmedAttacks.includes(genericUtils.getIdentifier(i))) return true;
        return i.type === 'weapon' && i.system.equipped && i.system.activities.getByType('attack').some(j => j.actionType === 'mwak');
    });
    if (!attacks.length) return;
    let [itemToUse, superiorityDie] = await determineSuperiorityDie(workflow.actor);
    if (!itemToUse?.system.uses.value) return;
    let selected;
    if (attacks.length === 1) {
        selected = attacks[0];
    } else {
        selected = await dialogUtils.selectDocumentDialog(workflow.item.name, 'CHRISPREMADES.Macros.Antagonize.SelectWeapon', attacks);
    }
    if (!selected) return;
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        changes: [
            {
                key: 'system.bonuses.mwak.damage',
                mode: 2,
                value: superiorityDie,
                priority: 20
            }
        ]
    };
    let effect = await effectUtils.createEffect(workflow.actor, effectData);
    await workflowUtils.syntheticItemRoll(selected, [workflow.targets.first()]);
    if (effect) await genericUtils.remove(effect);
    await genericUtils.update(itemToUse, {'system.uses.spent': itemToUse.system.uses.spent + 1});
}

// Ally selection, on canvas where possible. Argon's own picker is what the player already uses to
// choose an attack target, so picking the ally the same way is one less modality — but it only
// exists while the HUD is running, and a sheet click has no picker at all (that gap is T79). The
// dialog list stays as the fallback so the sheet path is never dead.
async function pickAlly(workflow, candidates) {
    let picker = game.modules.get('enhancedcombathud')?.active ? game.modules.get('enhancedcombathud').api?.runTargetPicker : null;
    if (picker) {
        // ⚠️ runTargetPicker resolves to a BOOLEAN (true = completed, false = cancelled), NOT to the
        // tokens picked — the selection is left in `game.user.targets`. Assuming it returned tokens
        // made this whole branch a silent no-op: `Array.from(true)` is `[]`, so no ally was ever
        // chosen, no confirmation was ever raised, and no exemption was ever applied. It failed
        // without an error, which is why it looked like it worked.
        let completed = await picker({
            token: workflow.token,
            targets: 1,
            label: genericUtils.translate('CHRISPREMADES.Macros.Maneuvers.SelectAlly'),
            item: workflow.item
        });
        if (!completed) return undefined;
        let chosen = Array.from(game.user.targets)[0];
        if (!chosen) return undefined;
        // The picker targets any token — deliberately, since RAW leaves the choice to the player and
        // Vittorio asked to trust them. Warn on a pick outside the see-or-hear ally set rather than
        // refusing it, so an unusual-but-legal choice still goes through.
        if (!candidates.some(c => c.id === chosen.id)) {
            genericUtils.notify('CHRISPREMADES.Macros.Maneuvers.NotAnAlly', 'warn');
        }
        return chosen;
    }
    let picked = await dialogUtils.selectTargetDialog(workflow.item.name, 'CHRISPREMADES.Macros.Maneuvers.SelectAlly', candidates);
    return picked?.[0];
}

// 2024 PHB, Maneuvering Attack: "...choose a willing creature who can see or hear you. That creature
// can use its Reaction to move up to half its Speed without provoking Opportunity Attacks from the
// target of your attack."
//
// Two changes from the legacy handler:
//   1. "see OR hear" — legacy checked sight only (`tokenUtils.canSee`). `canSense(..., ['all'])`
//      matches on any detection mode the world defines, which with vision-5e installed includes its
//      `hearing` mode; with vision-5e absent it still covers sight, i.e. never worse than legacy.
//   2. The OA exemption is now real. The chosen ally gets `flags.midi-qol.oaManeuveringAttack`
//      carrying the attacked creature's token id, which our GPS fork's opportunityAttack.js skips on
//      — the same per-pair mechanism upstream GPS already uses for the Mobile feat and Fancy
//      Footwork. Written as an ActiveEffect CHANGE, not a stored flag, so removing the effect removes
//      the exemption; nothing has to remember to clean up.
//
// ⚠️ "The target of your attack" is read from the workflow BEFORE the ally retarget below, i.e. it is
// whoever Xender still has targeted when he uses the maneuver — true in the normal flow (attack, then
// use the maneuver), but it is an inference, not something the item records. With no target held, the
// ally is still designated and still spends its Reaction; only the OA exemption is skipped.
async function useManeuveringAttack({workflow}) {
    let attackedToken = workflow.targets.first();
    let candidates = workflow.token.scene.tokens.filter(t => {
        if (!t.actor) return false;
        if (t.id === workflow.token.id) return false;
        if (t.disposition !== workflow.token.document.disposition) return false;
        return tokenUtils.canSense(t.object, workflow.token, ['all']);
    }).map(t => t.object);
    if (!candidates.length) {
        await workflowUtils.updateTargets(workflow, []);
        return;
    }
    let ally = await pickAlly(workflow, candidates);
    if (!ally) {
        await workflowUtils.updateTargets(workflow, []);
        return;
    }
    dialogUtils.confirm(workflow.item.name, 'CHRISPREMADES.Macros.Maneuvers.Maneuvering', {userId: socketUtils.firstOwner(ally.actor, true)}).then(async choice => {
        if (!choice) return;
        actorUtils.setReactionUsed(ally.actor);
        if (!attackedToken || attackedToken.id === ally.id) return;
        await effectUtils.createEffect(ally.actor, {
            name: workflow.item.name,
            img: workflow.item.img,
            origin: workflow.item.uuid,
            duration: {
                rounds: 1
            },
            changes: [
                {
                    key: 'flags.midi-qol.oaManeuveringAttack',
                    mode: 2,
                    value: attackedToken.id,
                    priority: 20
                }
            ],
            flags: {
                dae: {
                    specialDuration: [
                        'turnEndSource'
                    ]
                }
            }
        });
    });
    await workflowUtils.updateTargets(workflow, [ally]);
}

export let maneuversRiposte = {
    name: 'Maneuvers: Riposte',
    // No bare-name alias on purpose: the Monster Manual ships an NPC feat also called "Riposte"
    // (dnd5e.monsterfeatures24 / dnd-monster-manual.features `mmRiposte0000000`), and a bare alias
    // would put this Battle Master automation in front of it. `Maneuver: X` is what our DDB fork's
    // enricher produces, which is what a real 2024 sheet actually carries.
    aliases: ['Maneuver: Riposte'],
    version: '1.0.0',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: useRiposte,
                priority: 50
            }
        ]
    }
};
export let maneuversGoadingAttack = {
    name: 'Maneuvers: Goading Attack',
    aliases: ['Maneuver: Goading Attack'],
    version: '1.0.0',
    rules: 'modern',
    // Edition-stable: the 2014 and 2024 wordings are identical (Wisdom save, Disadvantage on attacks
    // against anyone but you, until the end of your next turn), so the legacy handler ports verbatim.
    // Worth knowing: this is the only source that implements the Disadvantage at all — the official
    // PHB 2024 item and our DDB enricher both ship a `Goaded` effect with ZERO changes, i.e. a marker.
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: goadingAttackLegacy.midi.item[0].macro,
                priority: 50
            }
        ]
    }
};
export let maneuversManeuveringAttack = {
    name: 'Maneuvers: Maneuvering Attack',
    aliases: ['Maneuver: Maneuvering Attack'],
    version: '1.0.0',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'preambleComplete',
                macro: useManeuveringAttack,
                priority: 50
            }
        ]
    }
};

// ⚠️ THE DRIVER. Without this the three maneuvers above are inert on a 2024 sheet — nothing invokes
// them. CPR does not activate maneuvers from the hotbar or the HUD: `superiorityDice` is an
// ACTOR-level midi macro on `damageRollComplete`, so after any weapon attack's damage it asks
// "perform a maneuver?", adds the superiority die to THAT attack's damage roll
// (`workflowUtils.bonusDamage` — which is what 2024 RAW's "Add the Superiority Die to the attack's
// damage roll" actually describes), runs the chosen maneuver item, and spends the die. Registered
// legacy-only upstream, exactly like the maneuvers themselves.
//
// Reused verbatim: the helper is edition-agnostic (it reads
// `actor.system.scale['battle-master']['combat-superiority-die']` and the actor's own maneuver
// items). ⚠️ That scale key is the DDB parse's; a sheet built from the official PHB 2024 compendium
// uses `battle-master.superiority.die` instead and would silently fall back to d6. Not a problem for
// Xender (DDB-imported), but it is the thing to check first if a maneuver ever rolls a stray d6.
export let superiorityDice = {
    name: 'Superiority Dice',
    aliases: ['Combat Superiority'],
    version: '1.0.0',
    rules: 'modern',
    midi: superiorityDiceLegacy.midi
};
