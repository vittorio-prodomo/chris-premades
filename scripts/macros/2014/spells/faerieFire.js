import {actorUtils, animationUtils, dialogUtils, effectUtils, genericUtils, itemUtils} from '../../../utils.js';

// Hand-off between the pre-use color gate and the rollFinished macro (same client runs both).
const pendingCasts = new Map();

function isFaerieFire(item) {
    return item?.flags?.['chris-premades']?.info?.identifier === 'faerieFire';
}

// Color-first + safe-cancel gate (pattern: potionOfHealing.js / huntersMark.js).
// dnd5e's preUseActivity fires before the usage dialog, consumption, concentration and the
// chat card, so cancelling the color pick aborts with zero side effects. The real spend is
// DEFERRED (preActivityConsumption below) and performed by the rollFinished macro only once
// the template is actually placed and the workflow completed — cancelling template placement
// (Esc / right-click) therefore never costs the slot or the innate use.
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    if (!isFaerieFire(activity.item)) return;
    if (usageConfig?.chrisPremades?.faerieFireColorPicked) return;
    (async () => {
        // Reuse dnd5e's own affordability check up front: with consumption deferred, use()
        // would no longer abort on an empty pool / missing slot, so validate here instead.
        let dryRun = await activity._prepareUsageUpdates(genericUtils.mergeObject(usageConfig ?? {}, {consume: true}, {inplace: false}), {returnErrors: true});
        if (foundry.utils.getType(dryRun) !== 'Object') {
            dryRun?.forEach?.(err => ui.notifications.warn(err.message));
            return;
        }
        let selection = await dialogUtils.buttonDialog(activity.item.name, 'CHRISPREMADES.Macros.FaerieFire.ChooseColor', [
            ['CHRISPREMADES.Config.Colors.Blue', 'blue'],
            ['CHRISPREMADES.Config.Colors.Green', 'green'],
            ['CHRISPREMADES.Config.Colors.Purple', 'purple'],
            ['CHRISPREMADES.Generic.Cancel', false]
        ]);
        if (!selection) return; // cancelled or dismissed: clean abort, nothing spent, no card
        pendingCasts.set(activity.item.uuid, {color: selection, ts: Date.now()});
        let results = await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {faerieFireColorPicked: true}}, {inplace: false}), {configure: false}, {});
        // Template placement cancelled (Esc / right-click): the workflow parks before
        // rollFinished, so the macro's cleanup never runs — undo the cast from here. Nothing
        // was consumed (deferred); remove the card + concentration and the parked workflow.
        if (pendingCasts.has(activity.item.uuid) && results) {
            let placed = (results.templates ?? []).flat();
            if (!placed.length) {
                pendingCasts.delete(activity.item.uuid);
                let message = results.message?.uuid ? await fromUuid(results.message.uuid) : undefined;
                if (globalThis.MidiQOL?.Workflow?.getWorkflow?.(message?.uuid)) MidiQOL.Workflow.removeWorkflow(message.uuid);
                await cleanupCancelledCast({actor: activity.item.actor, item: activity.item, itemCardUuid: message?.uuid});
            }
        }
    })();
    return false;
});

// Defer the spend for gated casts. Runs inside Activity#consume AFTER the usage dialog, so a
// dialog can't re-enable it. The rollFinished macro deletes the pendingCasts entry before
// performing the real consumption, which lets its own consume() call pass through here.
Hooks.on('dnd5e.preActivityConsumption', (activity, usageConfig) => {
    if (!isFaerieFire(activity.item)) return;
    let pending = pendingCasts.get(activity.item.uuid);
    if (!pending || Date.now() - pending.ts > 60000) return;
    usageConfig.consume = false;
});

// Template placement was cancelled: nothing was consumed (deferred), so just remove what
// dnd5e already created — the concentration effect and the usage card.
async function cleanupCancelledCast(workflow) {
    let concentration = Array.from(workflow.actor?.concentration?.effects ?? []).find(e => {
        let itemId = e.flags?.dnd5e?.item?.id ?? e.flags?.dnd5e?.itemId;
        return itemId === workflow.item.id || e.origin === workflow.item.uuid;
    });
    if (concentration) await genericUtils.remove(concentration);
    if (workflow.itemCardUuid) {
        let card = await fromUuid(workflow.itemCardUuid);
        if (card) await card.delete().catch(() => {});
    }
}

