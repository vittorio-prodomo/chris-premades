# Ranger After-Hit Premades: Ensnaring Strike + Hail of Thorns (2024)

**Date:** 2026-07-04 · **Branch:** `feat/ranger-after-hit-premades` (off `v13`) · **Fork-only, no upstream PR.**

## Goal

Give the two ranger "cast immediately after hitting" spells (2024 rules) the same reactive automation CPR ships for the nine paladin smites: land a weapon hit → get offered the cast → the spell auto-targets the creature just hit and resolves fully (save, condition, recurring damage). Re-import-durable via the DDB premade-at-import swap channel. Today neither CPR nor GPS covers these spells; the DDB import leaves them as trust-the-player manual casts with no trigger enforcement, no Large-creature advantage, and manual recurring damage.

## RAW anchors (PHB 2024)

- **Ensnaring Strike** (Ranger 1, Conjuration, V, Conc. 1 min): cast as a Bonus Action *immediately after hitting a creature with a weapon* (any weapon, melee or ranged). The creature makes a STR save vs the caster's spell DC; **Large or larger creatures have Advantage**. Fail → **Restrained** until the spell ends + **1d6 Piercing at the start of each of its turns** while Restrained. Success → the spell ends. Escape: the target or a creature within reach can take an **action** to make STR (Athletics) vs the spell DC; success ends the spell. Upcast: +1d6 per slot level above 1.
- **Hail of Thorns** (Ranger 1, Conjuration): cast as a Bonus Action *immediately after hitting a creature with a Ranged weapon*. The target **and each creature within 5 feet of it** make a DEX save: **1d10 Piercing** on a failure, **half on a success**. Instantaneous, no concentration (2024). Upcast: +1d10 per slot level above 1.
- Neither spell is in the SRD pack (`dnd5e.spells24` has ES only). **Before building the items, verify both spells' exact text/numbers against Vittorio's official 2024 rulebook compendiums** (premium modules installed in-world; catalogue the pack ids into the `official-2024-compendiums` memory while there).
- Interacting rules the automation respects implicitly: one bonus action per turn; the "one spell-slot spell per turn" rule is *not* enforced (matches CPR smite behavior).

## Architecture

Three pieces, all in this CPR fork (pattern copied from `divineSmite`/`wrathfulSmite`):

1. **Shared after-hit actor hook** — one actor-level midi macro on pass `damageRollComplete`, exported from `ensnaringStrike.js` and reused by `hailOfThorns.js` (same array object + same `unique` key, so it registers once regardless of which spells the actor owns — the wrathfulSmite reuse pattern).
2. **Two premade macro modules** — `scripts/macros/2024/spells/ensnaringStrike.js` and `hailOfThorns.js`, registered in `scripts/macros.js`. Item-pass macros handle each spell's own resolution (advantage, effect application, burst targeting).
3. **Two pack items** — added to the modern spells compendium via `packData` JSON + `npm run buildCompendiums` (node 22, Foundry stopped). These are the donors the DDB premade-at-import swap (`chrisPremades.integration.ddbi` → `getCPRAutomation`, name + `modern` rules match) copies onto imported items.

## The shared hook (offer flow)

Gates, evaluated in order; **all must pass or the hook exits silently**:

1. `workflow.hitTargets.size > 0` — a hit landed.
2. Attack qualification: workflow item is a **weapon**; action type `mwak` → ES qualifies; `rwak` (incl. thrown) → ES + HoT qualify. Unarmed strikes do NOT qualify (ES says "a weapon"). The workflow item must not itself be ES/HoT (self-trigger guard).
3. **Concentration gate (Vittorio):** the attacker has NO active concentration effect → otherwise no offer (manual cast is the deliberate concentration-switch path).
4. **Bonus-action gate (Vittorio):** `!actorUtils.hasUsedBonusAction(actor)` (same tracking the smites use; trivially passes out of combat).
5. In combat: it must be the attacker's turn (`combatUtils.getCurrentCombatantToken() === workflow.token`). Out of combat: offers freely (smite parity).
6. At least one qualifying spell is **prepared with an available spell slot** (`actorUtils.getCastableSpells` filtered by identifiers `ensnaringStrike` / `hailOfThorns`).

Offer: `dialogUtils.selectDocumentDialog` listing the qualifying spell(s) + a None/decline option. Declining consumes nothing. On selection: `workflowUtils.completeItemUse(spell, …, {targetUuids: [firstHitTarget]})` — the spell's own usage dialog runs (slot level choice = RAW upcasting; cancelling it consumes nothing), targeting is supplied automatically. **No damage is folded into the triggering attack** (unlike smites — these spells resolve independently).

## Ensnaring Strike premade

**Pack item:** L1 Conjuration, activation Bonus Action + condition text "Immediately after hitting a creature with a weapon", **range: Special** with text "The creature you just hit with a weapon attack" (see Range note), Concentration 1 min, V only. One save activity: STR vs `spellcasting` DC, **no damage parts on the cast**. Baked-in midi use condition `workflow.targets.size === 1` (reason text tells the player to target the creature they hit) + `affects: 1 creature` — this is the hard target guard on the manual path; the hook path always satisfies it.

