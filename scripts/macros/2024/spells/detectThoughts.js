import {activityUtils, effectUtils, genericUtils, itemUtils} from '../../../utils.js';
import {detectThoughtsLate, detectThoughtsEarly} from '../../2014/spells/detectThoughts.js';

/*
 * 2024 port (queue T123). The spell was RESTRUCTURED, so unlike most modern ports this is not a
 * bare re-export of the legacy passes:
 *
 *   - 2014 hid "Probe Deeper" until the spell was cast, and the legacy `use` pass unhid and
 *     favourited it. 2024 says "You activate one of the effects below. Until the spell ends, you
 *     can activate either effect as a Magic action on your later turns" — both modes are co-equal
 *     and the official item hides neither, so `unhideActivities` is dropped and the packData entry
 *     declares no `hiddenActivities`.
 *   - The opener is renamed "Sense Thoughts". The CPR identifier stays `detectThoughts` (that is
 *     what the registry and this macro key on); packData maps it to the 2024 activity id.
 *   - Either mode can open the spell, so `use` is registered on BOTH and made idempotent. The
 *     legacy version could assume the cast came first.
 *
 * Unchanged and re-exported verbatim: `late` (a successful Probe Deeper save ends the spell — 2024
 * still says "On a successful save, the spell ends") and `early` (suppress the usage dialog).
 *
 * ⚠️ NOT automated, and deliberately so: 2024 adds "the target can take an action on its turn to
 * make an Intelligence (Arcana) check against your spell save DC, ending the spell on a success".
 * That is a target-side recurring option with no 2014 counterpart — its own item of work.
 */
async function use({workflow}) {
    // Idempotent: whichever mode opened the spell creates the effect, the other must not double it.
    if (effectUtils.getEffectByIdentifier(workflow.actor, 'detectThoughts')) return;
    let concentrationEffect = await effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    let probe = activityUtils.getActivityByIdentifier(workflow.item, 'probeDeeper');
    let effectData = {
        name: workflow.item.name,
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: itemUtils.convertDuration(workflow.item)
    };
    await effectUtils.createEffect(workflow.actor, effectData, {
        concentrationItem: workflow.item,
        strictlyInterdependent: true,
        identifier: 'detectThoughts',
        // The button is the whole point of the effect now that nothing needs unhiding: it puts
        // Probe Deeper one click away for as long as the spell is sustained.
        vae: probe ? [{
            type: 'use',
            name: probe.name,
            identifier: 'detectThoughts',
            activityIdentifier: 'probeDeeper'
        }] : []
    });
    if (concentrationEffect) await genericUtils.update(concentrationEffect, {duration: effectData.duration});
}
export let detectThoughts = {
    name: 'Detect Thoughts',
    version: '1.2.28',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['detectThoughts', 'probeDeeper']
            },
            {
                pass: 'rollFinished',
                macro: detectThoughtsLate,
                priority: 50,
                activities: ['probeDeeper']
            },
            {
                pass: 'preTargeting',
                macro: detectThoughtsEarly,
                priority: 50,
                activities: ['probeDeeper']
            }
        ]
    }
};
