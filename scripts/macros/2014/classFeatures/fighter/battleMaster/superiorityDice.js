import {activityUtils, constants, dialogUtils, genericUtils, itemUtils, rollUtils, workflowUtils} from '../../../../../utils.js';
import {MANEUVER_PARENT_IDENTIFIER, maneuverLabel, resolveManeuverHandles} from '../../../../../lib/utilities/maneuverHandles.mjs';
import {maneuverSection} from '../../../../../lib/utilities/maneuverCard.mjs';
/**
 * T232: the "Maneuver Options" parent item, when this actor's maneuvers are modelled as its
 * activities rather than as one item each. See lib/utilities/maneuverHandles.mjs.
 */
export function maneuverParent(actor) {
    return itemUtils.getItemByIdentifier(actor, MANEUVER_PARENT_IDENTIFIER);
}
/** Is this workflow a maneuver used AS an activity of the parent? */
export function isParentManeuver(workflow) {
    return genericUtils.getIdentifier(workflow?.item) === MANEUVER_PARENT_IDENTIFIER;
}
/** The name a player should read for the maneuver behind this workflow ("Riposte", never "Maneuver Options"). */
export function maneuverName(workflow) {
    return maneuverLabel({underParent: isParentManeuver(workflow), activityName: workflow?.activity?.name, itemName: workflow?.item?.name});
}
/** The icon a player should see for the maneuver behind this workflow — the activity's own under the parent. */
export function maneuverImg(workflow) {
    if (isParentManeuver(workflow) && workflow?.activity?.img) return workflow.activity.img;
    return workflow?.item?.img;
}
/**
 * The rules text of the maneuver behind this workflow, for an effect it creates. Under the parent
 * the ITEM's description is every chosen maneuver's text, and an effect with no description of
 * its own inherits all of it — a wall of text on the target's effect tooltip. `undefined` for the
 * separate-item shape, so nothing changes there.
 */
export function maneuverText(workflow) {
    if (!isParentManeuver(workflow)) return undefined;
    return maneuverSection(workflow.item?.system?.description?.value, workflow.activity?.name) ?? undefined;
}
async function hit({workflow}) {
    await superiorityHelper(workflow);
}
/**
 * The Battle Master's own die size, read without asking anyone anything.
 * `d6` when the actor has no Superiority Dice feature (Martial Adept / Superior Technique only).
 */
export function battleMasterDie(actor) {
    let superiorityDiceItem = itemUtils.getItemByIdentifier(actor, 'superiorityDice');
    if (!superiorityDiceItem) return 'd6';
    let subclass = itemUtils.getConfig(superiorityDiceItem, 'subclass');
    let scale = itemUtils.getConfig(superiorityDiceItem, 'scale');
    let value = actor.system.scale?.[subclass]?.[scale]?.die;
    if (!value) genericUtils.notify(genericUtils.format('CHRISPREMADES.Generic.MissingScale', {scaleName: `${subclass}.${scale}`}), 'warn');
    return value ?? 'd6';
}
/**
 * The die a maneuver rolls when ITS OWN ACTIVITY already spent from `poolItem`: the Battle Master
 * die for the Superiority Dice feature, a d6 for the flat pools (Martial Adept, Superior Technique).
 */
export function dieForPool(actor, poolItem) {
    return genericUtils.getIdentifier(poolItem) === 'superiorityDice' ? battleMasterDie(actor) : 'd6';
}
export async function determineSuperiorityDie(actor) {
    let superiorityDiceItem = itemUtils.getItemByIdentifier(actor, 'superiorityDice');
    let superiorityDie = battleMasterDie(actor);
    let isBattleMaster = superiorityDie !== 'd6';
    let allSameDice = !isBattleMaster || (isBattleMaster && actor.classes.fighter?.system.levels >= 10);
    let martialAdept = itemUtils.getItemByIdentifier(actor,'martialAdept');
    let superiorTechnique = itemUtils.getItemByIdentifier(actor, 'fightingStyleSuperiorTechnique');
    let itemToUse;
    if (!allSameDice && superiorityDiceItem?.system.uses.value && (martialAdept?.system.uses.value || superiorTechnique?.system.uses.value)) {
        let buttons = [];
        if (superiorityDiceItem?.system.uses.value) {
            buttons.push([superiorityDiceItem.name + ': ' + superiorityDie + ' (' + superiorityDiceItem.system.uses.value + '/' + superiorityDiceItem.system.uses.max + ')', 'superiorityDice']);
        }
        if (martialAdept?.system.uses.value) {
            buttons.push([martialAdept.name + ': d6 (' + martialAdept.system.uses.value + '/' + martialAdept.system.uses.max + ')', 'martialAdept']);
        }
        if (superiorTechnique?.system.uses.value) {
            buttons.push([superiorTechnique.name + ': d6 (' + superiorTechnique.system.uses.value + '/' + superiorTechnique.system.uses.max + ')', 'fightingStyleSuperiorTechnique']);
        }
        buttons.push(['DND5E.None', false]);
        itemToUse = itemUtils.getItemByIdentifier(actor, await dialogUtils.buttonDialog(superiorityDiceItem.name, 'CHRISPREMADES.Macros.Maneuvers.SelectDice', buttons));
        if (itemToUse !== superiorityDiceItem) superiorityDie = 'd6';
    } else {
        if (superiorityDiceItem?.system.uses.value) {
            itemToUse = superiorityDiceItem;
        } else if (martialAdept?.system.uses.value) {
            itemToUse = martialAdept;
        } else if (superiorTechnique?.system.uses.value) {
            itemToUse = superiorTechnique;
        }
    }
    return [itemToUse, superiorityDie];
}
/**
 * The 2014 on-hit riders. 2024 drops Grappling Strike entirely, so the modern line passes its own
 * list rather than editing this one — see `2024/…/maneuvers.js`. Kept module-level and COPIED at
 * use (never mutated in place): the `mwak` branch below pushes Sweeping Attack, which on a shared
 * array would grow it once per melee attack for the rest of the session.
 */
