import {rollUtils} from '../../utils.js';
export async function explodingHeals(workflow) {
    if (!workflow.damageRolls) return;
    let damageRolls = await Promise.all(workflow.damageRolls.map(async roll => {
        if (roll.options.type != 'healing') return roll;
        const newFormula = rollUtils.buildModifierFormula(roll.terms, 'x', 'Exploding Heals');
        let evaluateOptions = {};
        if (workflow['chris-premades']?.maxHeal) evaluateOptions = {maximize: true};
        return await rollUtils.damageRoll(newFormula, workflow.activity, roll.options, evaluateOptions);
    }));
    await workflow.setDamageRolls(damageRolls);
}