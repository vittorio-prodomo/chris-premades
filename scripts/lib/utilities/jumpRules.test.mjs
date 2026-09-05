import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailingStraightRun, runUpFeet, planLongJump, jumpVerdict } from './jumpRules.mjs';

const feet = points => {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) / 140 * 5;
    return total;
};
const wp = (x, y, movementId, action = 'walk') => ({x, y, movementId, action});

test('a straight walk in three nudges chains into one run-up', () => {
    let history = [wp(0, 0, 'a'), wp(140, 0, 'a'), wp(280, 0, 'b'), wp(420, 0, 'c')];
    assert.equal(trailingStraightRun(history).length, 4);
    assert.equal(runUpFeet(history, feet), 15);
});

test('a bend keeps only the straight tail', () => {
    let history = [wp(0, 0, 'a'), wp(0, 140, 'a'), wp(140, 140, 'b'), wp(280, 140, 'b')];
    assert.equal(runUpFeet(history, feet), 10);
});

test('no history, one point, or a non-walk last leg is no run-up', () => {
    assert.equal(runUpFeet([], feet), 0);
    assert.equal(runUpFeet([wp(0, 0, 'a')], feet), 0);
    assert.equal(runUpFeet([wp(0, 0, 'a'), wp(280, 0, 'a', 'jump')], feet), 0);
});

test('running vs standing: STR 16 jumps 16 ft after a 10-ft run-up, 8 ft standing', () => {
    let running = planLongJump({rolled: 16, runUp: 10, speed: 30, used: 10, inCombat: true});
    assert.equal(running.running, true);
    assert.equal(running.distance, 16);
    let standing = planLongJump({rolled: 16, runUp: 5, speed: 30, used: 0, inCombat: true});
    assert.equal(standing.running, false);
    assert.equal(standing.distance, 8);
});

test('the cap is the smaller of the jump and the remaining movement; out of combat there is no budget', () => {
    let plan = planLongJump({rolled: 16, runUp: 10, speed: 30, used: 20, inCombat: true});
    assert.equal(plan.remaining, 10);
    assert.equal(plan.cap, 10);
    let free = planLongJump({rolled: 16, runUp: 10, speed: 30, used: 20, inCombat: false});
    assert.equal(free.remaining, null);
    assert.equal(free.cap, 16);
});

test('every foot costs a foot; over budget is flagged, never blocked', () => {
    let plan = planLongJump({rolled: 16, runUp: 10, speed: 30, used: 20, inCombat: true});
    assert.deepEqual(jumpVerdict(10, plan), {feet: 10, cost: 10, legal: true, spellUsed: false, remainingAfter: 0});
    assert.deepEqual(jumpVerdict(15, plan), {feet: 15, cost: 15, legal: false, spellUsed: false, remainingAfter: 0});
});

test('the Jump spell: 30 ft for 10 ft of movement, and it raises the distance', () => {
    let plan = planLongJump({rolled: 16, runUp: 0, speed: 30, used: 15, inCombat: true, spellActive: true, spellAvailable: true});
    assert.equal(plan.distance, 30);
    assert.equal(plan.cap, 30, '15 ft left still buys the whole 30-ft spell jump');
    let v = jumpVerdict(30, plan);
    assert.equal(v.cost, 10);
    assert.equal(v.legal, true);
    assert.equal(v.spellUsed, true);
    assert.equal(v.remainingAfter, 5);
});

test('the spell never charges more than the feet jumped, and is not "used" by a jump it did not shorten', () => {
    let plan = planLongJump({rolled: 16, runUp: 0, speed: 30, used: 25, inCombat: true, spellActive: true});
    assert.equal(plan.cap, 5, 'only 5 ft left: a 5-ft hop costs 5, not 10');
    assert.equal(jumpVerdict(5, plan).spellUsed, false);
    assert.equal(jumpVerdict(10, plan).spellUsed, false, '10 ft for 10 ft is no discount');
});

test('the spell already spent this turn is a plain natural jump', () => {
    let plan = planLongJump({rolled: 16, runUp: 0, speed: 30, used: 0, inCombat: true, spellActive: true, spellAvailable: false});
    assert.equal(plan.distance, 8);
    assert.equal(jumpVerdict(8, plan).cost, 8);
});

test('a natural jump longer than the spell jump costs its full length', () => {
    let plan = planLongJump({rolled: 40, runUp: 10, speed: 30, used: 0, inCombat: true, spellActive: true});
    assert.equal(plan.distance, 40);
    assert.equal(jumpVerdict(35, plan).cost, 35);
    assert.equal(plan.cap, 30, '30 ft left: the 30-ft spell jump fits, 31+ costs more than 30');
});