**Item macro passes:**
- *pre-save:* grant the save **Advantage** to any target of size Large or larger (actor `system.traits.size` ∈ {lg, huge, grg}).
- *rollFinished:* 
  - **Failed save** → create the "Ensnared" effect on the target: `conditions: ['restrained']`, duration tied to the spell, **midi OverTime** change `turn=start, damageRoll=<N>d6, damageType=piercing, allowIncapacitated=true, label=Ensnaring Strike` where `N = 1 + (castLevel − 1)`. The effect is registered as a **dependent of the caster's concentration** (concentration drop/loss removes it automatically — CPR `effectUtils.createEffect` concentration wiring, as in the legacy hold-person pattern). Effect description carries the escape rule + computed DC ("Action: Strength (Athletics) vs DC X by the target or a creature within reach frees it").
  - **Successful save** → RAW "the spell ends": remove the caster's concentration effect for this cast. Slot stays spent.

**Escape is documented-manual in v1:** the GM adjudicates the Athletics check and deletes the effect (it is a GM-side monster action at this table). A clickable escape activity is explicitly out of scope (possible later polish).

## Hail of Thorns premade

**Pack item:** L1 Conjuration, activation Bonus Action + condition text "Immediately after hitting a creature with a Ranged weapon", **range: Special** ("The creature you just hit with a ranged weapon attack"), instantaneous, no concentration. One save activity: DEX vs `spellcasting` DC, damage `1d10` piercing with per-slot-level scaling, **half damage on success** (`damage.onSave: half`).

**Item macro pass** (*pre-save / preamble*): expand workflow targets to the primary target **plus every creature within 5 ft of it** (CPR `tokenUtils.findNearby`, disposition-agnostic — allies included per RAW). Damage application then flows through the normal midi save-damage pipeline.

**Manual cast:** target exactly one creature (same baked guard, `targets.size === 1`); the macro performs the same 5-ft expansion.

## Range "Special" + re-import durability of the header

The swap channel replaces activities/effects/flags but the item header (spellbook range column) comes from the DDB parse. To keep "Special" after re-imports, the premades declare the header fix via **CPR's `ddbi.correctedItems` config** (`CONFIG.chrisPremades.correctedItems.<name>`, read by ddb-importer's `ChrisPremadesHelper` during the swap) carrying `system.range = {units: 'spec', special: <text>, value: null}` (+ the activation condition text if the parse drops it). **Risk + fallback:** `correctedItems` merge semantics are read-from-source, not yet exercised by us — if the header fix doesn't stick in the durability test, fall back to a ~2-line range override in the ddb-importer fork's spell enrichers for these two spells (note: the MM saga showed some enricher channels silently not applying; verify whichever channel is used in the durability test).

A numeric range is explicitly rejected: midi range-checking is on in this world and would wrongly abort casts after long-range hits (RAW has no distance limit on the trigger).

## Config (medkit homebrew section, smite parity)

Per spell: damage type (default piercing), die size (d6 / d10), base dice count. The two suppression gates are **hard-coded, not configurable** (per design discussion).

## Migration & deployment

1. Build: macro files + registration + packData items → `buildCompendiums` (node 22, **Foundry stopped**, `systemctl --user stop foundryvtt-v13`) → `npm run build` → restart service → F5 (dev-loader covers scripts; compendium needed the restart anyway).
2. **Warpey live migration = fresh delete + re-import** (the established drill: cobalt cookie, CPR settle poll, token replacement). The swap supersedes both the 2026-07-04 hand guard and the inert `dnd5e.spells24` medkit stamp on his current ES. No manual cleanup.
3. **HoT live testing:** temp-grant the pack item to Warpey (he does not know the spell on DDB; remove after testing). Its import-swap path is verified as far as possible (pack presence + name/rules match) — full end-to-end proof waits until a PC actually learns HoT.

## Failure behavior

Silent and free, throughout: any gate fails → no offer; picker declined or usage dialog cancelled → nothing consumed; successful ES save → concentration auto-ends; concentration dropped/broken → Ensnared cleans itself up (dependent effect). Zero new console errors is part of the acceptance bar.

## Test matrix (agent client, sole GM, dev-sandbox-v13; Heroic Inspiration toggled off during runs — documented absent-owner hang)

1. Longbow hit (rwak) → picker shows **ES + HoT**; decline → nothing consumed, no state change.
2. Accept ES → slot burns; STR save rolls; **Large-target advantage** verified against the Ogre ("Non Morto Ogre"); on fail → Ensnared (Restrained) lands; in combat the goblin's turn-start auto-rolls the OverTime 1d6 (initiative set **before** `startCombat` — modal landmine).
3. ES save-success path → no effect on target, caster concentration removed automatically.
4. Gate checks: with HM concentration up → no offer; with bonus action spent → no offer; on another PC with neither spell → hook never registers/offers.
5. Melee weapon hit (mwak; temp-grant a melee weapon if Warpey lacks one) → picker shows **ES only**.
6. HoT accept (temp-granted): two adjacent goblins → both roll DEX saves; failed = full 1d10, passed = half; ally inside 5 ft also saves (RAW). Upcast: formula shows +1d10/level; one live L2 cast via temp slot grant.
7. Range header reads "Special — …" on both items, **including after the Warpey re-import** (durability test: activities, effects, guard, macros flags, corrected header all present; premade-count sanity vs baseline).
8. Manual-cast path: ES cast from the sheet with 1 target → works (concentration-switch flow); with 0 or 2 targets → blocked with the guard message, slot refunded.
9. Regression: Toll the Dead, MM (BG3 picker), and a smite-free PC's attacks unaffected; console clean.

## Out of scope

Clickable escape action for Ensnared; other after-hit spells (smites are upstream CPR's); enforcement of "one slot spell per turn"; upstream PRs; the paused v14 line.
