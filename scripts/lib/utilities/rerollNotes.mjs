/**
 * Pure helpers for roll attribution notes (T51).
 *
 * A "note" records that some feature CHANGED a roll, and what it cost or gained. Two kinds:
 *
 *   reroll (default)  {source: 'Savage Attacker', before: 7, after: 9}
 *   superiorityDie    {source: 'Maneuvers: Riposte', kind: 'superiorityDie', die: 'd8', total: 5}
 *
 * These are stored as an array on the midi chat card so several features touching one roll each
 * get their own line. Kept free of Foundry globals so they can be unit tested under node.
 *
 * ⚠️ The stored flag is still called `rerollNotes` even though it now carries both kinds —
 * renaming it would orphan the notes on every chat card already in a world's log.
 */

/**
 * True when a value is usable as a before/after reading.
 * @param {any} value
 * @returns {boolean}
 */
function isReading(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    return typeof value === 'string' && value.length > 0;
}

/**
 * Append a note to a history array, returning a NEW array.
 * Invalid notes and exact duplicates are ignored.
 * @param {object[]|undefined} existing
 * @param {{source: string, kind?: string, before?: number|string, after?: number|string,
 *          die?: string, total?: number|string}} note
 * @returns {object[]}
 */
export function appendRerollNote(existing, note) {
    const history = Array.isArray(existing) ? [...existing] : [];
    if (!note || typeof note.source !== 'string' || !note.source.length) return history;
    /*
     * A superiority die is ADDED to the roll rather than rerolled, so it carries no before/after
     * reading — it needs its own shape and its own line. This is the note that explains where the
     * extra die on a maneuver's damage came from (T93 follow-up); without it the card shows a
     * mystery die, which is exactly the confusion that prompted it.
     */
    if (note.kind === 'superiorityDie') {
        if (!isReading(note.die) || !isReading(note.total)) return history;
        const candidate = {source: note.source, kind: 'superiorityDie', die: note.die, total: note.total};
        const isDuplicateDie = history.some(entry =>
            entry?.kind === 'superiorityDie' &&
            entry?.source === candidate.source &&
            entry?.die === candidate.die &&
            entry?.total === candidate.total
        );
        if (isDuplicateDie) return history;
        history.push(candidate);
        return history;
    }
    if (!isReading(note.before) || !isReading(note.after)) return history;
    const candidate = {source: note.source, before: note.before, after: note.after};
    // `forced` distinguishes a reroll you had no choice about (Piercer, Heroic Inspiration:
    // "must use the new roll") from one where you kept the better result (Savage Attacker).
    // The renderer picks a different wording for each -- saying "kept 1" after rerolling a 2
    // is accurate but reads like a bug.
    if (note.forced) candidate.forced = true;
    const isDuplicate = history.some(entry =>
        entry?.source === candidate.source &&
        entry?.before === candidate.before &&
        entry?.after === candidate.after
    );
    if (isDuplicate) return history;
    history.push(candidate);
    return history;
}

/**
 * Substitute a note into a localised template containing {source}, {before}, {after},
 * {die} or {total}.
 * A single regex pass, not chained String#replaceAll calls: chaining would let one
 * substitution's output be re-matched by the next placeholder (an item literally named
 * "{after}" getting re-substituted) and would treat the replacement VALUE as a pattern
 * (a `$&` in an item name is a live back-reference to replaceAll, even for a plain-string
 * search) — both cosmetic-garbling bugs, since Foundry item names are user-editable.
 * @param {string} template
 * @param {object} note
 * @returns {string}
 */
export function formatRerollNote(template, note) {
    return String(template).replace(/\{(source|before|after|die|total)\}/g, (_, key) => String(note?.[key] ?? ''));
}

/**
 * Escape text destined for an HTML string.
 * Local rather than foundry.utils.escapeHTML so this module stays free of Foundry globals
 * (it is unit tested under plain node). `&` must go first or the later entities double-escape.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Build the hover-tooltip markup that carries the reroll notes (T52).
 *
 * Deliberately mirrors MidiQoL's own attribution tooltip (`templates/attribution-tooltip.html`)
 * class for class, so midi's already-loaded CSS styles it and the ⓘ beside the DAMAGE title
 * looks native next to the one dnd5e/midi put beside ADVANTAGE on the attack title.
 *
 * ⚠️ The result is handed to Foundry as `data-tooltip-html`, so it IS parsed as HTML — every
 * interpolated value must be escaped. Note sources are in-world item names, which are
 * user-editable.
 *
 * @param {string} title heading for the tooltip; omitted when empty
 * @param {string[]} lines already-localised, already-formatted note lines
 * @returns {string} tooltip HTML, or '' when there is nothing to show
 */
export function buildRerollTooltip(title, lines) {
    const items = (Array.isArray(lines) ? lines : []).filter(line => typeof line === 'string' && line.length);
    if (!items.length) return '';
    const header = typeof title === 'string' && title.length ? `<div class="attribution-header">${escapeHtml(title)}</div>` : '';
    const body = items.map(line => `<li class="attribution-item"><span class="attribution-source">${escapeHtml(line)}</span></li>`).join('');
    return `<div class="midi-attribution-tooltip">${header}<ul class="attribution-list">${body}</ul></div>`;
}
