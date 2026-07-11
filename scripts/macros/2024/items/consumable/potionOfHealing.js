import {activityUtils, dialogUtils, genericUtils, tokenUtils} from '../../../../utils.js';
// RAW 2024: a Potion of Healing is drunk or administered to a creature within 5 feet, as a
// Bonus Action. The cpr-items-2024 pack models that as ONE heal activity affecting 1 creature
// at 5ft range; this gate makes every use path (sheet, Argon HUD, VAE, macro) pick the
// recipient explicitly — Argon's on-canvas "0/1 targets" picker when available, a list dialog
// otherwise — so a stale pre-selected target can never receive the potion by accident. The
// pack items also carry flags.enhancedcombathud.skipTargetPicker so Argon's HUD doesn't run
// its own native picker first (which would double-prompt).
// Gated on dnd5e's preUseActivity: cancelling the pick aborts BEFORE the usage card, the
// charge consumption, and MidiQoL's action-economy bookkeeping (setBonusActionUsed runs inside
// MidiActivityMixin.use() even for workflows aborted later — same landmine as Hunter's Mark
// move, see huntersMark.js).
Hooks.on('dnd5e.preUseActivity', (activity, usageConfig) => {
    if (activityUtils.getIdentifier(activity) !== 'potionOfHealingHeal') return;
    if (usageConfig?.chrisPremades?.potionRecipientPicked) return;
    let actor = activity.item?.actor;
    let token = actor?.token?.object ?? actor?.getActiveTokens?.()[0];
    if (!token) return; // no canvas token to aim the picker from: keep vanilla behavior
    (async () => {
        // Fresh pick every use: release anything already targeted.
        Array.from(game.user.targets).forEach(t => t.setTarget(false, {releaseOthers: false, groupSelection: true}));
        let range = Number(activity.range?.value) || 5;
        let recipient;
        let argonApi = game.modules.get('enhancedcombathud')?.active ? game.modules.get('enhancedcombathud').api : undefined;
        if (typeof argonApi?.runTargetPicker === 'function') {
            let picked = await argonApi.runTargetPicker({token, targets: 1, ranges: {normal: range, long: null}, item: activity.item});
            if (!picked) return; // picker cancelled: clean abort, nothing consumed
            recipient = game.user.targets.first();
        } else {
            let candidates = tokenUtils.findNearby(token, range, null, {includeIncapacitated: true, includeToken: true});
            let selection = await dialogUtils.selectTargetDialog(activity.item.name, 'CHRISPREMADES.Macros.PotionOfHealing.Select', candidates, {skipDeadAndUnconscious: false});
            if (!selection) return;
            recipient = selection[0];
        }
        if (!recipient) return;
        recipient.setTarget?.(true, {releaseOthers: true});
        await activity.use(genericUtils.mergeObject(usageConfig ?? {}, {chrisPremades: {potionRecipientPicked: true}}, {inplace: false}), {configure: false}, {});
    })();
    return false;
});
export let potionOfHealing = {
    name: 'Potion of Healing',
    version: '1.0.0',
    rules: 'modern'
};
export let potionOfHealingGreater = {
    name: 'Potion of Healing (Greater)',
    version: '1.0.0',
    rules: 'modern'
};
export let potionOfHealingSuperior = {
    name: 'Potion of Healing (Superior)',
    version: '1.0.0',
    rules: 'modern'
};
export let potionOfHealingSupreme = {
    name: 'Potion of Healing (Supreme)',
    version: '1.0.0',
    rules: 'modern'
};
