import {actorUtils, animationUtils, dialogUtils, effectUtils, genericUtils, itemUtils, socketUtils, tokenUtils} from '../../../utils.js';
import {classifyWillingTarget, resolveNewSize} from '../../../lib/utilities/enlargeReduceRules.mjs';
// T218 (fork, Vittorio's design): the caster picks Enlarge vs Reduce BEFORE the save, and a friendly
// target's owner is offered to accept the spell (RAW: only an unwilling target makes the save).
async function selectMode(workflow) {
    let titanStone = workflow.item.flags['chris-premades']?.titanStone;
    if (titanStone) return 'enlarge';
    return await dialogUtils.buttonDialog(workflow.item.name, 'CHRISPREMADES.Macros.EnlargeReduce.Select', [['CHRISPREMADES.Macros.EnlargeReduce.Enlarge', 'enlarge'], ['CHRISPREMADES.Macros.EnlargeReduce.Reduce', 'reduce']]);
}
async function early({workflow}) {
    if (!workflow.targets.size) return;
    let selection = await selectMode(workflow);
    if (!selection) {
        // Dismissed: the cast fizzles here instead of after the save — no roll, no concentration.
        await genericUtils.remove(effectUtils.getConcentrationEffect(workflow.actor, workflow.item));
        workflow.aborted = true;
        return;
    }
    genericUtils.setProperty(workflow, 'chris-premades.enlargeReduce.selection', selection);
    let selectionLabel = genericUtils.translate(selection === 'enlarge' ? 'CHRISPREMADES.Macros.EnlargeReduce.Enlarge' : 'CHRISPREMADES.Macros.EnlargeReduce.Reduce');
    let casterName = workflow.token?.name ?? workflow.actor.name;
    for (let targetToken of workflow.targets) {
        if (!targetToken.actor) continue;
        let kind = classifyWillingTarget({disposition: targetToken.document.disposition, friendly: CONST.TOKEN_DISPOSITIONS.FRIENDLY, isCaster: targetToken.actor.uuid === workflow.actor.uuid});
        if (kind === 'other') continue;
        let willing = true;
        if (kind === 'friendly') {
            let content = genericUtils.format('CHRISPREMADES.Macros.EnlargeReduce.WillingPrompt', {casterName, spellName: workflow.item.name, selection: selectionLabel, targetName: targetToken.name});
            let answer = await dialogUtils.buttonDialog(workflow.item.name, content, [['CHRISPREMADES.Macros.EnlargeReduce.WillingYes', 'willing'], ['CHRISPREMADES.Macros.EnlargeReduce.WillingNo', 'unwilling']], {userId: socketUtils.firstOwner(targetToken.actor, true), timeout: 60});
            willing = answer === 'willing';
        }
        if (!willing) continue;
        // Same shape as blight's plant auto-fail: one save, then gone.
        let effectData = {
            name: workflow.item.name + ': ' + genericUtils.translate('CHRISPREMADES.Macros.EnlargeReduce.WillingEffect'),
            img: workflow.item.img,
            origin: workflow.item.uuid,
            duration: {
                seconds: 1
            },
            changes: [
                {
                    key: 'flags.midi-qol.fail.ability.save.all',
                    value: 1,
                    mode: 0,
                    priority: 20
                }
            ],
            flags: {
                dae: {
                    specialDuration: [
                        'isSave'
                    ]
                },
                'chris-premades': {
                    effect: {
                        noAnimation: true
                    }
                }
            }
        };
        await effectUtils.createEffect(targetToken.actor, effectData, {animate: false});
    }
}
async function use({workflow}) {
    let concentrationEffect = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    if (!workflow.failedSaves.size) {
        await genericUtils.remove(concentrationEffect);
        return;
    }
    let playAnimation = itemUtils.getConfig(workflow.item, 'playAnimation');
    let titanStone = workflow.item.flags['chris-premades']?.titanStone;
    // Chosen at preambleComplete (T218); the prompt here is only a fallback for a workflow the early pass never saw.
    let selection = genericUtils.getProperty(workflow, 'chris-premades.enlargeReduce.selection') ?? await selectMode(workflow);
    if (!selection) {
        await genericUtils.remove(concentrationEffect);
        return;
    }
    if (selection === 'enlarge') {
        let effectData = {
            name: workflow.item.name,
            img: workflow.item.img,
            origin: workflow.item.uuid,
            duration: itemUtils.convertDuration(workflow.item),
            changes: [
                {
                    key: 'system.bonuses.mwak.damage',
                    mode: 2,
                    value: '+1d4',
                    priority: 20
                },
                {
                    key: 'system.bonuses.rwak.damage',
                    mode: 2,
                    value: '+1d4',
                    priority: 20
                },
                {
                    key: 'flags.midi-qol.advantage.check.str',
                    mode: 0,
                    value: 1,
                    priority: 20
                },
                {
                    key: 'flags.midi-qol.advantage.save.str',
                    mode: 0,
                    value: 1,
                    priority: 20
                }
            ], 
            flags: {
                'chris-premades': {
                    enlargeReduce: {
                        selection,
                        playAnimation
                    },
                    effect: {
                        sizeAnimation: false
                    }
                }
            }
        };
        if (titanStone === 2) {
            effectData.changes = effectData.changes.concat([
                {
                    key: 'system.traits.dr.value',
                    mode: 2,
                    priority: 20,
                    value: 'cold'
                },
                {
                    key: 'system.traits.dr.value',
                    mode: 2,
                    priority: 20,
                    value: 'fire'
                },
                {
                    key: 'system.traits.dr.value',
                    mode: 2,
                    priority: 20,
                    value: 'lightning'
                },
                {
                    key: 'system.traits.dr.value',
                    mode: 2,
                    priority: 20,
                    value: 'thunder'
                }
            ]);
        }
        effectUtils.addMacro(effectData, 'effect', ['enlargeReduceChanged']);
        for (let targetToken of workflow.failedSaves) {
            let currEffectData = genericUtils.duplicate(effectData);
            let targetSize = targetToken.actor.system.traits.size;
            let hasRoom = true;
            if (targetSize !== 'tiny' && targetSize !== 'sm') {
                let room = tokenUtils.checkForRoom(targetToken, 1);
                hasRoom = tokenUtils.findDirection(room) !== 'none';
            }
            let newSize = resolveNewSize({selection, size: targetSize, hasRoom});
            currEffectData.flags['chris-premades'].enlargeReduce.origSize = targetSize;
            currEffectData.flags['chris-premades'].enlargeReduce.newSize = newSize;
            await effectUtils.createEffect(targetToken.actor, currEffectData, {concentrationItem: workflow.item, interdependent: true, identifier: 'enlargeReduceChanged'});
        }
    } else {
        let effectData = {
            name: workflow.item.name,
            img: workflow.item.img,
            origin: workflow.item.uuid,
            duration: itemUtils.convertDuration(workflow.item),
            changes: [
                {
                    key: 'system.bonuses.mwak.damage',
                    mode: 2,
                    value: '-1d4',
                    priority: 20
                },
                {
                    key: 'system.bonuses.rwak.damage',
                    mode: 2,
                    value: '-1d4',
                    priority: 20
                },
                {
                    key: 'flags.midi-qol.disadvantage.check.str',
                    mode: 0,
                    value: 1,
                    priority: 20
                },
                {
                    key: 'flags.midi-qol.disadvantage.save.str',
                    mode: 0,
                    value: 1,
                    priority: 20
                }
            ], 
            flags: {
                'chris-premades': {
                    enlargeReduce: {
                        selection,
                        playAnimation
                    },
                    effect: {
                        sizeAnimation: false
                    }
                }
            }
        };
        effectUtils.addMacro(effectData, 'effect', ['enlargeReduceChanged']);
        for (let targetToken of workflow.failedSaves) {
            let currEffectData = genericUtils.duplicate(effectData);
            let targetSize = targetToken.actor.system.traits.size;
            let newSize = resolveNewSize({selection, size: targetSize});
            currEffectData.flags['chris-premades'].enlargeReduce.origSize = targetSize;
            currEffectData.flags['chris-premades'].enlargeReduce.newSize = newSize;
            await effectUtils.createEffect(targetToken.actor, currEffectData, {concentrationItem: workflow.item, interdependent: true, identifier: 'enlargeReduceChanged'});
        }
    }
}
export async function start({trigger: {entity: effect}}) {
    let {selection, playAnimation, origSize, newSize} = effect.flags['chris-premades'].enlargeReduce;
    let token = actorUtils.getFirstToken(effect.parent);
    if (!token) return;
    if (!playAnimation || animationUtils.jb2aCheck() !== 'patreon') {
        let updates = {
            changes: effect.changes.concat(
                {
                    key: 'system.traits.size',
                    mode: 5,
                    value: newSize,
                    priority: 20
                }
            ),
            'flags.chris-premades.effect.sizeAnimation': true
        };
        await genericUtils.update(effect, updates);
        return;
    }
    // Animations by: eskiemoh
    if (selection === 'enlarge') {
        let scale = 1;
        switch (origSize) {
            case 'sm':
                scale = 0.8;
                break;
            case 'tiny':
                scale = 0.5;
                break;
        }
        await new Sequence()
            .effect()
            .file('jb2a.static_electricity.03.orange')
            .atLocation(token)
            .duration(3000)
            .scaleToObject(1)
            .fadeIn(250)
            .fadeOut(250)
            .zIndex(2)
            
            .effect()
            .copySprite(token)
            .atLocation(token)
            .scaleToObject(2)
            .duration(500)
            .scaleIn(0.25,500)
            .fadeIn(250)
            .fadeOut(250)
            .repeats(3, 500, 500)
            .opacity(0.2)
            .zIndex(1)
            
            .animation()
            .on(token)
            .opacity(0)
            
            .effect()
            .copySprite(token)
            .atLocation(token)
            .loopProperty('sprite', 'position.x', {from: -40, to: 40, duration: 75, pingPong: true, delay: 200})
            .scaleToObject(scale)
            .duration(2000)
            .waitUntilFinished(-200)
            .zIndex(0)
            
            .thenDo(async () => {
                let updates = {
                    changes: effect.changes.concat(
                        {
                            key: 'system.traits.size',
                            mode: 5,
                            value: newSize,
                            priority: 20
                        }
                    )
                };
                await genericUtils.update(effect, updates);
                let updates2 = {
                    'flags.chris-premades.effect.sizeAnimation': true
                };
                await genericUtils.update(effect, updates2);
            })
            
            .wait(200)
            
            .effect()
            .copySprite(token)
            .atLocation(token)
            .scaleToObject(1)
            .duration(3000)
            .scaleIn(0.25,700, {ease: 'easeOutBounce'})
            
            .effect()
            .file('jb2a.extras.tmfx.outpulse.circle.01.fast')
            .atLocation(token)
            .belowTokens()
            .opacity(0.75)
            .scaleToObject(2)
            .zIndex(1)
            
            .effect()
            .file('jb2a.impact.ground_crack.orange.02')
            .atLocation(token)
            .belowTokens()
            .scaleToObject(2)
            .zIndex(0)
            
            .effect()
            .file('jb2a.particles.outward.orange.01.04')
            .scaleIn(0.25, 500, {ease: 'easeOutQuint'})
            .fadeIn(500)
            .fadeOut(1000)
            .atLocation(token)
            .randomRotation()
            .duration(3000)
            .scaleToObject(1.5)
            .zIndex(4)
            
            .effect()
            .file('jb2a.static_electricity.03.orange')
            .atLocation(token)
            .duration(5000)
            .scaleToObject(1)
            .fadeIn(250)
            .fadeOut(250)
            .waitUntilFinished(-3000)
            
            .animation()
            .on(token)
            .opacity(1)
            
            .play();
    } else {
        let scale = 1;
        switch (origSize) {
            case 'med':
                scale = 0.8;
                break;
            case 'sm':
                scale = 0.5;
                break;
            case 'tiny':
                scale = 0.25;
                break;
        }
        await new Sequence()
            .effect()
            .file('jb2a.static_electricity.03.orange')
            .atLocation(token)
            .duration(3000)
            .scaleToObject(1)
            .fadeIn(250)
            .fadeOut(250)
            .zIndex(2)

            .effect()
            .copySprite(token)
            .atLocation(token)
            .scaleToObject(2)
            .duration(500)
            .scaleIn(0.25,500)
            .fadeIn(250)
            .fadeOut(250)
            .repeats(3, 500, 500)
            .opacity(0.2)
            .zIndex(1)

            .animation()
            .on(token)
            .opacity(0)

            .effect()
            .copySprite(token)
            .atLocation(token)
            .loopProperty('sprite', 'rotation', {from: -10, to: 10, duration: 75, pingPong: true, delay: 200})
            .duration(2000)
            .waitUntilFinished(-200)
            .zIndex(0)

            .thenDo(async () => {
                let updates = {
                    changes: effect.changes.concat(
                        {
                            key: 'system.traits.size',
                            mode: 5,
                            value: newSize,
                            priority: 20
                        }
                    )
                };
                await genericUtils.update(effect, updates);
                let updates2 = {
                    'flags.chris-premades.effect.sizeAnimation': true
                };
                await genericUtils.update(effect, updates2);
            })

            .wait(200)

            .effect()
            .copySprite(token)
            .atLocation(token)
            .scaleToObject(scale)
            .duration(3000)
            .scaleIn(0.25, 700, {ease: 'easeOutBounce'})

            .effect()
            .file('jb2a.extras.tmfx.outpulse.circle.01.fast')
            .atLocation(token)
            .opacity(0.75)
            .scaleToObject(2)
            .zIndex(1)

            .effect()
            .file('jb2a.energy_strands.in.yellow.01.2')
            .atLocation(token)
            .belowTokens()
            .scaleToObject(2)
            .zIndex(0)

            .effect()
            .file('jb2a.particles.outward.orange.01.04')
            .scaleIn(0.25, 500, {ease: 'easeOutQuint'})
            .fadeIn(500)
            .fadeOut(1000)
            .atLocation(token)
            .randomRotation()
            .duration(3000)
            .scaleToObject(1.5)
            .zIndex(4)

            .effect()
            .file('jb2a.static_electricity.03.orange')
            .atLocation(token)
            .duration(5000)
            .scaleToObject(1)
            .fadeIn(250)
            .fadeOut(250)
            .waitUntilFinished(-3000)

            .animation()
            .on(token)
            .opacity(1)

            .play();
    }
}
export let enlargeReduce = {
    name: 'Enlarge/Reduce',
    version: '1.1.0',
    hasAnimation: true,
    midi: {
        item: [
            {
                pass: 'preambleComplete',
                macro: early,
                priority: 50
            },
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
        }
    ],
    requirements: {
        settings: [
            'syncActorSizeToTokens'
        ]
    }
};
export let enlargeReduceChanged = {
    name: 'Enlarge/Reduce: Changed',
    version: enlargeReduce.version,
    effect: [
        {
            pass: 'created',
            macro: start,
            priority: 50
        }
    ]
};