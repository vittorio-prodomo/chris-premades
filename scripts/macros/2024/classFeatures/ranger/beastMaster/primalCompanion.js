import {Summons} from '../../../../../lib/summons.js';
import {activityUtils, actorUtils, combatUtils, compendiumUtils, constants, dialogUtils, effectUtils, errors, genericUtils, itemUtils, socketUtils, tokenUtils, workflowUtils} from '../../../../../utils.js';

// Locate the tokens tracked by the caster's Primal Companion summon effect (living or a lingering
// corpse). The effect keeps its summoned token ids/scenes in flags.chris-premades.summons.
function getBeastTokens(actor) {
    let effect = effectUtils.getEffectByIdentifier(actor, 'primalCompanion');
    if (!effect) return [];
    let ids = effect.flags['chris-premades']?.summons?.ids ?? {};
    let scenes = effect.flags['chris-premades']?.summons?.scenes ?? {};
    let tokens = [];
    for (let [name, tokenIds] of Object.entries(ids)) {
        let sceneIds = scenes[name] ?? [];
        tokenIds.forEach((tid, idx) => {
            let scene = game.scenes.get(sceneIds[idx]) ?? canvas.scene;
            let tok = scene?.tokens.get(tid);
            if (tok) tokens.push(tok);
        });
    }
    return tokens;
}
function findDeadBeast(actor) {
    return getBeastTokens(actor).find(t => t.actor && t.actor.system.attributes.hp.value <= 0);
}
async function dismissBeast(actor) {
    let effect = effectUtils.getEffectByIdentifier(actor, 'primalCompanion');
    if (!effect) return;
    // Remove the summoned tokens/combatants, then the caster summon effect. Deleting the effect
    // also re-hides Command/Dismiss/Restore (CPR's rehideActivities on deleteActiveEffect).
    await Summons.dismiss({trigger: {entity: effect}});
    await genericUtils.remove(effect);
}
// Re-summoning while a beast (living OR a lingering corpse) already exists must not stack a second
// beast — the summons lib appends token ids to the existing effect. RAW: the old beast vanishes when
// the new one appears. Gate on dnd5e.preUseActivity (fires before the card / action-economy / any
// consumption — see potionOfHealing.js): confirm, then dismiss-and-replace, else abort clean.
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    if (!['primalCompanionLand', 'primalCompanionSea', 'primalCompanionSky'].includes(activityUtils.getIdentifier(activity))) return;
    if (usageConfig?.chrisPremades?.primalReplaceConfirmed) return;
    let actor = activity.item?.actor;
    if (!actor) return;
    if (!effectUtils.getEffectByIdentifier(actor, 'primalCompanion')) return; // no beast yet: proceed
    (async () => {
        let confirmed = await dialogUtils.confirm(activity.item.name, 'CHRISPREMADES.Macros.PrimalCompanion.ReplaceBeast');
        if (!confirmed) return; // cancel: clean abort, nothing spent
        await dismissBeast(actor);
        await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {primalReplaceConfirmed: true}}, {inplace: false}), {configure: false}, {});
    })();
    return false;
});
// The ranger's lowest-level spell slot that still has a use left (Restore spends one slot of any level
// with no scaling benefit, so we always burn the cheapest).
function findLowestAvailableSpellSlot(actor) {
    let spells = actor.system.spells ?? {};
    for (let i = 1; i <= 9; i++) {
        let slot = spells['spell' + i];
        if (slot && slot.max > 0 && slot.value > 0) return 'spell' + i;
    }
    return null;
}
// Restore is a Magic action that expends a spell slot to return a beast that has died within the last
// hour (GM adjudicates the hour). Gate on preUseActivity so the whole thing aborts BEFORE any cost when
// there is no fallen beast in reach; and since scaling the slot does nothing here, skip the scaling/slot
// dialog entirely — spend the LOWEST available slot automatically, then re-invoke with consumption +
// dialog suppressed. The heal itself runs in the rollFinished macro below.
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    if (activityUtils.getIdentifier(activity) !== 'primalCompanionRestore') return;
    if (usageConfig?.chrisPremades?.restoreConfirmed) return; // re-invoke: proceed, no dialog / no double-consume
    let actor = activity.item?.actor;
    if (!actor) return;
    let deadBeast = findDeadBeast(actor);
    if (!deadBeast) {
        ui.notifications.warn(genericUtils.translate('CHRISPREMADES.Macros.PrimalCompanion.NoDeadBeast'));
        return false;
    }
    // RAW: Restore has a range of touch — the ranger must be within 5 ft of the fallen beast.
    let casterToken = actor.getActiveTokens()?.[0];
    let beastToken = deadBeast.object;
    if (casterToken && beastToken && tokenUtils.getDistance(casterToken, beastToken) > 5) {
        ui.notifications.warn(genericUtils.translate('CHRISPREMADES.Macros.PrimalCompanion.RestoreOutOfRange'));
        return false;
    }
    let slotKey = findLowestAvailableSpellSlot(actor);
    if (!slotKey) {
        ui.notifications.warn(genericUtils.translate('CHRISPREMADES.Macros.PrimalCompanion.NoSpellSlots'));
        return false;
    }
    (async () => {
        let current = foundry.utils.getProperty(actor, 'system.spells.' + slotKey + '.value') ?? 0;
        await genericUtils.update(actor, {['system.spells.' + slotKey + '.value']: Math.max(0, current - 1)});
        await activity.use(
            genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {restoreConfirmed: true}, consume: {spellSlot: false, resources: false}}, {inplace: false}),
            {configure: false},
            {}
        );
    })();
    return false;
});
// T44a — Primal Companion action economy. A commanded non-Dodge beast action costs the HUNTER's bonus
// action (warn-and-allow, never a hard block — mirrors the flaming-sphere / Shield GM-trust philosophy);
// Dodge is free (RAW default, auto-fired when uncommanded by T44b). Beast's Strike additionally offers the
// hunter a choice: spend a bonus action, or forgo one of their own attacks (the RAW level-3 option). At L3
// the beast's Dash/Disengage/Help come through the shared "Generic Actions" MENU (a synthetic roll of the
// picked pack action — detected by its stable system.identifier), not as separate items; the L7 Exceptional-
// Training separate-item layout is out of scope (those spend the beast's OWN bonus action). Gated on
// dnd5e.preUseActivity so a cancelled Strike aborts before any card/economy (the only clean cancel point —
// see potionOfHealing.js and the CLAUDE.md preUseActivity landmine).
let PRIMAL_STRIKE_IDS = ['primalCompanionLandBeastsStrike', 'primalCompanionSeaBeastsStrike', 'primalCompanionSkyBeastsStrike'];
let PRIMAL_COMMANDED_GENERICS = ['dash', 'disengage', 'help']; // system.identifier of the commanded generic actions (Dodge excluded)
function isPrimalCompanionBeast(beastActor) {
    if (!beastActor?.flags?.['chris-premades']?.summons?.control?.actor) return false; // not a CPR summon at all
    // Only a Primal Companion beast carries the Strike or the dedicated Dodge item — this excludes other summons
    // (Flaming Sphere, Mage Hand, …) that also get a Generic Actions item from the summons lib.
    return beastActor.items.some(i => {
        let id = genericUtils.getIdentifier(i);
        return id === 'primalCompanionDodge' || PRIMAL_STRIKE_IDS.includes(id);
    });
}
async function getHunterActor(beastActor) {
    let uuid = beastActor?.flags?.['chris-premades']?.summons?.control?.actor;
    return uuid ? await fromUuid(uuid) : null;
}
// Charge the hunter's bonus action for a commanded beast action. If the hunter already spent their bonus
// action this turn, post the shared T46 double-spend card (warn-and-allow) instead of silently double-spending.
async function chargeHunterBonusAction(hunter, actionName) {
    if (!hunter?.inCombat) return;
    if (MidiQOL.hasUsedBonusAction(hunter)) await MidiQOL.postDoubleSpendCard(hunter, 'bonus', actionName);
    else await MidiQOL.setBonusActionUsed(hunter);
}
// Record that the beast was commanded to take a non-Dodge action this round, on the beast's token document.
// T44b's hidden-turn handler reads flag primalCommandedRound (=== game.combat.round) to decide skip-only vs
// auto-Dodge, then clears it. Round is stored explicitly (not combatUtils.setTurnCheck's round-turn string)
// because the command lands on the HUNTER's turn but is read on the beast's later turn — a per-turn key would
// mismatch across that boundary.
async function markBeastCommanded(beastActor) {
    if (!game.combat) return;
    let tokenDoc = beastActor.token ?? beastActor.getActiveTokens()?.[0]?.document;
    if (tokenDoc) await tokenDoc.setFlag('chris-premades', 'primalCommandedRound', game.combat.round);
}
async function postCommandBookkeeping(hunter, contentKey) {
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({actor: hunter}),
        content: genericUtils.format(contentKey, {name: hunter.name})
    });
}
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig, dialogConfig, messageConfig) => {
    let beast = activity?.item?.actor;
    if (!isPrimalCompanionBeast(beast)) return;
    if (usageConfig?.chrisPremades?.beastCommandResolved) return; // re-invoke: proceed untouched
    let itemId = genericUtils.getIdentifier(activity.item);
    let sysId = activity.item?.system?.identifier;
    if (itemId === 'primalCompanionDodge' || sysId === 'dodge') return; // Dodge is always free
    let isStrike = PRIMAL_STRIKE_IDS.includes(itemId) && activity.type === 'attack'; // the attack activity, not the hidden charge rider
    let isCommandedGeneric = PRIMAL_COMMANDED_GENERICS.includes(sysId); // Dash/Disengage/Help via the Generic Actions menu
    if (!isStrike && !isCommandedGeneric) return; // Generic Actions item itself, Hide/Search/…, Primal Bond, etc.
    let actionName = activity.item.name;
    (async () => {
        let hunter = await getHunterActor(beast);
        if (!hunter) return;
        if (!hunter.inCombat) {
            // Out of combat there is no economy to spend — the Strike just proceeds (no dialog); the generic
            // path already returned undefined (proceeds on its own).
            if (isStrike) await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {beastCommandResolved: true}}, {inplace: false}), dialogConfig, messageConfig);
            return;
        }
        if (isStrike) {
            let choice = await dialogUtils.buttonDialog(actionName, 'CHRISPREMADES.Macros.PrimalCompanion.CommandStrikePrompt', [
                ['CHRISPREMADES.Macros.PrimalCompanion.CommandBonusAction', 'bonus'],
                ['CHRISPREMADES.Macros.PrimalCompanion.CommandForgoAttack', 'attack']
            ]);
            if (!choice) return; // cancel: nothing spent, no card, Strike aborted (the hook returned false)
            if (choice === 'bonus') {
                await chargeHunterBonusAction(hunter, actionName);
                await postCommandBookkeeping(hunter, 'CHRISPREMADES.Macros.PrimalCompanion.CommandedBonus');
            } else {
                await postCommandBookkeeping(hunter, 'CHRISPREMADES.Macros.PrimalCompanion.CommandedForgo');
            }
            await markBeastCommanded(beast);
            await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {beastCommandResolved: true}}, {inplace: false}), dialogConfig, messageConfig);
        } else {
            // Dash / Disengage / Help: cost the hunter's bonus action (warn-and-allow), no dialog. The action
            // itself proceeds untouched — the economy is on the hunter, independent of the beast's roll.
            await chargeHunterBonusAction(hunter, actionName);
            await markBeastCommanded(beast);
        }
    })();
    // Only the Strike path aborts-and-reinvokes (to gate the choice dialog before the card/economy). The
    // generic path proceeds normally — its bonus-action charge above is an independent side effect.
    if (isStrike) return false;
});
// T44b — Primal Companion hidden combatant + auto-Dodge. The beast KEEPS its 'follows' initiative slot (that
// is what keeps Foundry recording its movementHistory → the T34 charge rider fires for free), but its turn is
// auto-resolved so the table never stops on it, and the combat-tracker-dock fork hides its portrait. GM-side
// (single writer): when the turn lands on the beast, read the T44a per-round commanded flag — if it was NOT
// commanded a non-Dodge action this round it Dodges by default (RAW), firing its own Dodge item — then advance
// past it. Re-entrancy- and all-beast-loop-guarded; the while loop also chains consecutive beast turns.
let primalAutoTurnInFlight = false;
async function resolvePrimalBeastTurn(combat, combatant) {
    let tokenDoc = combatant.token;
    let commandedRound = tokenDoc?.getFlag('chris-premades', 'primalCommandedRound');
    // Consume the per-round flag (unset only if present, to avoid a spurious write on every skip).
    if (commandedRound !== undefined) await tokenDoc.unsetFlag('chris-premades', 'primalCommandedRound');
    if (commandedRound === combat.round) return; // commanded a non-Dodge action this round → it already acted
    // Uncommanded: the beast Dodges by default. Fire its own Dodge item (self-effect); never let a failure
    // block the skip.
    let dodgeItem = combatant.actor?.items.find(i => genericUtils.getIdentifier(i) === 'primalCompanionDodge');
    if (!dodgeItem) return;
    try {
        await workflowUtils.syntheticItemRoll(dodgeItem, []);
    } catch (error) {
        console.error('Primal Companion auto-Dodge failed', error);
    }
}
async function primalCompanionAutoTurn(combat, changes) {
    if (!socketUtils.isTheGM()) return; // single writer across GMs
    if (!changes.turn && !changes.round) return;
    if (!combat.started || !combat.isActive) return;
    if (primalAutoTurnInFlight) return; // re-entrant call from our own nextTurn()
    if (!isPrimalCompanionBeast(combat.combatant?.actor)) return;
    primalAutoTurnInFlight = true;
    try {
        // Chain consecutive beast turns; bounded by combat size so a corrupt state can never loop forever.
        let guard = 0;
        while (isPrimalCompanionBeast(combat.combatant?.actor) && guard++ < combat.turns.length) {
            // Only auto-advance while a non-beast, non-defeated combatant remains — a beast-only combat would
            // otherwise loop; park the turn instead.
            if (!combat.turns.some(c => !c.isDefeated && !isPrimalCompanionBeast(c.actor))) break;
            await resolvePrimalBeastTurn(combat, combat.combatant);
            await combat.nextTurn();
        }
    } finally {
        primalAutoTurnInFlight = false;
    }
}
Hooks.on('updateCombat', primalCompanionAutoTurn);
async function use({workflow}) {
    let activityIdentifier = activityUtils.getIdentifier(workflow.activity);
    let sourceActor = await compendiumUtils.getActorFromCompendium(constants.packs.summons, 'CPR - Primal Companion');
    if (!sourceActor) return;
    let classLevel = workflow.actor.classes?.ranger?.system?.levels;
    if (!classLevel) return;
    let primalBondFeatureData = await Summons.getSummonItem('Primal Bond', {}, workflow.item, {translate: 'CHRISPREMADES.Macros.PrimalCompanion.PrimalBond', identifier: 'primalCompanionPrimalBond'});
    let dashData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Dash', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Dash', identifier: 'primalCompanionDash'});
    let disengageData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Disengage', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Disengage', identifier: 'primalCompanionDisengage'});
    let dodgeData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Dodge', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Dodge', identifier: 'primalCompanionDodge'});
    let helpData = await compendiumUtils.getItemFromCompendium(constants.packs.actions, 'Help', {object: true, getDescription: true, translate: 'CHRISPREMADES.Macros.Actions.Help', identifier: 'primalCompanionHelp'});
    if (!primalBondFeatureData || !dashData || !disengageData || !dodgeData || !helpData) {
        errors.missingPackItem();
        return;
    }
    let itemsToAdd = [primalBondFeatureData];
    let commandFeature = activityUtils.getActivityByIdentifier(workflow.item, 'primalCompanionCommand', {strict: true});
    if (!commandFeature) return;
    let exceptionalTraining = itemUtils.getItemByIdentifier(workflow.actor, 'exceptionalTraining');
    if (exceptionalTraining) {
        let genericActions = [dashData, disengageData, dodgeData, helpData];
        genericActions.forEach(i => {
            let genericActivity = Object.entries(i.system.activities)[0][1];
            genericActivity.activation.type = 'bonus';
            itemsToAdd.push(i);
        });
    }
    else {
        itemsToAdd.push(dodgeData);
    }
    let creatureType = activityIdentifier.slice(15).toLowerCase();
    let hpValue = 5 + (classLevel * 5);
    let name = itemUtils.getConfig(workflow.item, creatureType + 'Name');
    // Only did this weird add so we don't get a false positive for a missing translation
    if (!name?.length) name = genericUtils.translate('CHRISPREMADES.Summons.CreatureNames.' + 'BeastOfThe' + creatureType.capitalize());
    let updates = {
        actor: {
            name,
            system: {
                details: {
                    cr: actorUtils.getCRFromProf(workflow.actor.system.attributes.prof)
                },
                attributes: {
                    hp: {
                        formula: hpValue,
                        max: hpValue,
                        value: hpValue
                    },
                    ac: {
                        flat: 13 + workflow.actor.system.abilities.wis.mod
                    }
                }
            },
            prototypeToken: {
                name,
                disposition: workflow.token.document.disposition
            },
            items: itemsToAdd
        },
        token: {
            name,
            disposition: workflow.token.document.disposition
        }
    };
    let avatarImg = itemUtils.getConfig(workflow.item, creatureType + 'Avatar');
    let tokenImg = itemUtils.getConfig(workflow.item, creatureType + 'Token');
    if (avatarImg) updates.actor.img = avatarImg;
    if (tokenImg) {
        genericUtils.setProperty(updates, 'actor.prototypeToken.texture.src', tokenImg);
        genericUtils.setProperty(updates, 'token.texture.src', tokenImg);
    }
    if (creatureType === 'land') {
        let beastsStrikeData = await Summons.getSummonItem('Beast\'s Strike (Land)', {}, workflow.item, {flatAttack: true, translate: 'CHRISPREMADES.Macros.PrimalCompanion.BeastsStrike', identifier: 'primalCompanionLandBeastsStrike', rules: 'modern'});
        if (!beastsStrikeData) {
            errors.missingPackItem();
            return;
        }
        let selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Dialog.DamageType', [
            ['DND5E.DamageBludgeoning', 'bludgeoning'],
            ['DND5E.DamagePiercing', 'piercing'],
            ['DND5E.DamageSlashing', 'slashing']
        ]);
        if (!selection) selection = 'slashing';
        let types = [selection];
        if (exceptionalTraining) {
            types.push('force');
        }
        let attackActivity = Object.entries(beastsStrikeData.system.activities).map(a => a[1]).find(a => a.type === 'attack');
        attackActivity.damage.parts[0].types = new Set(types);
        addCommandedStrikeMacro(beastsStrikeData);
        updates.actor.items.push(beastsStrikeData);
        genericUtils.setProperty(updates, 'actor.system.attributes.movement', {walk: 40, climb: 40});
    } else if (creatureType === 'sea') {
        let beastsStrikeData = await Summons.getSummonItem('Beast\'s Strike (Sea)', {}, workflow.item, {flatAttack: true, translate: 'CHRISPREMADES.Macros.PrimalCompanion.BeastsStrike', identifier: 'primalCompanionSeaBeastsStrike', rules: 'modern'});
        let amphibiousData = await Summons.getSummonItem('Amphibious', {}, workflow.item, {translate: 'CHRISPREMADES.CommonFeatures.Amphibious', identifier: 'primalCompanionAmphibious', rules: 'modern'});
        if (!beastsStrikeData || !amphibiousData) {
            errors.missingPackItem();
            return;
        }
        let selection = await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Dialog.DamageType', [
            ['DND5E.DamageBludgeoning', 'bludgeoning'],
            ['DND5E.DamagePiercing', 'piercing']
        ]);
        if (!selection) selection = 'bludgeoning';
        let types = [selection];
        if (exceptionalTraining) {
            types.push('force');
        }
        let attackActivity = Object.entries(beastsStrikeData.system.activities).map(a => a[1]).find(a => a.type === 'attack');
        attackActivity.damage.parts[0].types = new Set(types);
        beastsStrikeData.flags['chris-premades'].config.generic.autoGrapple.dc = workflow.actor.system.attributes.spell.dc;
        addCommandedStrikeMacro(beastsStrikeData);
        updates.actor.items.push(amphibiousData, beastsStrikeData);
        genericUtils.setProperty(updates, 'actor.system.attributes.movement', {walk: 5, swim: 60});
    } else {
        hpValue = 4 + 4 * classLevel;
        let beastsStrikeData = await Summons.getSummonItem('Beast\'s Strike (Sky)', {}, workflow.item, {flatAttack: true, translate: 'CHRISPREMADES.Macros.PrimalCompanion.BeastsStrike', identifier: 'primalCompanionSkyBeastsStrike', rules: 'modern'});
        let flybyData = await Summons.getSummonItem('Flyby', {}, workflow.item, {translate: 'CHRISPREMADES.CommonFeatures.Flyby', identifier: 'primalCompanionFlyby', rules: 'modern'});
        if (!flybyData || !beastsStrikeData) {
            errors.missingPackItem();
            return;
        }
        let types = ['slashing'];
        if (exceptionalTraining) {
            types.push('force');
        }
        let attackActivity = Object.entries(beastsStrikeData.system.activities).map(a => a[1]).find(a => a.type === 'attack');
        attackActivity.damage.parts[0].types = new Set(types);
        addCommandedStrikeMacro(beastsStrikeData);
        updates.actor.items.push(beastsStrikeData, flybyData);
        genericUtils.mergeObject(updates, {
            actor: {
                system: {
                    abilities: {
                        str: {
                            value: 6
                        },
                        dex: {
                            value: 16
                        },
                        con: {
                            value: 13
                        }
                    },
                    attributes: {
                        hp: {
                            formula: hpValue,
                            max: hpValue,
                            value: hpValue
                        },
                        movement: {
                            walk: 10,
                            fly: 60
                        }
                    },
                    traits: {
                        size: 'sm'
                    }
                },
                prototypeToken: {
                    texture: {
                        scaleX: 0.8,
                        scaleY: 0.8
                    }
                }
            },
            token: {
                texture: {
                    scaleX: 0.8,
                    scaleY: 0.8
                }
            }
        });
    }
    let animation = itemUtils.getConfig(workflow.item, creatureType + 'Animation') ?? 'none';
    let identifiersToVae = ['primalCompanionDodge', 'primalCompanionBeastsStrikeLand', 'primalCompanionBeastsStrikeSea', 'primalCompanionBeastsStrikeSky'];
    // Dismiss (special) exposed via the summons-lib dismissActivity option → lands in Argon's Special
    // panel + reroutes the caster effect's VAE button to it. Restore + Dismiss are unhidden alongside
    // Command (they live in hiddenActivities); re-hidden when the beast is dismissed. Guarded so an
    // item that predates these activities still summons (falls back to the default VAE dismiss).
    let dismissActivity = activityUtils.getActivityByIdentifier(workflow.item, 'primalCompanionDismiss');
    let secondaryUnhide = ['primalCompanionRestore', 'primalCompanionDismiss'].filter(id => activityUtils.getActivityByIdentifier(workflow.item, id));
    await Summons.spawn(sourceActor, updates, workflow.item, workflow.token, {
        range: 5, // RAW 2024: the beast appears within 5 ft of you (every summon, not just re-summons)
        enforceRange: true, // reject a placement beyond 5 ft instead of just flagging it (see summons.js)
        animation,
        initiativeType: 'follows',
        dontDismissOnDefeat: true,
        ...(dismissActivity ? {dismissActivity} : {}),
        additionalSummonVaeButtons:
            updates.actor.items
                .filter(i => identifiersToVae.includes(i.flags['chris-premades'].info.identifier))
                .map(i => ({type: 'use', name: i.name, identifier: i.flags['chris-premades'].info.identifier})),
        additionalVaeButtons: [{
            type: 'use',
            name: commandFeature.name,
            identifier: 'primalCompanion',
            activityIdentifier: 'primalCompanionCommand'
        }],
        unhideActivities: [
            {itemUuid: workflow.item.uuid, activityIdentifiers: ['primalCompanionCommand'], favorite: true},
            ...(secondaryUnhide.length ? [{itemUuid: workflow.item.uuid, activityIdentifiers: secondaryUnhide, favorite: false}] : [])
        ]
    });
}
async function dismiss({workflow}) {
    await dismissBeast(workflow.actor);
}
async function restore({workflow}) {
    // The spell slot was already spent by the preUseActivity gate (lowest available, no dialog); this
    // returns the fallen beast to life at full HP and clears its death/knockout states + defeated flag.
    let deadBeast = findDeadBeast(workflow.actor);
    if (!deadBeast) return; // gated at preUseActivity, but guard against a race
    let maxHp = deadBeast.actor.system.attributes.hp.max;
    await genericUtils.update(deadBeast.actor, {'system.attributes.hp.value': maxHp});
    // Restoring HP triggers dnd5e's own automation, which asynchronously clears Unconscious +
    // Incapacitated (but leaves Dead and Prone). Let that settle first, then clear the survivors
    // on a now-stable actor — clearing them mid-automation races dnd5e's rider re-sync and fails.
    await genericUtils.sleep(500);
    for (let statusId of ['dead', 'unconscious', 'incapacitated', 'prone']) {
        if (deadBeast.actor.statuses?.has(statusId)) await deadBeast.actor.toggleStatusEffect(statusId, {active: false});
    }
    let combatant = game.combat?.combatants.find(c => c.tokenId === deadBeast.id);
    if (combatant?.isDefeated) await genericUtils.update(combatant, {defeated: false});
}
function addCommandedStrikeMacro(strikeData) {
    let macroList = strikeData.flags['chris-premades'].macros?.midi?.item ?? [];
    if (!macroList.includes('primalCompanionStrike')) genericUtils.setProperty(strikeData, 'flags.chris-premades.macros.midi.item', macroList.concat('primalCompanionStrike'));
}
async function strikePreTargeting({config}) {
    // A commanded strike is not an opportunity attack: with recordAOO active, midi flags any attack
    // made outside the beast's own combat turn as an AoO, which skips the out-of-range workflow abort
    // (warns but still applies damage) and wrongly consumes the beast's reaction.
    genericUtils.setProperty(config, 'midiOptions.workflowOptions.notReaction', true);
}
async function damage({workflow}) {
    let ownerActor = await fromUuid(workflow.actor.flags['chris-premades'].summons.control.actor);
    let bestialFury = itemUtils.getItemByIdentifier(ownerActor, 'bestialFury');
    if (!bestialFury) return;
    if (workflow.hitTargets.size !== 1) return;
    if (!workflowUtils.isAttackType(workflow, 'attack')) return;
    let effect = effectUtils.getEffectByIdentifier(ownerActor, 'huntersMark');
    if (!effect) return;
    let {targets: validTargetUuids, formula, damageType} = effect.flags['chris-premades'].huntersMark;
    if (!validTargetUuids.includes(workflow.hitTargets.first().document.uuid)) return;
    let item = workflow.item;
    if (!combatUtils.perTurnCheck(item, 'bestialFury', false, workflow.token.id)) return;
    await workflowUtils.bonusDamage(workflow, formula, {damageType});
    await combatUtils.setTurnCheck(item, 'bestialFury');
}
export let primalCompanion = {
    name: 'Primal Companion',
    version: '1.3.79',
    rules: 'modern',
    hasAnimation: true,
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['primalCompanionLand', 'primalCompanionSea', 'primalCompanionSky']
            },
            {
                pass: 'rollFinished',
                macro: dismiss,
                priority: 50,
                activities: ['primalCompanionDismiss']
            },
            {
                pass: 'rollFinished',
                macro: restore,
                priority: 50,
                activities: ['primalCompanionRestore']
            }
        ]
    },
    config: [
        {
            value: 'landName',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'seaName',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'skyName',
            label: 'CHRISPREMADES.Summons.CustomName',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'text',
            default: '',
            category: 'summons'
        },
        {
            value: 'landToken',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'seaToken',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'skyToken',
            label: 'CHRISPREMADES.Summons.CustomToken',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'landAvatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'seaAvatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'skyAvatar',
            label: 'CHRISPREMADES.Summons.CustomAvatar',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'file',
            default: '',
            category: 'summons'
        },
        {
            value: 'landAnimation',
            label: 'CHRISPREMADES.Config.SpecificAnimation',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheLand',
            type: 'select',
            default: 'earth',
            category: 'animation',
            options: constants.summonAnimationOptions
        },
        {
            value: 'seaAnimation',
            label: 'CHRISPREMADES.Config.SpecificAnimation',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSea',
            type: 'select',
            default: 'water',
            category: 'animation',
            options: constants.summonAnimationOptions
        },
        {
            value: 'skyAnimation',
            label: 'CHRISPREMADES.Config.SpecificAnimation',
            i18nOption: 'CHRISPREMADES.Summons.CreatureNames.BeastOfTheSky',
            type: 'select',
            default: 'air',
            category: 'animation',
            options: constants.summonAnimationOptions
        }
    ]
};
export let bestialFury = {
    name: 'Bestial Fury',
    version: primalCompanion.version,
    rules: primalCompanion.rules,
    midi: {
        item: [
            {
                pass: 'damageRollComplete',
                macro: damage,
                priority: 250
            }
        ]
    }
};
export let primalCompanionStrike = {
    name: 'Beast\'s Strike',
    version: primalCompanion.version,
    rules: primalCompanion.rules,
    midi: {
        item: [
            {
                pass: 'preTargeting',
                macro: strikePreTargeting,
                priority: 50
            }
        ]
    }
};