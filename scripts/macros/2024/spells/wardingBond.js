import {wardingBondUse, wardingBondDismissUse, wardingBondDismissEarly} from '../../2014/spells/wardingBond.js';

/*
 * 2024 registration (fixed as queue T124). Upstream's 2024 copy was the 2014 `use` with the
 * Dismiss wiring dropped — the pack entry had lost the "Warding Bond: Dismiss" activity while its
 * own activityIdentifiers/hiddenActivities/spellActivities still declared it, so the caster effect
 * shipped with no way to end the 1-hour bond early. The activity is restored in packData from the
 * 2014 donor (same id), and the passes are reused BY REFERENCE from the legacy file (minified
 * bundle — named exports, never `macro.name` or `midi.item[n]`): `use` recreates the vae button +
 * unhide-on-cast block verbatim, `dismiss` removes the source effect (its interdependents follow),
 * `early` suppresses the usage dialog on the dismiss.
 */
export let wardingBond = {
    name: 'Warding Bond',
    version: '1.2.30',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: wardingBondUse,
                priority: 50,
                activities: ['wardingBond']
            },
            {
                pass: 'rollFinished',
                macro: wardingBondDismissUse,
                priority: 50,
                activities: ['wardingBondDismiss']
            },
            {
                pass: 'preTargeting',
                macro: wardingBondDismissEarly,
                priority: 50,
                activities: ['wardingBondDismiss']
            }
        ]
    },
    config: [
        {
            value: 'maxDistance',
            label: 'CHRISPREMADES.Macros.WardingBond.MaxDistance',
            type: 'text',
            default: 60,
            category: 'homebrew',
            homebrew: true
        }
    ]
};
