// Bridge between Argon's stacking target-picker (which publishes a per-token dart distribution on
// its module API) and CPR's projectile spell macros. `parseDistributionStash` is pure/Foundry-free
// so it can be unit-tested; `consumeArgonDistribution` (added alongside the macro wiring) resolves
// token ids against the canvas and is the runtime entry point.

/**
 * Validate + normalize a published distribution stash into id/value pairs.
 * @param {{itemUuid?: string, timestamp?: number, map?: Map<string, number>}|null} stash
 * @param {string} [itemUuid]  Expected source item uuid (freshness guard).
 * @param {{maxAgeMs?: number, now?: number}} [opts]
 * @returns {Array<{id: string, value: number}>|null}  Null if missing, uuid-mismatched, stale, or empty.
 */
export function parseDistributionStash(stash, itemUuid, {maxAgeMs = 60000, now = Date.now()} = {}) {
  if (!stash || !stash.map || !(stash.map instanceof Map)) return null;
  if (itemUuid && stash.itemUuid && stash.itemUuid !== itemUuid) return null;
  if (typeof stash.timestamp === "number" && now - stash.timestamp > maxAgeMs) return null;
  const out = [];
  for (const [id, value] of stash.map) if (Number(value) > 0) out.push({ id, value: Number(value) });
  return out.length ? out : null;
}

/**
 * Read + clear Argon's published distribution and resolve it to CPR's `{document, value}` selection.
 * @param {object} workflow  The MidiQoL workflow (workflow.item.uuid is the freshness key).
 * @returns {Array<{document: Token, value: number}>|null}
 */
export function consumeArgonDistribution(workflow) {
  const api = game.modules.get("enhancedcombathud")?.api;
  const stash = api?.lastTargetDistribution;
  const parsed = parseDistributionStash(stash, workflow.item?.uuid);
  if (api) api.lastTargetDistribution = null;          // consume-once (even on mismatch/stale)
  if (!parsed) return null;
  const selection = [];
  for (const { id, value } of parsed) {
    const token = canvas.tokens.get(id);
    if (token) selection.push({ document: token, value });
  }
  return selection.length ? selection : null;
}
