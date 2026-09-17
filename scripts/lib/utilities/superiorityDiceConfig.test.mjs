import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

// The modern Superiority Dice entry lost its `config` for seven weeks (da051dfd2 -> 2026-09-18):
// `determineSuperiorityDie` then read `scale[undefined][undefined]`, toasted on every weapon hit
// and silently rolled a d6 for a Battle Master's d8. The macro file cannot be imported under node
// (it pulls in Foundry), so this guards the source text.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../macros');
const modern = fs.readFileSync(path.join(root, '2024/classFeatures/fighter/battleMaster/maneuvers.js'), 'utf8');
const legacy = fs.readFileSync(path.join(root, '2014/classFeatures/fighter/battleMaster/superiorityDice.js'), 'utf8');

function exportBlock(source, name) {
    let start = source.indexOf(`export let ${name} = {`);
    assert.notEqual(start, -1, `${name} is exported`);
    let end = source.indexOf('\n};', start);
    return source.slice(start, end);
}

test('the modern Superiority Dice entry carries the class/scale config the die lookup reads', () => {
    assert.match(exportBlock(modern, 'superiorityDice'), /^\s*config:/m);
});

test('the legacy entry still defines both defaults the modern one borrows', () => {
    let block = exportBlock(legacy, 'superiorityDice');
    assert.match(block, /value: 'subclass'[\s\S]*?default: 'battle-master'/);
    assert.match(block, /value: 'scale'[\s\S]*?default: 'combat-superiority-die'/);
});
