import {activityUtils, compendiumUtils, constants, dialogUtils, effectUtils, errors, genericUtils, itemUtils, tokenUtils, workflowUtils} from '../../../utils.js';
async function use({workflow}) {
    let concentrationEffect = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    if (!workflow.targets.size) {
        if (concentrationEffect) await genericUtils.remove(concentrationEffect);
        return;
    }
    let feature = activityUtils.getActivityByIdentifier(workflow.item, 'huntersMarkMove', {strict: true});
    if (!feature) {
        if (concentrationEffect) await genericUtils.remove(concentrationEffect);
        return;
    }
    let seconds;
    switch (workflowUtils.getCastLevel(workflow)) {
        case 3:
        case 4:
            seconds = 28800;
            break;
        case 5:
        case 6:
        case 7:
        case 8:
        case 9:
            seconds = 86400;
            break;
        default:
            seconds = 3600;
    }
    let durationScale = workflow.item.system.duration.value;
    seconds = Math.min(seconds * durationScale, 86400);
    let targetEffectData = {
        name: genericUtils.translate('CHRISPREMADES.Macros.HuntersMark.Marked'),
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: {
            seconds
        }
    };
    let foeSlayer = itemUtils.getItemByIdentifier(workflow.actor, 'foeSlayer');
    let damageFormulaItem = foeSlayer ? foeSlayer : workflow.item;
    let casterEffectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: {
            seconds
        },
        flags: {
            'chris-premades': {
                huntersMark: {
                    targets: Array.from(workflow.targets).map(i => i.document.uuid),
                    formula: itemUtils.getConfig(damageFormulaItem, 'formula'),
                    damageType: itemUtils.getConfig(damageFormulaItem, 'damageType')
                }
            }
        }
    };
    let casterEffect = await effectUtils.createEffect(workflow.actor, casterEffectData, {
        concentrationItem: workflow.item, 
        strictlyInterdependent: true, 
        vae: [{
            type: 'use', 
            name: feature.name, 
            identifier: 'huntersMark',
            activityIdentifier: 'huntersMarkMove'
        }], 
        identifier: 'huntersMark',
        rules: 'modern',
        macros: [{type: 'midi.actor', macros: ['huntersMarkSource']}],
        unhideActivities: {
            itemUuid: workflow.item.uuid,
            activityIdentifiers: ['huntersMarkMove'],
            favorite: true
        }
    });
    await Promise.all(workflow.targets.map(async i => await effectUtils.createEffect(i.actor, targetEffectData, {parentEntity: casterEffect, identifier: 'huntersMarkMarked'})));
    if (concentrationEffect) await genericUtils.update(concentrationEffect, {'duration.seconds': seconds});
}
async function move({workflow}) {
    if (workflow.targets.size > 1) return;
    let effect = effectUtils.getEffectByIdentifier(workflow.actor, 'huntersMark');
    if (!effect) return;
    let targetUuids = effect.flags['chris-premades'].huntersMark.targets;
    let newTarget = workflow.targets.first();
    if (!newTarget) {
        // No target selected: run the native Argon canvas picker (the "0/1 targets" flow used by
        // HUD attacks and Magic Missile) when available; fall back to a list dialog without Argon.
        let range = workflow.item.system.range?.value ?? 90;
        let argonApi = game.modules.get('enhancedcombathud')?.active ? game.modules.get('enhancedcombathud').api : undefined;
        if (typeof argonApi?.runTargetPicker === 'function') {
            let picked = await argonApi.runTargetPicker({token: workflow.token, targets: 1, ranges: {normal: range, long: null}, item: workflow.item});
            if (!picked) return;
            newTarget = game.user.targets.first();
            if (!newTarget) return;
        } else {
            let candidates = tokenUtils.findNearby(workflow.token, range, null, {includeIncapacitated: false}).filter(i => !targetUuids.includes(i.document.uuid));
            if (!candidates.length) {
                genericUtils.notify('CHRISPREMADES.Macros.HuntersMark.MoveNoTargets', 'info');
                return;
            }
            let newTargetSelection = await dialogUtils.selectTargetDialog(workflow.item.name, 'CHRISPREMADES.Macros.HuntersMark.MoveSelect', candidates);
            if (!newTargetSelection) return;
            newTarget = newTargetSelection[0];
            if (!newTarget) return;
        }
    }
    let targets = targetUuids.map(i => fromUuidSync(i)?.object).filter(i => i);
    let selection;
    if (targets.length) {
        if (targets.length > 1) {
            selection = await dialogUtils.selectTargetDialog(workflow.item.name, 'CHRISPREMADES.Macros.HuntersMark.Select', targets, {skipDeadAndUnconscious: false});
            if (!selection) return;
            selection = selection[0];
        } else {
            selection = targets[0];
        }
    }
    if (selection?.actor) {
        let effect = effectUtils.getEffectByIdentifier(selection.actor, 'huntersMarkMarked');
        if (effect) await genericUtils.remove(effect);
    }
    targetUuids = targetUuids.filter(i => i !== selection?.document.uuid);
    targetUuids.push(newTarget.document.uuid);
    await genericUtils.setFlag(effect, 'chris-premades', 'huntersMark.targets', targetUuids);
    let seconds = effect.duration.remaining;
    let effectData = {
        name: genericUtils.translate('CHRISPREMADES.Macros.HuntersMark.Marked'),
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: {
            seconds
        }
    };
    await effectUtils.createEffect(newTarget.actor, effectData, {parentEntity: effect, identifier: 'huntersMarkMarked'});
}
async function attack({workflow}) {
    if (workflow.targets.size !== 1) return;
    let preciseHunter = itemUtils.getItemByIdentifier(workflow.actor, 'preciseHunter');
    if (!preciseHunter) return;
    let effect = effectUtils.getEffectByIdentifier(workflow.actor, 'huntersMark');
    if (!effect) return;
    let {targets: validTargetUuids} = effect.flags['chris-premades'].huntersMark;
    if (!validTargetUuids.includes(workflow.targets.first().document.uuid)) return;
    workflow.tracker.advantage.add(preciseHunter.name, preciseHunter.name);
}
async function damage({workflow}) {
    if (workflow.hitTargets.size !== 1) return;
    if (!workflowUtils.isAttackType(workflow, 'attack')) return;
    let effect = effectUtils.getEffectByIdentifier(workflow.actor, 'huntersMark');
    if (!effect) return;
    let {targets: validTargetUuids, formula, damageType} = effect.flags['chris-premades'].huntersMark;
    if (!validTargetUuids.includes(workflow.hitTargets.first().document.uuid)) return;
    await workflowUtils.bonusDamage(workflow, formula, {damageType});
}
async function early({dialog}) {
    dialog.configure = false;
}
// RAW 2024: the mark can only be moved once the marked creature has dropped to 0 HP.
// Gated on dnd5e's preUseActivity so a blocked attempt cancels BEFORE the usage card,
// consumption, and MidiQOL's action-economy bookkeeping (setBonusActionUsed runs inside
// MidiActivityMixin.use() even for workflows a preItemRoll/state macro later aborts).
// Re-cast gate (2026-08-29, the same-spell recast re-frame): clicking Hunter's Mark while
// already concentrating on it offers Move / Re-cast / Cancel instead of silently dropping the
// mark — the same shape as Flaming Sphere's T19 gate. Move is offered unconditionally: the RAW
// 0-HP gate below refuses an illegal move with its own notice, which keeps the rule in ONE
// place. Re-cast re-dispatches with dnd5eLSC.handled so the generic concentration warning in
// dnd5e-lowest-slot-cast stands down and its dual-pool routing decides the resource (free use
// first, slot with confirm otherwise). The claim registered at ready is what tells that module
// this spell owns its own same-spell moment.
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    let item = activity.item;
    if (item?.identifier !== 'hunters-mark' || item.type !== 'spell' || !item.actor) return;
    if (activityUtils.getIdentifier(activity) === 'huntersMarkMove') return;
    if (usageConfig?.dnd5eLSC?.handled || usageConfig?.dnd5eLSC?.routed) return;
    let effect = effectUtils.getEffectByIdentifier(item.actor, 'huntersMark');
    if (!effect) return; // not concentrating on it: a normal cast
    (async () => {
        let choice = await dialogUtils.buttonDialog(item.name, 'CHRISPREMADES.Macros.HuntersMark.RecastPrompt', [
            ['CHRISPREMADES.Macros.HuntersMark.RecastMove', 'move'],
            ['CHRISPREMADES.Macros.HuntersMark.RecastRecast', 'recast'],
            ['CHRISPREMADES.Macros.HuntersMark.RecastCancel', 'cancel']
        ]);
        if (!choice || choice === 'cancel') return; // clean abort, nothing spent
        if (choice === 'move') {
            let moveActivity = activityUtils.getActivityByIdentifier(item, 'huntersMarkMove', {strict: true});
            if (moveActivity) await moveActivity.use({}, {}, {});
            return;
        }
        await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {dnd5eLSC: {handled: true}}, {inplace: false}), {}, {});
    })();
    return false;
});
Hooks.once('ready', () => {
    game.modules.get('dnd5e-lowest-slot-cast')?.api?.claimSameSpellRecast('hunters-mark');
});
Hooks.on('dnd5e.preUseActivity', activity => {
    if (activityUtils.getIdentifier(activity) !== 'huntersMarkMove') return;
    let actor = activity.item?.actor;
    if (!actor) return;
    let effect = effectUtils.getEffectByIdentifier(actor, 'huntersMark');
    if (!effect) return;
    let targetUuids = effect.flags['chris-premades']?.huntersMark?.targets ?? [];
    if (!targetUuids.length) return;
    let marked = targetUuids.map(i => fromUuidSync(i)).filter(i => i);
    // Marked targets that no longer resolve (deleted tokens) count as dropped
    if (marked.length < targetUuids.length) return;
    if (marked.some(i => (i.actor ?? i)?.system?.attributes?.hp?.value <= 0)) return;
    genericUtils.notify('CHRISPREMADES.Macros.HuntersMark.MoveRequiresDropped', 'info');
    return false;
});
export let huntersMark = {
    name: 'Hunter\'s Mark',
    version: '1.2.28',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['huntersMark']
            },
            {
                pass: 'rollFinished',
                macro: move,
                priority: 50,
                activities: ['huntersMarkMove']
            },
            {
                pass: 'preTargeting',
                macro: early,
                priority: 50,
                activities: ['huntersMarkMove']
            }
        ]
    },
    config: [
        {
            value: 'formula',
            label: 'CHRISPREMADES.Config.Formula',
            type: 'text',
            default: '1d6',
            homebrew: true,
            category: 'homebrew'
        },
        {
            value: 'damageType',
            label: 'CHRISPREMADES.Config.DamageType',
            type: 'select',
            default: 'force',
            options: constants.damageTypeOptions,
            homebrew: true,
            category: 'homebrew'
        }
    ]
};
export let huntersMarkSource = {
    name: 'Hunter\'s Mark (source)',
    version: huntersMark.version,
    midi: {
        actor: [
            {
                pass: 'preAttackRollConfig',
                macro: attack,
                priority: 50
            },
            {
                pass: 'damageRollComplete',
                macro: damage,
                priority: 250
            }
        ]
    }
};
