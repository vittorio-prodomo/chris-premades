/**
 * Summarise which spell slots Arcane Recovery actually restored, for the chat card.
 *
 * The macro applies the recovery silently: midi's card announces that the feature was
 * used and nothing more, so the table never sees what came back. Vittorio's ask
 * (2026-09-01) is for the card to say it.
 *
 * ⚠️ The level label is INJECTED rather than read here. It comes from
 * `CONFIG.DND5E.spellLevels`, which is localized and Foundry-only; keeping it out
 * leaves this module node-testable.
 *
 * ⚠️ The label is escaped before it reaches the card. It is config-sourced rather
 * than player-authored, so this is belt-and-braces — but hand-built chat markup is
 * exactly where an unescaped interpolation becomes stored XSS, and that trap has
 * already bitten this workspace once.
 *
 * @param {object} options
 * @param {{level: number, amount: number}[]} options.recovered What was restored.
 * @param {number} options.allowed  Slot levels the feature permitted this use.
 * @param {(level: number) => string} options.label Human name for a spell level.
 * @returns {string|null} Card HTML, or null when nothing was recovered.
 */
export function arcaneRecoverySummary({recovered, allowed, label}) {
    let taken = (recovered ?? [])
        .filter((entry) => Number(entry?.amount) > 0)
        .sort((a, b) => a.level - b.level);
    if (!taken.length) return null;

    // ⚠️ `globalThis.foundry`, not bare `foundry`: an undeclared identifier throws a
    // ReferenceError that optional chaining does NOT catch, so the bare form breaks
    // every node test while looking defensive.
    let escape = globalThis.foundry?.utils?.escapeHTML ?? ((value) => `${value}`
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;'));

    let usedLevels = taken.reduce((total, entry) => total + (entry.level * entry.amount), 0);
    let parts = taken.map((entry) => `${escape(label(entry.level))} × ${entry.amount}`);

    return `<p><strong>Spell slots recovered:</strong> ${parts.join(', ')} `
        + `<em>(${usedLevels} of ${allowed} slot levels)</em></p>`;
}
