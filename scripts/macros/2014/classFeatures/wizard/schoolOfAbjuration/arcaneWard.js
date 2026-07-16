import {activityUtils, dialogUtils, effectUtils, genericUtils, itemUtils, socketUtils, tokenUtils, workflowUtils} from '../../../../../utils.js';

// The ward's current HP lives on a single Active Effect (identifier 'arcaneWard') whose presence IS the
// ward: it exists once created and lasts until a long rest deletes it, carries the HP in a flag, and
// shows the value in its name. No feature uses, no create gate — "already created today" = the effect
// exists, so the first abjuration cast creates it and later abjuration casts recharge it.
function wardName(hp) {
    return genericUtils.format('CHRISPREMADES.Macros.ArcaneWard.EffectName', {hp});
}
function wardDescription() {
    return genericUtils.translate('CHRISPREMADES.Macros.ArcaneWard.EffectDescription');
}
function maxWardHP(actor) {
    return (actor.classes?.wizard?.system.levels ?? 0) * 2 + actor.system.abilities.int.mod;
}
export async function arcaneWardHelper(item, ditem, token, targetToken) {
    if (!ditem.isHit) return;
    let effect = effectUtils.getEffectByIdentifier(item.actor, 'arcaneWard');
    if (!effect) return;
    let hp = effect.flags['chris-premades']?.arcaneWard?.hp ?? 0;
    if (!hp) return; // ward at 0 HP: it persists (still rechargeable) but can't absorb
    let temp = ditem.oldTempHP * itemUtils.getConfig(item, 'tempFirst');
    let hpDamage = ditem.damageDetail.reduce((acc, i) => acc + (i.properties.has('heal') ? 0 : i.value), 0) - temp;
    if (hpDamage <= 0) return;
    let absorbed = Math.min(hpDamage, hp);
    let remainingDamage = hpDamage - absorbed;
    if (token) {
        let projectedWard = itemUtils.getItemByIdentifier(token.actor, 'projectedWard');
        if (!projectedWard) return;
        if (targetToken.document.disposition !== token.document.disposition) return;
        if (tokenUtils.getDistance(token, targetToken) > 30) return;
        let selection = await dialogUtils.confirm(item.name, genericUtils.format('CHRISPREMADES.Macros.ArcaneWard.Protect', {tokenName: targetToken.name}), {userId: socketUtils.firstOwner(token.actor, true)});
        if (!selection) return;
        await workflowUtils.completeItemUse(projectedWard);
    }
    let remaining = hp - absorbed;
    await genericUtils.update(effect, {name: wardName(remaining), 'flags.chris-premades.arcaneWard.hp': remaining});
    workflowUtils.setDamageItemDamage(ditem, remainingDamage + temp, false);
    await ChatMessage.create({
        speaker: ChatMessage.implementation.getSpeaker({actor: item.actor}),
        content: genericUtils.format('CHRISPREMADES.Macros.ArcaneWard.Absorbed', {absorbed, remaining})
    });
}
async function damageApplication({trigger: {entity: item}, ditem}) {
    await arcaneWardHelper(item, ditem);
}
async function late({trigger: {entity: item}, workflow}) {
    if (workflow.item.type !== 'spell') return;
    if (workflow.item.system.school !== 'abj') return;
    let spellLevel = workflowUtils.getCastLevel(workflow);
    if (!spellLevel) return;
    if (workflowUtils.isSustainedRoll(workflow)) return;
    let actor = item.actor;
    let maxHP = maxWardHP(actor);
    if (maxHP <= 0) return;
    let effect = effectUtils.getEffectByIdentifier(actor, 'arcaneWard');
    if (!effect) {
        // First abjuration spell (level 1+) of the day → create the ward at full HP (RAW "simultaneously").
        await effectUtils.createEffect(actor, {
            name: wardName(maxHP),
            description: wardDescription(),
            img: item.img,
            flags: {'chris-premades': {arcaneWard: {hp: maxHP, max: maxHP}}}
        }, {identifier: 'arcaneWard'});
    } else {
        // Ward already up → recharge by 2 x the spell's level, capped at the (recomputed) max.
        let hp = effect.flags['chris-premades']?.arcaneWard?.hp ?? 0;
        let newHp = Math.clamp(hp + spellLevel * 2, 0, maxHP);
        await genericUtils.update(effect, {name: wardName(newHp), 'flags.chris-premades.arcaneWard': {hp: newHp, max: maxHP}});
    }
}
async function longRest({trigger: {entity: item}}) {
    let effect = effectUtils.getEffectByIdentifier(item.actor, 'arcaneWard');
    if (effect) await genericUtils.remove(effect);
}
export let arcaneWard = {
    name: 'Arcane Ward',
    version: '1.1.0',
    midi: {
        actor: [
            {
                pass: 'targetApplyDamage',
                macro: damageApplication,
                priority: 50
            },
            {
                pass: 'rollFinished',
                macro: late,
                priority: 50
            }
        ]
    },
    rest: [
        {
            pass: 'long',
            macro: longRest,
            priority: 50
        }
    ],
    config: [
        {
            value: 'tempFirst',
            label: 'CHRISPREMADES.Macros.ArcaneWard.TempHP',
            type: 'checkbox',
            default: false,
            category: 'homebrew',
            homebrew: true
        }
    ],
    ddbi: {
        removedItems: {
            'Arcane Ward': [
                'Arcane Ward - Hit Points'
            ]
        },
        correctedItems: {
            'Arcane Ward': {
                system: {
                    // Ward HP lives on the 'arcaneWard' effect now, not feature uses — clear any imported
                    // limited uses so the feature shows no (confusing) uses pips.
                    uses: {
                        spent: 0,
                        max: '',
                        recovery: []
                    }
                }
            }
        }
    }
};