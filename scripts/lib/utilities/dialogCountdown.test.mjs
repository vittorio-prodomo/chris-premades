import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secondsRemaining } from './dialogCountdown.mjs';

test('counts whole seconds down to the deadline', () => {
    const deadline = 30_000;
    assert.equal(secondsRemaining(deadline, 0), 30);
    assert.equal(secondsRemaining(deadline, 500), 30);   // 29.5s left still reads 30
    assert.equal(secondsRemaining(deadline, 29_100), 1);
});

test('never shows a negative countdown once the deadline passes', () => {
    assert.equal(secondsRemaining(30_000, 30_000), 0);
    assert.equal(secondsRemaining(30_000, 99_000), 0);
});