export const legacyTriggerManeuvers = [
    'maneuversDisarmingAttack',
    'maneuversDistractingStrike',
    'maneuversGoadingAttack',
    'maneuversGrapplingStrike',
    'maneuversManeuveringAttack',
    'maneuversMenacingAttack',
    'maneuversPushingAttack',
    'maneuversTripAttack'
];
export async function superiorityHelper(workflow, {triggerManeuvers = legacyTriggerManeuvers} = {}) {
    if (!workflowUtils.isAttackType(workflow, 'weaponAttack')) return;
    if (activityUtils.getIdentifier(workflow.activity) === 'sweepingAttackAttack') return;
    /**
     * ⚠️ RAW: "Many maneuvers enhance an attack in some way. **You can use only one maneuver per
     * attack.**" (2024 Combat Superiority, verbatim from `dnd-players-handbook.classes`.)
     *
     * An attack GENERATED BY a maneuver already has its maneuver, so offering another on it stacks
     * two on one attack. Riposte's counter-attack is the case that surfaced this — it was prompting
     * for Goading/Maneuvering Attack on top of itself. The `sweepingAttackAttack` line above is the
     * same rule handled one maneuver at a time; this flag generalises it, so any future maneuver
     * that rolls its own attack only has to set `workflowOptions.maneuverAttack`.
     *
     * ⚠️ NOT the same as a per-TURN limit — there is none. On your own turn with Extra Attack a
     * maneuver may be spent on each separate attack; the cap is per attack, plus your dice.
     */
    if (workflow.workflowOptions?.maneuverAttack) return;
    let [itemToUse, superiorityDie] = await determineSuperiorityDie(workflow.actor);
    if (!itemToUse) return;
    let candidates = [...triggerManeuvers];
    if (workflowUtils.getActionType(workflow) === 'mwak') candidates.push('maneuversSweepingAttack');
    // T232: a maneuver is either its own item or an activity of the "Maneuver Options" parent.
    let parent = maneuverParent(workflow.actor);
    let handles = resolveManeuverHandles(candidates, {
        itemByIdentifier: i => itemUtils.getItemByIdentifier(workflow.actor, i),
        // Ask only for keys the parent declares: a strict lookup WARNS on every maneuver not chosen.
        parentActivityByKey: key => parent?.flags['chris-premades']?.activityIdentifiers?.[key] ? activityUtils.getActivityByIdentifier(parent, key, {strict: true}) : undefined
    });
    if (!handles.length) return;
    let selected = await dialogUtils.selectDocumentDialog(itemToUse.name, 'CHRISPREMADES.Macros.Maneuvers.SelectManeuver', handles.map(i => i.doc), {addNoneDocument: true});
    if (!selected) return;
    let handle = handles.find(i => i.doc === selected) ?? handles.find(i => i.doc.id === selected.id);
    if (!handle) return;
    let selectedIdentifier = handle.identifier;
    let rollTotal;
    if (!['maneuversGrapplingStrike', 'maneuversSweepingAttack'].includes(selectedIdentifier)) {
        await workflowUtils.bonusDamage(workflow, superiorityDie, {damageType: workflow.defaultDamageType});
        rollTotal = workflow.damageRolls.at(-1).total;
        // Same explanation Riposte posts for its own die: name the maneuver that spent it, so the
        // damage ⓘ accounts for every die on the card rather than leaving an unexplained one.
        await rollUtils.postRerollNote(workflow, {
            source: selected.name,
            kind: 'superiorityDie',
            die: superiorityDie,
            total: rollTotal
        });
    } else if (selectedIdentifier === 'maneuversSweepingAttack') {
        await genericUtils.update(handle.kind === 'activity' ? selected.item : selected, {'flags.chris-premades.sweepingAttack': {
            currAttackRoll: workflow.attackRoll.total,
            currDamageType: workflow.defaultDamageType,
            currRange: workflow.item.system.range.value ?? workflow.item.system.range.reach ?? 5
        }});
    }
    let useSmall = genericUtils.getProperty(workflow.actor, 'flags.chris-premades.useSmallSuperiorityDie');
    if (!useSmall && superiorityDie === 'd6') await genericUtils.setFlag(workflow.actor, 'chris-premades', 'useSmallSuperiorityDie', true);
    if (handle.kind === 'activity') await workflowUtils.completeActivityUse(selected);
    else await workflowUtils.completeItemUse(selected);
    if (!useSmall && superiorityDie === 'd6') await genericUtils.update(workflow.actor, {'flags.chris-premades.-=useSmallSuperiorityDie': null});
    await genericUtils.update(itemToUse, {'system.uses.spent': itemToUse.system.uses.spent + 1});
}
export let superiorityDice = {
    name: 'Superiority Dice',
    aliases: 'Combat Superiority',
    version: '1.1.0',
    midi: {
        actor: [
            {
                pass: 'damageRollComplete',
                macro: hit,
                priority: 50
            }
        ]
    },
    config: [
        {
            value: 'subclass',
            label: 'CHRISPREMADES.Config.ClassIdentifier',
            type: 'text',
            default: 'battle-master',
            category: 'homebrew',
            homebrew: true
        },
        {
            value: 'scale',
            label: 'CHRISPREMADES.Config.ScaleIdentifier',
            type: 'text',
            default: 'combat-superiority-die',
            category: 'homebrew',
            homebrew: true
        }
    ]
};