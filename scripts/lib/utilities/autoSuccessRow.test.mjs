import test from 'node:test';
import assert from 'node:assert/strict';
import {paintAutoSuccessRow} from './autoSuccessRow.mjs';

/*
 * Queue T133: an auto-succeeded save row went green but still showed the rolled number ("11" under
 * a DC 13 — correct and ugly, his words). The house convention is now: the row's displayed total
 * becomes a localized AUTOSUCCESS label, the real roll stays in the hover breakdown (rollHTML is
 * untouched), and the reason lands in midi's per-target attribution tooltip, HTML-escaped.
 */

function freshRow() {
    return {
        saveClass: 'failure',
        saveSymbol: 'midi-qol-npc-save-symbol midi-qol-save-symbol fa-xmark',
        rollTotal: '11',
        rollHTML: '<div class="dice-roll">11</div>',
        attributionTooltip: '',
        hasAttribution: false
    };
}

test('reclassifies the row as a success and swaps the symbol', () => {
    const row = freshRow();
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS', reason: 'Immune to sleep'});
    assert.equal(row.saveClass, 'success');
    assert.ok(row.saveSymbol.includes('fa-check'));
    assert.ok(!row.saveSymbol.includes('fa-xmark'));
});

test('replaces the displayed total with the label but keeps the breakdown html', () => {
    const row = freshRow();
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS', reason: 'Immune to sleep'});
    assert.equal(row.rollTotal, 'AUTOSUCCESS');
    assert.equal(row.rollHTML, '<div class="dice-roll">11</div>');
});

test('appends the escaped reason to an existing attribution tooltip', () => {
    const row = freshRow();
    row.attributionTooltip = 'Existing line';
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS', reason: 'Reason with <b>markup</b> & ampersand'});
    assert.ok(row.attributionTooltip.startsWith('Existing line<br>'));
    assert.ok(row.attributionTooltip.includes('&lt;b&gt;markup&lt;/b&gt;'));
    assert.ok(row.attributionTooltip.includes('&amp; ampersand'));
    assert.equal(row.hasAttribution, true);
});

test('sets the tooltip outright when none exists', () => {
    const row = freshRow();
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS', reason: 'Immune'});
    assert.equal(row.attributionTooltip, 'Immune');
    assert.equal(row.hasAttribution, true);
});

test('a missing reason leaves the tooltip untouched but still repaints the row', () => {
    const row = freshRow();
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS'});
    assert.equal(row.attributionTooltip, '');
    assert.equal(row.hasAttribution, false);
    assert.equal(row.rollTotal, 'AUTOSUCCESS');
});

test('does not append a reason the tooltip already contains (T129/T174 dedup)', () => {
    /*
     * With forced saves, midi's attribution tooltip ALREADY carries the reason: the preTargetSave
     * succeed() call passes it as the attribution display name (the green AutoSuccess row). The
     * postSave paint then appended the same sentence again — Vittorio's screenshot showed it
     * twice. The check is on the ESCAPED text, since that is what the tooltip stores.
     */
    const row = freshRow();
    row.attributionTooltip = '<span class="attribution-type attribution-type-SUCCESS">AutoSuccess</span> <span class="attribution-source">Immune to sleep &amp; exhaustion</span>';
    row.hasAttribution = true;
    const before = row.attributionTooltip;
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS', reason: 'Immune to sleep & exhaustion'});
    assert.equal(row.attributionTooltip, before, 'the same sentence must not appear twice');
    assert.equal(row.rollTotal, 'AUTOSUCCESS', 'the repaint itself still happens');
});

test('a genuinely different reason still appends alongside an existing attribution', () => {
    const row = freshRow();
    row.attributionTooltip = '<span class="attribution-source">Advantage from Bless</span>';
    row.hasAttribution = true;
    paintAutoSuccessRow(row, {label: 'AUTOSUCCESS', reason: 'Immune to sleep'});
    assert.ok(row.attributionTooltip.endsWith('<br>Immune to sleep'));
});
