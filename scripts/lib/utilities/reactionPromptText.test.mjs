import test from 'node:test';
import assert from 'node:assert/strict';
import {SHIELD_PROMPT_SECONDS, shieldPromptKey, isReplacedD20} from './reactionPromptText.mjs';

test('T238 the Shield-vs-Magic-Missile prompt names the darts, singular and plural', () => {
    assert.equal(shieldPromptKey(1), 'CHRISPREMADES.Macros.MagicMissile.ShieldPromptOne');
    assert.equal(shieldPromptKey(3), 'CHRISPREMADES.Macros.MagicMissile.ShieldPrompt');
    assert.equal(shieldPromptKey('1'), 'CHRISPREMADES.Macros.MagicMissile.ShieldPromptOne');
    assert.equal(shieldPromptKey(undefined), 'CHRISPREMADES.Macros.MagicMissile.ShieldPrompt');
});

test('T238 the prompt expires like the other reaction prompts', () => {
    assert.equal(SHIELD_PROMPT_SECONDS, 30);
});

test('T237 a d20 replaced by a Portent die is not offered a Heroic Inspiration reroll', () => {
    assert.equal(isReplacedD20({options: {portentD20: 15}}), true);
    assert.equal(isReplacedD20({options: {portentD20: 1}}), true);
    assert.equal(isReplacedD20({options: {}}), false);
    assert.equal(isReplacedD20({options: {portentD20: null}}), false);
    assert.equal(isReplacedD20(undefined), false);
});
