import {genericUtils, tokenUtils} from '../../../utils.js';
import {ensnaringStrike} from './ensnaringStrike.js';

// Fork addition. RAW: the hit creature and each creature within 5 feet of it make
// the DEX save — allies included. Expand the workflow targets before rolls happen;
// midi's save phase re-reads user targets for non-attack activities.
async function early({trigger, workflow}) {
    let primary = workflow.targets.first();
    if (!primary) return;
    let burst = tokenUtils.findNearby(primary, 5, 'any', {includeIncapacitated: true, includeToken: true});
    if (!burst.includes(primary)) burst.push(primary);
    await genericUtils.updateTargets(burst);
}
export let hailOfThorns = {
    name: 'Hail of Thorns',
    version: '1.0.0',
    rules: 'modern',
    midi: {
        actor: ensnaringStrike.midi.actor,
        item: [
            {
                pass: 'preItemRoll',
                macro: early,
                priority: 50
            }
        ]
    },
    ddbi: {
        correctedItems: {
            'Hail of Thorns': {
                system: {
                    range: {units: 'spec', special: 'The creature you just hit with a ranged weapon attack', value: null}
                }
            }
        }
    }
};
