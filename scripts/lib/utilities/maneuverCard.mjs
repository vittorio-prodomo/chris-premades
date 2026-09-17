// T232: the usage card of a maneuver used as an ACTIVITY of "Maneuver Options".
// dnd5e titles the card after the ITEM and prints the item's whole description — every chosen
// maneuver's text. The card should read as the maneuver's own: its name, its icon, its rules text.
// Pure string work (the hook hands us finished HTML); no DOM, so it runs under node tests.

function normalise(text) {
    return String(text ?? '').replace(/<[^>]*>/g, '').replace(/&rsquo;|&#8217;|[’`]/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The part of the parent's description that belongs to one maneuver: what follows its `<h3>` up
 * to the next `<h3>` (or the end). The importer composes the description that way.
 * @returns {string | null} null when the maneuver has no section of its own
 */
export function maneuverSection(description, name) {
    let html = String(description ?? '');
    let wanted = normalise(name);
    if (!wanted) return null;
    let heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi;
    let match;
    while ((match = heading.exec(html))) {
        if (normalise(match[1]) !== wanted) continue;
        let start = match.index + match[0].length;
        let next = html.slice(start).search(/<h3\b/i);
        let section = (next === -1 ? html.slice(start) : html.slice(start, start + next)).trim();
        return section.length ? section : null;
    }
    return null;
}

/** Index just past the `</div>` that closes the `<div` opening at `openIndex`; -1 if unbalanced. */
function closingDivEnd(html, openIndex) {
    let tag = /<\/?div\b[^>]*>/gi;
    tag.lastIndex = openIndex;
    let depth = 0;
    let match;
    while ((match = tag.exec(html))) {
        depth += match[0][1] === '/' ? -1 : 1;
        if (depth === 0) return match.index + match[0].length;
    }
    return -1;
}

/**
 * Rewrite a dnd5e activation card for one maneuver.
 * @param {string} content           the card HTML dnd5e built
 * @param {object} p
 * @param {string} p.title           the maneuver's name — ⚠️ ALREADY HTML-ESCAPED by the caller
 * @param {string} [p.img]           the maneuver's icon
 * @param {string | null} [p.description]  the maneuver's own rules text; null keeps dnd5e's
 * @returns {string | null} null when the card does not have the expected header (left as built)
 */
export function rewriteManeuverCard(content, {title, img, description}) {
    let html = String(content ?? '');
    let titled = html.replace(/(<span class="title">)[\s\S]*?(<\/span>)/, `$1${title}$2`);
    if (titled === html && !html.includes(`<span class="title">${title}</span>`)) return null;
    html = titled;
    if (img) {
        html = html.replace(/(<img class="gold-icon" src=")[^"]*(" alt=")[^"]*(")/, `$1${img}$2${title}$3`);
    }
    if (description) {
        let open = html.search(/<div class="wrapper">/);
        if (open !== -1) {
            let end = closingDivEnd(html, open);
            if (end !== -1) html = html.slice(0, open) + `<div class="wrapper">${description}</div>` + html.slice(end);
        }
    }
    return html;
}
