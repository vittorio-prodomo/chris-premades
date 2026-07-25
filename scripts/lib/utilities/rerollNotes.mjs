/**
 * Pure helpers for reroll attribution notes (T51).
 *
 * A "note" records that some feature rerolled part of a roll, and what it cost or gained:
 *   {source: 'Savage Attacker', before: 7, after: 9}
 *
 * These are stored as an array on the midi chat card so several rerollers touching one roll
 * each get their own line. Kept free of Foundry globals so they can be unit tested under node.
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
 * Append a reroll note to a history array, returning a NEW array.
 * Invalid notes and exact duplicates are ignored.
 * @param {object[]|undefined} existing
 * @param {{source: string, before: number|string, after: number|string}} note
 * @returns {object[]}
 */
export function appendRerollNote(existing, note) {
    const history = Array.isArray(existing) ? [...existing] : [];
    if (!note || typeof note.source !== 'string' || !note.source.length) return history;
    if (!isReading(note.before) || !isReading(note.after)) return history;
    const candidate = {source: note.source, before: note.before, after: note.after};
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
 * Substitute a note into a localised template containing {source}, {before} and {after}.
 * @param {string} template
 * @param {object} note
 * @returns {string}
 */
export function formatRerollNote(template, note) {
    return String(template)
        .replaceAll('{source}', String(note?.source ?? ''))
        .replaceAll('{before}', String(note?.before ?? ''))
        .replaceAll('{after}', String(note?.after ?? ''));
}