async function use({workflow}) {
    let pending = pendingCasts.get(workflow.item.uuid);
    pendingCasts.delete(workflow.item.uuid);
    let templateDoc = await fromUuid(workflow.templateUuid);
    if (!templateDoc) {
        if (pending) await cleanupCancelledCast(workflow);
        return;
    }
    if (pending) {
        // Perform the deferred consumption now the cast really happened. Mirrors the chat
        // card's own "Consume Resource" handler so the card's Refund button keeps working.
        let message = workflow.itemCardUuid ? await fromUuid(workflow.itemCardUuid) : undefined;
        let messageConfig = {};
        // workflow is included because midi's temporary activityConsumption hook (alive until
        // use() unwinds) writes to usageConfig.workflow and throws on a config without it.
        await workflow.activity.consume({consume: true, scaling: message?.system?.scaling ?? 0, workflow}, messageConfig);
        if (message && !foundry.utils.isEmpty(messageConfig.data)) await message.update(messageConfig.data);
    }
    let playAnimation = itemUtils.getConfig(workflow.item, 'playAnimation');
    let color = pending?.color ?? itemUtils.getConfig(workflow.item, 'color');
    let lightAlpha = Number(itemUtils.getConfig(workflow.item, 'lightIntensity'));
    if (!(lightAlpha >= 0.05 && lightAlpha <= 1)) lightAlpha = 0.65;
    let lightColor;
    let tintColor;
    let hue;
    switch (color) {
        case 'blue':
            lightColor = '#5ab9e2';
            tintColor = '0x91c5d2';
            hue = 160;
            break;
        case 'green':
            lightColor = '#55d553';
            tintColor = '0xd3eb6a';
            hue = 45;
            break;
        case 'purple':
            lightColor = '#844ec6';
            tintColor = '0xdcace3';
            hue = 250;
    }
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: itemUtils.convertDuration(workflow.item),
        changes: [
            {
                key: 'flags.midi-qol.grants.advantage.attack.all',
                mode: 0,
                value: 1,
                priority: 20
            },
            {
                key: 'system.traits.ci.value',
                mode: 2,
                value: 'invisible',
                priority: 20
            },
            {
                key: 'ATL.light.dim',
                mode: 4,
                value: 10,
                priority: 20
            },
            {
                key: 'ATL.light.color',
                mode: 5,
                value: lightColor,
                priority: 20
            },
            {
                key: 'ATL.light.alpha',
                mode: 5,
                value: String(lightAlpha),
                priority: 20
            },
            {
                key: 'ATL.light.animation',
                mode: 5,
                value: '{"type": "pulse", "speed": 1, "intensity": 3}',
                priority: 20
            }
        ],
        flags: {
            'chris-premades': {
                faerieFire: {
                    playAnimation: playAnimation
                }
            }
        }
    };
    effectUtils.addMacro(effectData, 'effect', ['faerieFireOutlined']);
    let template = templateDoc.object;
    let position = template ? template.ray.project(0.5) : undefined;
    let shouldAnimate = playAnimation && position && animationUtils.jb2aCheck() === 'patreon' && animationUtils.aseCheck();
    if (shouldAnimate) {
        new Sequence()
            .effect()
            .file('animated-spell-effects-cartoon.flash.25')
            .atLocation(position)
            .scale(0.05)
            .playbackRate(1)
            .duration(1500)
            .opacity(0.75)
            .scaleIn(0, 1000, {ease: 'easeOutCubic'})
            .filter('ColorMatrix', {brightness: 0, hue: hue})
            .filter('Blur', {blurX: 5, blurY: 10 })
            .animateProperty('sprite', 'width', {from: 0, to: -0.25, duration: 2500, gridUnits: true, ease: 'easeInOutBack'})
            .animateProperty('sprite', 'height', {from: 0, to: -0.25, duration: 2500, gridUnits: true, ease: 'easeInOutBack'})
            .belowTokens()

            .effect()
            .file('jb2a.particles.outward.white.01.03')
            .atLocation(position)
            .scale(0.025)
            .playbackRate(1)
            .duration(1500)
            .fadeIn(1500)
            .scaleIn(0, 1500, {ease: 'easeOutCubic'})
            .filter('ColorMatrix', {hue: hue})
            .animateProperty('sprite', 'width', {from: 0, to: 0.5, duration: 2500, gridUnits :true, ease: 'easeOutBack'})
            .animateProperty('sprite', 'height', {from: 0, to: 1, duration: 2500, gridUnits: true, ease: 'easeOutBack'})
            .animateProperty('sprite', 'position.y', {from: 0, to: -0.45, duration: 2500, gridUnits: true})

            .effect()
            .file('jb2a.sacred_flame.target.' + color)
            .atLocation(position)
            .scale(0.05)
            .playbackRate(1)
            .duration(1500)
            .scaleIn(0, 1500, {ease: 'easeOutCubic'})
            .animateProperty('sprite', 'width', {from: 0, to: 0.5, duration: 2500, gridUnits: true, ease: 'easeOutBack'})
            .animateProperty('sprite', 'height', {from: 0, to: 0.5, duration: 2500, gridUnits: true, ease: 'easeOutBack'})
            .animateProperty('sprite', 'position.y', {from: 0, to: -0.25, duration: 2500, gridUnits: true, ease: 'easeOutBack'})
            .waitUntilFinished(-200)

            .effect()
            .file('jb2a.impact.010.' + color)
            .atLocation(position, {offset: {y:-0.25}, gridUnits: true})
            .scale(0.45)
            .randomRotation()
            .zIndex(1)

            .effect()
            .file('jb2a.particles.outward.white.01.03')
            .scaleIn(0, 500, {ease: 'easeOutQuint'})
            .fadeOut(1000)
            .atLocation(position, {offset: {y:-0.25}, gridUnits: true})
            .randomRotation()
            .duration(2500)
            .size(3, {gridUnits: true})
            .filter('Glow', {color: tintColor, distance: 10})
            .zIndex(2)

            .effect()
            .file('jb2a.fireflies.{{Pfew}}.02.' + color)
            .atLocation(position, {randomOffset: 0.25})
            .scaleToObject(1.8)
            .randomRotation()
            .duration(750)
            .fadeOut(500)
            .setMustache({
                Pfew: ()=> {
                    let Pfews = ['few','many'];
                    return Pfews[Math.floor(Math.random()*Pfews.length)];
                }
            })
            .repeats(10, 75, 75)
            .zIndex(1)

            .effect()
            .file('animated-spell-effects-cartoon.energy.pulse.yellow')
            .atLocation(position, {offset: {y:-0.25}, gridUnits: true})
            .size(5, {gridUnits: true})
            .filter('ColorMatrix', {saturate: -1, brightness:2, hue: hue})
            .fadeOut(250)
            .filter('Blur', {blurX: 10, blurY: 10})
            .zIndex(0.5)

            .effect()
            .delay(50)
            .file('animated-spell-effects-cartoon.energy.pulse.yellow')
            .atLocation(position, {offset: {y:-0.25}, gridUnits: true})
            .size(5, {gridUnits: true})
            .filter('ColorMatrix', {hue: hue})
            .zIndex(0.5)

            .play();
    }
    if (!workflow.failedSaves.size) return;
    for (let target of workflow.failedSaves) {
        await effectUtils.createEffect(target.actor, effectData, {concentrationItem: workflow.item});
        if (shouldAnimate) {
            new Sequence()
                .effect()
                .file('jb2a.fireflies.many.01.' + color)
                .attachTo(target)
                .scaleToObject(1.4)
                .persist()
                .randomRotation()
                .fadeIn(500, {delay:500})
                .fadeOut(1500, {ease: 'easeInSine'})
                .name('Faerie Fire')
                .private()

                .effect()
                .copySprite(target)
                .belowTokens()
                .attachTo(target)
                .scaleToObject(target.document.texture.scaleX)
                .spriteRotation(target.document.texture.rotation*-1)
                .filter('Glow', {color: tintColor, distance: 20})
                .persist()
                .fadeIn(1500, {delay :500})
                .fadeOut(1500, {ease: 'easeInSine'})
                .zIndex(0.1)
                .name('Faerie Fire')
                .play();
        }
    }
}
async function end({trigger: {entity}}) {
    let playAnimation = entity.flags['chris-premades']?.faerieFire?.playAnimation;
    let shouldAnimate = playAnimation && animationUtils.jb2aCheck() === 'patreon' && animationUtils.aseCheck();
    if (!shouldAnimate) return;
    let token = actorUtils.getFirstToken(entity.parent);
    if (!token) return;
    Sequencer.EffectManager.endEffects({name: 'Faerie Fire', object: token});
}
export let faerieFire = {
    name: 'Faerie Fire',
    version: '1.1.0',
    hasAnimation: true,
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50
            }
        ]
    },
    config: [
        {
            value: 'playAnimation',
            label: 'CHRISPREMADES.Config.PlayAnimation',
            type: 'checkbox',
            default: true,
            category: 'animation'
        },
        {
            value: 'color',
            label: 'CHRISPREMADES.Config.Color',
            type: 'select',
            default: 'blue',
            category: 'animation',
            options: [
                {
                    value: 'blue',
                    label: 'CHRISPREMADES.Config.Colors.Blue'
                },
                {
                    value: 'green',
                    label: 'CHRISPREMADES.Config.Colors.Green'
                },
                {
                    value: 'purple',
                    label: 'CHRISPREMADES.Config.Colors.Purple'
                }
            ]
        },
        {
            value: 'lightIntensity',
            label: 'CHRISPREMADES.Config.LightIntensity',
            type: 'number',
            default: 0.65,
            category: 'animation'
        }
    ]
};
export let faerieFireOutlined = {
    name: 'Faerie Fire: Outlined',
    version: faerieFire.version,
    effect: [
        {
            pass: 'deleted',
            macro: end,
            priority: 50
        }
    ]
};
