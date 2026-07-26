import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absolutizeJournalLinks } from './journalLinks.mjs';

// The live shape: dnd5e's Hide rule page and the journal it lives in (v13.351, PHB-2024 module).
const JOURNAL = 'Compendium.dnd-players-handbook.content.JournalEntry.phbAppendixCRule';
const HIDE = 'With the Hide action, you try to conceal yourself. To do so, you must succeed on a '
    + '[[/check stealth dc=15]] check while you’re @UUID[.YkuKTIH2YaYW8lTS]{Heavily Obscured} or behind '
    + '&amp;Reference[Three-Quarters Cover] or &amp;Reference[Total Cover].';

test('rewrites the sibling link that breaks on Hide (T64)', () => {
    const out = absolutizeJournalLinks(HIDE, JOURNAL);
    assert.match(out, /@UUID\[Compendium\.dnd-players-handbook\.content\.JournalEntry\.phbAppendixCRule\.JournalEntryPage\.YkuKTIH2YaYW8lTS\]\{Heavily Obscured\}/);
    assert.equal(out.includes('@UUID[.'), false);
});

test('touches nothing else in the page — labels, &Reference links and roll enrichers survive', () => {
    const out = absolutizeJournalLinks(HIDE, JOURNAL);
    assert.match(out, /\[\[\/check stealth dc=15\]\]/);
    assert.match(out, /&amp;Reference\[Three-Quarters Cover\]/);
    assert.match(out, /&amp;Reference\[Total Cover\]/);
    assert.equal(out.replace(/@UUID\[[^\]]+\]/, ''), HIDE.replace(/@UUID\[[^\]]+\]/, ''));
});

test('rewrites every relative link on a page, not just the first', () => {
    // Ready and Knock Out each carry two.
    const src = 'a @UUID[.OhSIWaQ61dOp7S8M]{One} b @UUID[.0a2umg2mJMAzM9Q3]{Two} c';
    assert.equal(
        absolutizeJournalLinks(src, JOURNAL),
        `a @UUID[${JOURNAL}.JournalEntryPage.OhSIWaQ61dOp7S8M]{One} b @UUID[${JOURNAL}.JournalEntryPage.0a2umg2mJMAzM9Q3]{Two} c`
    );
});

test('preserves a heading anchor', () => {
    assert.equal(
        absolutizeJournalLinks('@UUID[.YkuKTIH2YaYW8lTS#Obscured Areas]{Label}', JOURNAL),
        `@UUID[${JOURNAL}.JournalEntryPage.YkuKTIH2YaYW8lTS#Obscured Areas]{Label}`
    );
});

test('leaves absolute links alone', () => {
    const abs = `@UUID[${JOURNAL}.JournalEntryPage.YkuKTIH2YaYW8lTS]{Heavily Obscured}`;
    assert.equal(absolutizeJournalLinks(abs, JOURNAL), abs);
    const actor = '@UUID[Actor.abcdefgh12345678]{Someone}';
    assert.equal(absolutizeJournalLinks(actor, JOURNAL), actor);
});

test('leaves relative shapes it cannot faithfully reconstruct alone', () => {
    // `.JournalEntryPage.<id>` is NOT the sibling form — fromUuid throws on it relative to a page.
    const explicit = '@UUID[.JournalEntryPage.YkuKTIH2YaYW8lTS]{Label}';
    assert.equal(absolutizeJournalLinks(explicit, JOURNAL), explicit);
    const embedded = '@UUID[.Item.abcdefgh12345678]{Label}';
    assert.equal(absolutizeJournalLinks(embedded, JOURNAL), embedded);
    const parentWalk = '@UUID[..JournalEntry.abcdefgh12345678]{Label}';
    assert.equal(absolutizeJournalLinks(parentWalk, JOURNAL), parentWalk);
});

test('fails open on missing input rather than emptying a description', () => {
    assert.equal(absolutizeJournalLinks(HIDE, undefined), HIDE);
    assert.equal(absolutizeJournalLinks(HIDE, ''), HIDE);
    assert.equal(absolutizeJournalLinks(HIDE, null), HIDE);
    assert.equal(absolutizeJournalLinks('', JOURNAL), '');
    assert.equal(absolutizeJournalLinks(undefined, JOURNAL), undefined);
    assert.equal(absolutizeJournalLinks(null, JOURNAL), null);
    assert.equal(absolutizeJournalLinks(42, JOURNAL), 42);
});

test('is idempotent — a second pass over rewritten content changes nothing', () => {
    const once = absolutizeJournalLinks(HIDE, JOURNAL);
    assert.equal(absolutizeJournalLinks(once, JOURNAL), once);
});

test('works for a world journal too, where the parent UUID has no compendium prefix', () => {
    assert.equal(
        absolutizeJournalLinks('@UUID[.abcdefgh12345678]{Sibling}', 'JournalEntry.wxyz0123456789ab'),
        '@UUID[JournalEntry.wxyz0123456789ab.JournalEntryPage.abcdefgh12345678]{Sibling}'
    );
});
