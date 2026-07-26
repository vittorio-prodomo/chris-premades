import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakerFromWorkflow } from './rollSpeaker.mjs';

const scene = {id: 'scene123'};
const tokenDocument = {id: 'tok123', name: 'Urzul', parent: scene};
const actor = {id: 'act123', name: 'Goblin'};

test('builds a full speaker from a token placeable', () => {
    const speaker = speakerFromWorkflow({token: {document: tokenDocument}, actor});
    assert.deepEqual(speaker, {scene: 'scene123', token: 'tok123', actor: 'act123', alias: 'Urzul'});
});

test('accepts a TokenDocument directly', () => {
    const speaker = speakerFromWorkflow({token: tokenDocument, actor});
    assert.deepEqual(speaker, {scene: 'scene123', token: 'tok123', actor: 'act123', alias: 'Urzul'});
});

test('falls back to the actor name when useTokenNames is off', () => {
    const speaker = speakerFromWorkflow({token: tokenDocument, actor}, {useTokenNames: false});
    assert.equal(speaker.alias, 'Goblin');
    assert.equal(speaker.token, 'tok123', 'the token id still rides along');
});

test('uses the token name when the token has one but no actor is on the workflow', () => {
    const speaker = speakerFromWorkflow({token: tokenDocument});
    assert.deepEqual(speaker, {scene: 'scene123', token: 'tok123', actor: null, alias: 'Urzul'});
});

test('reads the actor off the token when the workflow carries none', () => {
    const speaker = speakerFromWorkflow({token: {document: {...tokenDocument, actor}}});
    assert.equal(speaker.actor, 'act123');
});

test('builds an actor-only speaker when there is no token', () => {
    const speaker = speakerFromWorkflow({actor});
    assert.deepEqual(speaker, {scene: null, token: null, actor: 'act123', alias: 'Goblin'});
});

test('returns undefined when the workflow identifies nobody', () => {
    assert.equal(speakerFromWorkflow({}), undefined);
});

test('returns undefined for a missing workflow', () => {
    assert.equal(speakerFromWorkflow(undefined), undefined);
    assert.equal(speakerFromWorkflow(null), undefined);
});

test('falls back to the actor name when the token is nameless', () => {
    const speaker = speakerFromWorkflow({token: {id: 'tok123', parent: scene}, actor});
    assert.equal(speaker.alias, 'Goblin');
});

test('leaves the scene null for a token outside any scene', () => {
    const speaker = speakerFromWorkflow({token: {id: 'tok123', name: 'Urzul'}, actor});
    assert.equal(speaker.scene, null);
});
