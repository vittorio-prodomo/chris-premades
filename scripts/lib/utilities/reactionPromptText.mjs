/*
 * Pure helpers for two prompt tweaks (queue T237, T238) — no Foundry imports, so they run under
 * node tests.
 */

// T238 — seconds the "cast Shield against these darts?" prompt stays open. No answer = no Shield.
export const SHIELD_PROMPT_SECONDS = 30;

// T238 — one dart reads differently from several.
export function shieldPromptKey(bolts) {
    return Number(bolts) === 1
        ? 'CHRISPREMADES.Macros.MagicMissile.ShieldPromptOne'
        : 'CHRISPREMADES.Macros.MagicMissile.ShieldPrompt';
}

// T237 — dnd5e-declared-advantage stamps `portentD20` on a roll whose d20 was replaced by a Portent
// die. That d20 was never rolled, so there is nothing for Heroic Inspiration to reroll.
export function isReplacedD20(roll) {
    return roll?.options?.portentD20 != null;
}
