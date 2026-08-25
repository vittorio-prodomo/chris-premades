import {activityUtils, actorUtils, effectUtils, genericUtils, itemUtils} from '../../../utils.js';
import {detectThoughtsLate, detectThoughtsEarly} from '../../2014/spells/detectThoughts.js';

/*
 * 2024 port (queue T123, activity model corrected at the reopen 2026-08-24). The official text has
 * THREE modes, and they are not co-equal:
 *
 *   - Sense Thoughts and Read Thoughts are the two effects of the spell — "You activate one of the
 *     effects below" at cast, and "you can activate either effect as a Magic action on your later
 *     turns". Either can open the spell, so `use` is registered on BOTH and is idempotent.
 *   - Probe Deeper is only legal against a target currently being read ("As a Magic action on your
 *     next turn, you can try to probe deeper"). The 08-03 port left it visible in the cast-time
 *     midi picker, where it could be the first action ever taken on the spell — caught at the
 *     table. It is now hidden in packData (`hiddenActivities`) and unlocked by a read: opened-by-
 *     Read rides the createActiveEffect hook (the effect carries `unhideActivities`), opened-by-
 *     Sense-then-read stamps the same flag and unhides by hand. Either way deleteActiveEffect
 *     rehides + un-favourites at spell end — the Witch Bolt sustain model.
 *   - A later-turn Sense/Read is a Magic action on a spell cast ONCE, not a recast: while the
 *     detectThoughts effect is up, `sustain` suppresses the usage dialog and consumes nothing
 *     (the faerie fire / magic missile `consume = false` idiom). Probe Deeper's own activity is
 *     spellSlot:false in packData, since it can never be the cast.
 *
 * Unchanged and re-exported verbatim: `late` (a successful Probe Deeper save ends the spell — 2024
 * still says "On a successful save, the spell ends") and `early` (suppress the usage dialog).
 *
 * ⚠️ NOT automated, and deliberately so: 2024 adds "the target can take an action on its turn to
 * make an Intelligence (Arcana) check against your spell save DC, ending the spell on a success".
 * That is a target-side recurring option with no 2014 counterpart — its own item of work.
 */
function probeUnhideFlags(item) {
    return {
        itemUuid: item.uuid,
        activityIdentifiers: ['probeDeeper'],
        favorite: true
    };
}
function probeVaeButton(probe) {
    return {
        type: 'use',
        name: probe.name,
        identifier: 'detectThoughts',
        activityIdentifier: 'probeDeeper'
    };
}
// The Sense-first path: the effect exists without the unhide flag, so do by hand what the
// createActiveEffect hook does for an opened-by-Read effect — and stamp the flag itself, so the
// deleteActiveEffect hook rehides and un-favourites at spell end exactly as in the other path.
async function enableProbe(effect, workflow) {
    if (effect.flags['chris-premades']?.unhideActivities) return;
    let probe = activityUtils.getActivityByIdentifier(workflow.item, 'probeDeeper');
    if (!probe) return;
    await genericUtils.update(effect, {
        'flags.chris-premades.unhideActivities': probeUnhideFlags(workflow.item),
        'flags.chris-premades.vae.buttons': [probeVaeButton(probe)]
    });
    let hidden = itemUtils.getHiddenActivities(workflow.item) ?? [];
    await itemUtils.setHiddenActivities(workflow.item, hidden.filter(i => i !== 'probeDeeper'));
    await actorUtils.addFavorites(workflow.actor, [probe]);
}
async function use({workflow}) {
    let isRead = activityUtils.getIdentifier(workflow.activity) === 'readThoughts';
    // Idempotent: whichever mode opened the spell creates the effect, the other must not double it.
    let existing = effectUtils.getEffectByIdentifier(workflow.actor, 'detectThoughts');
    if (existing) {
        if (isRead) await enableProbe(existing, workflow);
        return;
    }
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
        // Probe Deeper is unlocked by a read, not by the cast: only an opened-by-Read effect
        // carries the unhide flag and the one-click button from the start.
        unhideActivities: isRead && probe ? probeUnhideFlags(workflow.item) : undefined,
        vae: isRead && probe ? [probeVaeButton(probe)] : []
    });
    if (concentrationEffect) await genericUtils.update(concentrationEffect, {duration: effectData.duration});
}
// While the spell is up, a later-turn Sense/Read is a free Magic action, not a recast.
// ⚠️ preTargeting passes get {activity, actor, config, dialog…} — no workflow exists yet.
async function sustain({actor, config, dialog}) {
    if (!effectUtils.getEffectByIdentifier(actor, 'detectThoughts')) return;
    config.consume = false;
    dialog.configure = false;
}
export let detectThoughts = {
    name: 'Detect Thoughts',
    version: '1.3.0',
    rules: 'modern',
    midi: {
        item: [
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50,
                activities: ['detectThoughts', 'readThoughts']
            },
            {
                pass: 'preTargeting',
                macro: sustain,
                priority: 50,
                activities: ['detectThoughts', 'readThoughts']
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
