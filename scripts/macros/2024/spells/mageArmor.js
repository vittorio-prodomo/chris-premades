import {genericUtils} from '../../../utils.js';

/*
 * T154 — "a willing creature who isn't wearing armor" (2024 and 2014 alike; RAW verbatim, not a
 * house rule). Nothing in the stack enforced the armor clause.
 *
 * There is no CPR pack entry for Mage Armor (the T113/T16 'willing' work lives in the Argon and
 * midi allowlists), so this is a fork-owned global gate rather than a registry macro. It hooks
 * dnd5e.preUseActivity because that is the only abort point with ZERO side effects — midi applies
 * action-economy markers and creates the chat card inside MidiActivityMixin.use() before any CPR
 * pass runs (see premade-authoring: the two broken HM-gate releases).
 *
 * Keyed on the slugified item identifier so DDB imports and compendium copies both match without
 * depending on a CPR flag they don't carry. Targeting happens before the cast on this world
 * (requiresTargets: 'always' + the Argon picker), so game.user.targets is the target surface; an
 * un-targeted use passes through and midi refuses it later on its own.
 */
Hooks.on('dnd5e.preUseActivity', activity => {
    let item = activity?.item;
    if (item?.type !== 'spell' || item.identifier !== 'mage-armor') return;
    let wearing = Array.from(game.user.targets).find(t => t.actor?.system?.attributes?.ac?.equippedArmor);
    if (!wearing) return;
    ui.notifications.warn(genericUtils.format('CHRISPREMADES.Macros.MageArmor.WearingArmor', {targetName: wearing.document.name}));
    return false;
});
