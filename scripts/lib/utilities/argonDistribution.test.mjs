import assert from "node:assert";
import { parseDistributionStash } from "./argonDistribution.mjs";

const uuid = "Scene.a.Token.b.Actor.c.Item.mm";
const now = 1_000_000;
const fresh = { itemUuid: uuid, timestamp: now, map: new Map([["tokA", 2], ["tokB", 1]]) };

// happy path -> array of {id, value}
assert.deepStrictEqual(
  parseDistributionStash(fresh, uuid, { now }),
  [{ id: "tokA", value: 2 }, { id: "tokB", value: 1 }]
);
// uuid mismatch -> null
assert.strictEqual(parseDistributionStash(fresh, "other", { now }), null);
// stale -> null
assert.strictEqual(parseDistributionStash(fresh, uuid, { now: now + 60_001 }), null);
// missing / empty map -> null
assert.strictEqual(parseDistributionStash(null, uuid, { now }), null);
assert.strictEqual(parseDistributionStash({ itemUuid: uuid, timestamp: now, map: new Map() }, uuid, { now }), null);
// non-positive counts filtered; none remain -> null
assert.strictEqual(parseDistributionStash({ itemUuid: uuid, timestamp: now, map: new Map([["x", 0]]) }, uuid, { now }), null);
// no expected uuid -> uuid guard skipped
assert.deepStrictEqual(parseDistributionStash(fresh, undefined, { now }), [{ id: "tokA", value: 2 }, { id: "tokB", value: 1 }]);

console.log("parseDistributionStash: all assertions passed");
