/**
 * Absolutize relative `@UUID` links in journal text copied onto an Item (T64).
 *
 * CPR builds synthetic action items by copying a rules JournalEntryPage's `text.content` verbatim
 * into `system.description.value` (generic-actions menu mode, per-item mode, and the world
 * "CPR - Descriptions" override journal). Most links survive the move: `&Reference[...]` resolves
 * through `CONFIG.DND5E.rules` from anywhere, and absolute `@UUID[...]` links carry their own path.
 *
 * A *relative* link does not. dnd5e writes sibling-page links as `@UUID[.<pageId>]{Label}` — the
 * leading dot means "resolve against the document this text lives on". Inside the journal that is
 * the page, so it finds its sibling; once the HTML sits on an Item there is no parent JournalEntry
 * left to resolve against and the link enriches as `content-link broken`. Reported on Hide's
 * "Heavily Obscured"; a sweep of the live world found 25 such links across 20 rule pages, of which
 * Hide, Ready and Knock Out are reachable from CPR's actions pack.
 *
 * Verified against v13.351: `fromUuid('.YkuKTIH2YaYW8lTS', {relative: hidePage})` returns the
 * sibling page `<journalUuid>.JournalEntryPage.YkuKTIH2YaYW8lTS`, so the rewrite below is exactly
 * equivalent to what the relative form means in its original home — not a guess at intent.
 *
 * Kept free of Foundry globals (the journal UUID is injected) so it can be unit tested under node,
 * matching the `damageTypeLabels.mjs` / `rerollNotes.mjs` precedent.
 */

/**
 * A relative link to a sibling page: a bare document id, optionally followed by a heading anchor.
 *
 * Deliberately narrow. Only the bare-id form is rewritten, because that is the only relative shape
 * that means "sibling page" — `fromUuid('.JournalEntryPage.<id>', {relative: page})` actually
 * throws ("JournalEntryPage is not a valid embedded Document within the JournalEntryPage
 * Document"), and `..`-style parent walks address something we cannot reconstruct from the journal
 * UUID alone. Those, and every absolute link, are left exactly as they are.
 */
const RELATIVE_SIBLING_LINK = /@UUID\[\.([A-Za-z0-9]+)(#[^\]]*)?\]/g;

/**
 * Rewrite relative sibling-page links so they still resolve away from their journal.
 *
 * Fails open in every direction: no content, no journal UUID, or no relative links and the input
 * comes back untouched. A link whose target is missing upstream (dnd5e's Long Rest page points at
 * a page that is not in its journal) stays broken — it was broken in the journal too, and silently
 * dropping it would hide a content bug rather than fix one.
 *
 * @param {any} content journal page HTML about to be copied onto an item
 * @param {string} [journalUuid] UUID of the page's parent JournalEntry (`page.parent?.uuid`)
 * @returns {any} the content with sibling links absolutized, or the original input
 */
export function absolutizeJournalLinks(content, journalUuid) {
    if (typeof content !== 'string' || !content.length) return content;
    if (typeof journalUuid !== 'string' || !journalUuid.length) return content;
    return content.replace(
        RELATIVE_SIBLING_LINK,
        (match, id, anchor) => `@UUID[${journalUuid}.JournalEntryPage.${id}${anchor ?? ''}]`
    );
}
