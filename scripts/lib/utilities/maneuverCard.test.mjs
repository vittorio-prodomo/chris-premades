import test from 'node:test';
import assert from 'node:assert/strict';
import {balanceDivs, maneuverSection, rewriteManeuverCard} from './maneuverCard.mjs';

const DESC = '<h3>Riposte</h3><p>When a creature misses you…</p><h3>Goading Attack</h3><p>When you hit…</p><div><p>nested</p></div><h3>Commander’s Strike</h3><p>Forgo one attack…</p><p><em>Level 3 Options chosen</em></p>';
const CARD = `<div class="chat-card activation-card">
    <section class="card-header description collapsible" >
        <header class="summary">
            <img class="gold-icon" src="icons/star.webp" alt="Maneuver Options">
            <div class="name-stacked border">
                <span class="title">Maneuver Options</span>
                <span class="subtitle">Maneuver</span>
            </div>
        </header>
        <section class="details collapsible-content card-content">
            <div class="wrapper"><h3>Riposte</h3><p>a</p><div><p>deep</p></div><h3>Goading Attack</h3><p>b</p></div>
        </section>
    </section>
    <div class="card-buttons"><button type="button">Save</button></div>
</div>`;

test('maneuverSection: one maneuver\'s text, up to the next heading', () => {
    assert.equal(maneuverSection(DESC, 'Riposte'), '<p>When a creature misses you…</p>');
    assert.equal(maneuverSection(DESC, 'Goading Attack'), '<p>When you hit…</p><div><p>nested</p></div>');
});

test('maneuverSection: apostrophe forms and case do not matter; the last section runs to the end', () => {
    assert.ok(maneuverSection(DESC, "commander's strike").startsWith('<p>Forgo one attack…</p>'));
});

test('maneuverSection: no such heading, or no description, is null', () => {
    assert.equal(maneuverSection(DESC, 'Parry'), null);
    assert.equal(maneuverSection('', 'Riposte'), null);
    assert.equal(maneuverSection(DESC, ''), null);
});

test('rewriteManeuverCard: title, icon and description become the maneuver\'s; the rest is untouched', () => {
    let out = rewriteManeuverCard(CARD, {title: 'Goading Attack', img: 'icons/goad.webp', description: '<p>b</p>'});
    assert.ok(out.includes('<span class="title">Goading Attack</span>'));
    assert.ok(out.includes('<img class="gold-icon" src="icons/goad.webp" alt="Goading Attack">'));
    assert.ok(out.includes('<div class="wrapper"><p>b</p></div>'));
    assert.ok(!out.includes('<p>deep</p>'), 'the nested div inside the old wrapper went with it');
    assert.ok(out.includes('<span class="subtitle">Maneuver</span>'));
    assert.ok(out.includes('<div class="card-buttons"><button type="button">Save</button></div>'), 'buttons survive');
    assert.equal((out.match(/<\/section>/g) ?? []).length, 2, 'structure intact');
});

test('rewriteManeuverCard: no description given keeps dnd5e\'s text', () => {
    let out = rewriteManeuverCard(CARD, {title: 'Riposte', description: null});
    assert.ok(out.includes('<span class="title">Riposte</span>'));
    assert.ok(out.includes('<p>deep</p>'));
});

test('rewriteManeuverCard: a card without the expected header is left alone', () => {
    assert.equal(rewriteManeuverCard('<p>something else</p>', {title: 'Riposte'}), null);
});

// His Riposte card, 2026-09-18: Riposte is the LAST section of a wrapped description.
const WRAPPED = '<div class="ddb">\n<h3>Goading Attack</h3><p>g</p><h3>Riposte</h3><p>r</p><p><em>Level 3 Options chosen: <strong>@UUID[x]{Riposte}, @UUID[y]{Goading Attack}</strong></em></p>\n</div>';

test('maneuverSection: the last section carries neither the wrapper\'s closing div nor the options-chosen line', () => {
    assert.equal(maneuverSection(WRAPPED, 'Riposte'), '<p>r</p>');
    assert.equal(maneuverSection(WRAPPED, 'Goading Attack'), '<p>g</p>');
});

test('balanceDivs: stray closers go, open ones are closed, balanced markup is untouched', () => {
    assert.equal(balanceDivs('<p>a</p></div>'), '<p>a</p>');
    assert.equal(balanceDivs('<div><p>a</p>'), '<div><p>a</p></div>');
    assert.equal(balanceDivs('<div class="x"><div>a</div></div>'), '<div class="x"><div>a</div></div>');
    assert.equal(balanceDivs('</div></div><p>a</p>'), '<p>a</p>');
});

test('a rewritten card stays structurally intact even when the section came from a wrapped description', () => {
    let out = rewriteManeuverCard(CARD, {title: 'Riposte', description: maneuverSection(WRAPPED, 'Riposte')});
    assert.equal((out.match(/<div\b/g) ?? []).length, (out.match(/<\/div>/g) ?? []).length);
});
