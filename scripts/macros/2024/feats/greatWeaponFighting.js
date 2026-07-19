import {actorUtils, constants, effectUtils, genericUtils, itemUtils, rollUtils} from '../../../utils.js';
async function damage({trigger: {entity: item}, workflow}) {
    if (!workflow.damageRolls || !workflow.actor || workflow.attackMode !== 'twoHanded' || !constants.meleeWeaponTypes.includes(workflow.item?.system?.type?.value)) return;
    const requiredProperties = new Set(['ver', 'two']);
    if (!workflow.item.system.properties.intersection(requiredProperties).size) return;
    await rollUtils.rerollDamageWithSource(workflow, {modifier: 'min3', source: 'Great Weapon Fighting'});
}

export let greatWeaponFighting = {
    name: 'Great Weapon Fighting',
    version: '1.2.36',
    rules: 'modern',
    midi: {
        actor: [
            {
                pass: 'damageRollComplete',
                macro: damage,
                priority: 320
            }
        ]
    }
};