/*
 * Queue T133 — the AUTOSUCCESS display convention (T129 adoption).
 *
 * ⚠️ Verbatim copy of gambits-premades scripts/utils/autoSuccessRow.mjs — the convention is the
 * house style across forks and each fork stays dependency-free (this must work with GPS off).
 * Change BOTH copies or note the divergence.
 *
 * An auto-succeeded save row used to go green while still showing the rolled number ("11" under a
 * DC 13"). House style now: the displayed total becomes a localized AUTOSUCCESS label, the real
 * roll stays reachable in the hover breakdown (`rollHTML` is deliberately untouched), and the
 * per-target reason lands in midi's attribution tooltip.
 *
 * ⚠️ `attributionTooltip` is rendered through a triple-stash into `data-tooltip-html`
 * (midi templates/saves.html), i.e. it is stored HTML-ESCAPED — escape additions to match.
 *
 * Pure: operates on a `workflow.saveDisplayData` row object; i18n is resolved by the caller.
 */
function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#x27;');
}

export function paintAutoSuccessRow(row, {label, reason} = {}) {
    row.saveClass = 'success';
    row.saveSymbol = (row.saveSymbol ?? '').replace('fa-xmark', 'fa-check');
    if (label !== undefined) row.rollTotal = label;
    if (reason !== undefined) {
        const escaped = escapeHtml(reason);
        // T129/T174 dedup: with forced saves, midi's attribution tooltip already carries the
        // reason as the succeed() display name (the green AutoSuccess row) — appending it again
        // showed the sentence twice. Never append text the tooltip already contains; the append
        // remains for the belt paths where no attribution was recorded.
        if (!row.attributionTooltip?.includes(escaped)) {
            row.attributionTooltip = row.attributionTooltip ? `${row.attributionTooltip}<br>${escaped}` : escaped;
            row.hasAttribution = true;
        }
    }
    return row;
}
