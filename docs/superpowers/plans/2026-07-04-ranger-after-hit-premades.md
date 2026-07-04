# Ranger After-Hit Premades (Ensnaring Strike + Hail of Thorns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CPR-style reactive automation for the two 2024 ranger "cast immediately after hitting" spells — weapon hit → offer picker → auto-cast at the hit creature → full resolution — re-import-durable via the DDB premade-at-import swap.

**Architecture:** One shared actor-level midi hook (pass `damageRollComplete`, `divineSmite` pattern) exported from `ensnaringStrike.js` and reused by `hailOfThorns.js`; per-spell item macros for resolution (Large-save-advantage + Restrained/OverTime for ES, 5-ft burst expansion for HoT); two pack items in `packData/cpr-spells-2024/` as swap donors; the "Special" range header carried through re-imports via `ddbi.correctedItems`.

**Tech Stack:** CPR fork (plain JS ES modules, webpack → `dist/main.js`), CPR utils (`dialogUtils`, `effectUtils`, `workflowUtils`, `tokenUtils`, `genericUtils`, `actorUtils`, `combatUtils`, `itemUtils`), MidiQoL OverTime/DAE specialDuration, LevelDB pack build (`npm run buildCompendiums`).

## Global Constraints

- Branch: `feat/ranger-after-hit-premades` (already cut off `v13`); fork-only, **no upstream PR**.
- Script build: `npm run build` (webpack, default node 25 via nvm). Scripts hot-load with **plain F5** (dev-loader).
- Compendium build: `npm run buildCompendiums` under **node 22** (`nvm use 22`) with **Foundry STOPPED** (`systemctl --user stop foundryvtt-v13`); restart relaunches `dev-sandbox-v13`.
- Live testing: agent client as **sole logged-in GM** (runbook `_tools/foundry-vtt-mcp-v13/docs/runbooks/agent-client-login.md`); **toggle the acting PC's `system.attributes.inspiration` to `false` during casts and restore after** (CPR HI prompt hangs workflows when the owner is absent); **set initiative before `startCombat()`** (modal-await hang); match usage dialogs via `constructor.name.includes('ActivityUsageDialog')`.
- The suppression gates (no offer while concentrating / bonus action used) are **hard-coded** per design.
- All user-visible fork-added strings are plain English literals (no new i18n keys; `foundry.utils.localize` passes unknown keys through unchanged).
- Never edit `packs/` (build output) or the installed CPR copy; only `packData/` + `scripts/`.

---

### Task 1: Verify RAW texts against the official 2024 compendiums

**Files:**
- Modify: `docs/superpowers/plans/2026-07-04-ranger-after-hit-premades.md` (this file — correct Task 4's embedded texts/numbers if the official books differ)
- Modify: `~/.claude/projects/-home-vittorio-dev-foundry-modules/memory/reference_official_2024_compendiums.md` (catalogue pack ids)

**Interfaces:**
- Produces: confirmed description HTML + numbers for both spells, consumed verbatim by Task 4's item JSON.

- [ ] **Step 1: Log the agent client in** (runbook: allowlist gate `curl -s http://localhost:30001/api/status` → world `dev-sandbox-v13`; join as `Claude`; wait for `game.ready` + 5s).

- [ ] **Step 2: Enumerate premium 2024 packs and pull both spells**

Run via `browser_evaluate`:

```js
async () => {
  const packs = game.packs.filter(p => p.metadata.type === 'Item' && !p.collection.startsWith('dnd5e.')
    && !p.collection.startsWith('chris-premades.') && !p.collection.startsWith('world.'));
  const out = { packIds: packs.map(p => p.collection), hits: {} };
  for (const p of packs) {
    const idx = await p.getIndex();
    for (const name of ['Ensnaring Strike', 'Hail of Thorns']) {
      const e = idx.find(x => x.name === name);
      if (!e) continue;
      const d = await p.getDocument(e._id);
      out.hits[`${p.collection}:${name}`] = {
        activation: d.system.activation, range: d.system.range, duration: d.system.duration,
        level: d.system.level, school: d.system.school,
        desc: d.system.description.value
      };
    }
  }
  return out;
}
```

Expected: at least one premium pack (the 2024 Player's Handbook module) returns both spells.

- [ ] **Step 3: Diff against Task 4's embedded constants.** Compare the returned `desc`, save ability, damage die, burst radius, upcast wording against the JSON in Task 4 Step 2/3. If anything differs (especially Hail of Thorns, embedded from memory), edit Task 4's heredoc in this plan file to the official values. ES's text was already captured live from `dnd5e.spells24` and should match.

- [ ] **Step 4: Record the pack ids** — replace the "Pack ids not yet catalogued" sentence in `reference_official_2024_compendiums.md` with the actual spell-pack id(s) from Step 2.

- [ ] **Step 5: Commit** (only if this plan file changed):

```bash
git add docs/superpowers/plans/2026-07-04-ranger-after-hit-premades.md
git commit -m "docs(plan): fold official 2024 rulebook texts into pack-item constants"
```

---

### Task 2: `ensnaringStrike.js` — shared after-hit hook + ES resolution macros

**Files:**
- Create: `scripts/macros/2024/spells/ensnaringStrike.js`
- Modify: `scripts/macros.js` (one export line)

**Interfaces:**
- Consumes: CPR utils (exact signatures used are shown in the code below — all verified against `scripts/lib/utilities/*` at plan time).
- Produces: `ensnaringStrike` macro export with `midi.actor` (array reused by Task 3), `midi.item`, `config`, `ddbi.correctedItems`. Identifiers: item `ensnaringStrike`, applied-effect identifier `ensnaredEffect`.

- [ ] **Step 1: Write the file** — complete content:

```js
import {actorUtils, combatUtils, constants, dialogUtils, effectUtils, genericUtils, itemUtils, workflowUtils} from '../../../utils.js';

// Fork addition: shared "ranger after-hit" offer (Ensnaring Strike + Hail of Thorns).
// Mirrors divineSmite's actor hook; hailOfThorns reuses this exact midi.actor array,
// and the shared `unique` key makes CPR register it once per actor.
async function afterHit({trigger, workflow}) {
    if (!workflow.hitTargets.size) return;
    if (workflow.item?.type !== 'weapon') return;
    let actionType = workflowUtils.getActionType(workflow);
    if (!['mwak', 'rwak'].includes(actionType)) return;
    if (workflow.actor.concentration?.effects?.size) return; // table rule: never offer while concentrating
    if (actorUtils.hasUsedBonusAction(workflow.actor)) return;
    if (combatUtils.inCombat()) if (combatUtils.getCurrentCombatantToken() != workflow.token) return;
    let identifiers = ['ensnaringStrike'];
    if (actionType === 'rwak') identifiers.push('hailOfThorns');
    let spells = actorUtils.getCastableSpells(workflow.actor)
        .filter(i => identifiers.includes(genericUtils.getIdentifier(i)))
        .sort((a, b) => a.system.level - b.system.level);
    if (!spells.length) return;
    let selection = await dialogUtils.selectDocumentDialog('After-Hit Spell', 'Cast a spell on the creature you just hit? (Bonus Action)', spells, {addNoneDocument: true});
    if (!selection) return;
    let target = workflow.hitTargets.first();
    await workflowUtils.completeItemUse(selection, undefined, {targetUuids: [target.document.uuid]});
}
// RAW: a Large or larger creature has Advantage on the save. Transient midi flag,
// self-expiring the moment the target rolls its STR save (DAE specialDuration).
async function early({trigger, workflow}) {
    let largeSizes = ['lg', 'huge', 'grg'];
    await Promise.all(Array.from(workflow.targets)
        .filter(t => largeSizes.includes(t.actor?.system.traits.size))
        .map(async token => {
            let effectData = {
                name: workflow.item.name + ': Large Creature',
                img: workflow.item.img,
                origin: workflow.item.uuid,
                duration: {seconds: 60},
                changes: [{key: 'flags.midi-qol.advantage.ability.save.str', mode: 0, value: '1', priority: 20}],
                flags: {dae: {specialDuration: ['isSave.str']}}
            };
            await effectUtils.createEffect(token.actor, effectData, {});
        }));
}
async function use({trigger, workflow}) {
    let concentration = effectUtils.getConcentrationEffect(workflow.actor, workflow.item);
    if (!workflow.failedSaves.size) {
        // RAW: on a successful save the vines shrivel away and the spell ends.
        if (concentration) await genericUtils.remove(concentration);
        return;
    }
    let castLevel = workflowUtils.getCastLevel(workflow);
    let baseLevel = workflow.castData.baseLevel ?? workflow.item.system.level;
    let diceNumber = itemUtils.getConfig(workflow.item, 'baseDiceNumber') + (castLevel - baseLevel);
    let diceSize = itemUtils.getConfig(workflow.item, 'diceSize');
    let damageType = itemUtils.getConfig(workflow.item, 'damageType');
    let dc = itemUtils.getSaveDC(workflow.item);
    let effectData = {
        name: 'Ensnared',
        img: workflow.item.img,
        origin: workflow.item.uuid,
        duration: {seconds: 60},
        description: '<p>Restrained by thorny vines. Takes ' + diceNumber + diceSize + ' ' + damageType
            + ' damage at the start of each of its turns.</p><p><strong>Escape:</strong> the target or a creature '
            + 'within reach can take an action to make a Strength (Athletics) check vs DC ' + dc
            + '; on a success, the spell ends (delete this effect).</p>',
        changes: [{
            key: 'flags.midi-qol.OverTime',
            mode: 0,
            value: 'turn=start, damageRoll=' + diceNumber + diceSize + ', damageType=' + damageType + ', allowIncapacitated=true, label=Ensnaring Strike',
            priority: 20
        }]
    };
    await Promise.all(workflow.failedSaves.map(async token => {
        if (actorUtils.checkTrait(token.actor, 'ci', 'restrained')) return;
        await effectUtils.createEffect(token.actor, effectData, {identifier: 'ensnaredEffect', concentrationItem: workflow.item, conditions: ['restrained']});
    }));
}
export let ensnaringStrike = {
    name: 'Ensnaring Strike',
    version: '1.0.0',
    rules: 'modern',
    midi: {
        actor: [
            {
                pass: 'damageRollComplete',
                macro: afterHit,
                priority: 250,
                unique: 'rangerAfterHit'
            }
        ],
        item: [
            {
                pass: 'preItemRoll',
                macro: early,
                priority: 50
            },
            {
                pass: 'rollFinished',
                macro: use,
                priority: 50
            }
        ]
    },
    config: [
        {
            value: 'damageType',
            label: 'CHRISPREMADES.Config.DamageType',
            type: 'select',
            default: 'piercing',
            category: 'homebrew',
            homebrew: true,
            options: constants.damageTypeOptions
        },
        {
            value: 'diceSize',
            label: 'CHRISPREMADES.Config.DiceSize',
            type: 'select',
            default: 'd6',
            category: 'homebrew',
            homebrew: true,
            options: constants.diceSizeOptions
        },
        {
            value: 'baseDiceNumber',
            label: 'CHRISPREMADES.Config.BaseDiceNumber',
            type: 'number',
            default: 1,
            category: 'homebrew',
            homebrew: true
        }
    ],
    ddbi: {
        correctedItems: {
            'Ensnaring Strike': {
                system: {
                    range: {units: 'spec', special: 'The creature you just hit with a weapon attack', value: null}
                }
            }
        }
    }
};
```

- [ ] **Step 2: Register in `scripts/macros.js`** — insert alphabetically among the 2024 spell exports (near line 156's neighborhood):

```js
export {ensnaringStrike} from './macros/2024/spells/ensnaringStrike.js';
```

- [ ] **Step 3: Build and verify it compiles**

Run: `cd ~/dev/foundry-modules/modules/chris-premades && npm run build 2>&1 | tail -5`
Expected: webpack success, no errors.

Run: `grep -c "rangerAfterHit" dist/main.js`
Expected: `1` (or more) — the hook is in the bundle.

- [ ] **Step 4: Commit**

```bash
git add scripts/macros/2024/spells/ensnaringStrike.js scripts/macros.js
git commit -m "feat(2024): Ensnaring Strike premade — shared ranger after-hit offer + save/Restrained/OverTime resolution"
```

---

### Task 3: `hailOfThorns.js` — burst premade reusing the shared hook

**Files:**
- Create: `scripts/macros/2024/spells/hailOfThorns.js`
- Modify: `scripts/macros.js` (one export line)

**Interfaces:**
- Consumes: `ensnaringStrike.midi.actor` (the shared hook array from Task 2 — same object, so the `unique: 'rangerAfterHit'` key dedupes).
- Produces: `hailOfThorns` macro export; item identifier `hailOfThorns`.

- [ ] **Step 1: Write the file** — complete content:

```js
import {genericUtils, tokenUtils} from '../../../utils.js';
import {ensnaringStrike} from './ensnaringStrike.js';

// Fork addition. RAW: the hit creature and each creature within 5 feet of it make
// the DEX save — allies included. Expand the workflow targets before rolls happen;
// midi's save phase re-reads user targets for non-attack activities.
async function early({trigger, workflow}) {
    let primary = workflow.targets.first();
    if (!primary) return;
    let burst = tokenUtils.findNearby(primary, 5, 'any', {includeIncapacitated: true, includeToken: true});
    if (!burst.includes(primary)) burst.push(primary);
    await genericUtils.updateTargets(burst);
}
export let hailOfThorns = {
    name: 'Hail of Thorns',
    version: '1.0.0',
    rules: 'modern',
    midi: {
        actor: ensnaringStrike.midi.actor,
        item: [
            {
                pass: 'preItemRoll',
                macro: early,
                priority: 50
            }
        ]
    },
    ddbi: {
        correctedItems: {
            'Hail of Thorns': {
                system: {
                    range: {units: 'spec', special: 'The creature you just hit with a ranged weapon attack', value: null}
                }
            }
        }
    }
};
```

(No `config` block: HoT's damage lives in the pack item's save activity — die size/scaling are item data, not macro formula, so the medkit homebrew knobs would be dead weight. YAGNI.)

- [ ] **Step 2: Verify `findNearby` accepts `'any'`** — read the disposition switch:

Run: `sed -n '79,100p' scripts/lib/utilities/tokenUtils.js`
Expected: a case/default that treats non-ally/enemy dispositions as "all tokens". If `'any'` is not handled (only `ally`/`enemy` cases + throw), change the call to pass `null` or the documented "all" value used elsewhere in CPR (grep one existing caller: `grep -rn "findNearby(" scripts/macros/2024/ | head -5` and copy its all-dispositions form).

- [ ] **Step 3: Register in `scripts/macros.js`** (alphabetical):

```js
export {hailOfThorns} from './macros/2024/spells/hailOfThorns.js';
```

- [ ] **Step 4: Build + verify**

Run: `npm run build 2>&1 | tail -3 && grep -c "hailOfThorns" dist/main.js`
Expected: build success; count ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/macros/2024/spells/hailOfThorns.js scripts/macros.js
git commit -m "feat(2024): Hail of Thorns premade — 5-ft burst on the just-hit creature, reuses the after-hit hook"
```

---

### Task 4: Pack items in `packData/cpr-spells-2024/` + compendium build + deploy

**Files:**
- Create: `packData/cpr-spells-2024/Ensnaring_Strike_cprEsnStrike2024.json`
- Create: `packData/cpr-spells-2024/Hail_of_Thorns_cprHailThorn2024.json`

**Interfaces:**
- Consumes: macro identifiers from Tasks 2–3 (`ensnaringStrike`, `hailOfThorns`) via `flags.chris-premades.macros.midi.item`.
- Produces: swap donors discoverable by `getCPRAutomation` (name + `modern` rules) in pack `chris-premades.CPRSpells2024`.

- [ ] **Step 1: Generate both JSONs from the Hold Person template** (keeps every boilerplate field schema-correct; only the listed overrides differ). Run from the repo root:

```bash
node --input-type=module <<'EOF'
import fs from 'fs';
const tpl = JSON.parse(fs.readFileSync('packData/cpr-spells-2024/Hold_Person_qF1ZugZRSB3pK6Zv.json', 'utf8'));
const clean = structuredClone(tpl);

function baseSpell(o) {
  const d = structuredClone(clean);
  d._id = o.id; d._key = '!items!' + o.id; d.name = o.name; d.img = o.img;
  d.type = 'spell'; d.folder = null; d.effects = o.effects ?? [];
  d.system.level = 1; d.system.school = 'con';
  d.system.method = 'spell'; d.system.prepared = 1;
  d.system.materials = {value: '', consumed: false, cost: 0, supply: 0};
  d.system.properties = o.properties;
  d.system.activation = {type: 'bonus', value: null, condition: o.trigger};
  d.system.range = {value: null, units: 'spec', special: o.rangeSpecial};
  d.system.duration = o.duration;
  d.system.target = {template: {contiguous: false, units: 'ft', type: '', size: null},
                     affects: {count: 1, type: 'creature', choice: false, special: ''}};
  d.system.description = {value: o.desc, chat: ''};
  d.system.source = {book: 'PHB 2024', rules: '2024', revision: 1};
  d.system.uses = {spent: null, max: '', recovery: []};
  d.system.activities = o.activities;
  d.flags = {'chris-premades': {info: {identifier: o.identifier, version: '1.0.0', source: 'chris-premades', rules: 'modern'},
                                macros: {midi: {item: [o.identifier]}}}};
  return d;
}

const guard = {
  useConditionText: 'workflow.targets.size === 1',
  useConditionReason: o => o + ' needs exactly one target (the creature you just hit) —'
};

const es = baseSpell({
  id: 'cprEsnStrike2024', name: 'Ensnaring Strike',
  img: 'icons/magic/nature/root-vine-entangled-hand.webp',
  identifier: 'ensnaringStrike',
  properties: ['vocal', 'concentration', 'mgc'],
  trigger: 'Immediately after hitting a creature with a weapon',
  rangeSpecial: 'The creature you just hit with a weapon attack',
  duration: {value: 1, units: 'minute', concentration: true},
  desc: '<p>As you hit the target, grasping vines appear on it, and it makes a Strength saving throw. A Large or larger creature has Advantage on this save. On a failed save, the target has the Restrained condition until the spell ends. On a successful save, the vines shrivel away, and the spell ends.</p><p>While Restrained, the target takes 1d6 Piercing damage at the start of each of its turns. The target or a creature within reach of it can take an action to make a Strength (Athletics) check against your spell save DC. On a success, the spell ends.</p><p><em><strong>Using a Higher-Level Spell Slot.</strong></em> The damage increases by 1d6 for each spell slot level above 1.</p>',
  activities: {
    dnd5eactivity000: {
      _id: 'dnd5eactivity000', type: 'save', name: '',
      activation: {type: 'bonus', value: null, override: false},
      consumption: {targets: [], scaling: {allowed: false, max: ''}, spellSlot: true},
      description: {chatFlavor: ''},
      duration: {units: 'inst', concentration: false, override: false},
      effects: [],
      range: {override: false},
      target: {override: false, prompt: true, template: {contiguous: false, units: 'ft'}, affects: {choice: false}},
      uses: {spent: 0, max: '', recovery: []},
      save: {ability: ['str'], dc: {calculation: 'spellcasting', formula: ''}},
      damage: {onSave: 'none', parts: []},
      useConditionText: guard.useConditionText,
      useConditionReason: guard.useConditionReason('Ensnaring Strike'),
      sort: 0
    }
  }
});

const hot = baseSpell({
  id: 'cprHailThorn2024', name: 'Hail of Thorns',
  img: 'icons/magic/nature/thorns-spike-curled-green.webp',
  identifier: 'hailOfThorns',
  properties: ['vocal', 'mgc'],
  trigger: 'Immediately after hitting a creature with a Ranged weapon',
  rangeSpecial: 'The creature you just hit with a ranged weapon attack',
  duration: {value: null, units: 'inst', concentration: false},
  desc: '<p>As you hit the target, the piece of ammunition or weapon you used explodes into a rain of thorns. The target and each creature within 5 feet of it make a Dexterity saving throw, taking 1d10 Piercing damage on a failed save or half as much damage on a successful one.</p><p><em><strong>Using a Higher-Level Spell Slot.</strong></em> The damage increases by 1d10 for each spell slot level above 1.</p>',
  activities: {
    dnd5eactivity000: {
      _id: 'dnd5eactivity000', type: 'save', name: '',
      activation: {type: 'bonus', value: null, override: false},
      consumption: {targets: [], scaling: {allowed: false, max: ''}, spellSlot: true},
      description: {chatFlavor: ''},
      duration: {units: 'inst', concentration: false, override: false},
      effects: [],
      range: {override: false},
      target: {override: false, prompt: true, template: {contiguous: false, units: 'ft'}, affects: {choice: false}},
      uses: {spent: 0, max: '', recovery: []},
      save: {ability: ['dex'], dc: {calculation: 'spellcasting', formula: ''}},
      damage: {onSave: 'half', parts: [{number: 1, denomination: 10, types: ['piercing'], scaling: {mode: 'whole', number: 1}, custom: {enabled: false}, bonus: ''}]},
      useConditionText: guard.useConditionText,
      useConditionReason: guard.useConditionReason('Hail of Thorns'),
      sort: 0
    }
  }
});

// ES applies its Restrained effect via the item macro (concentration-dependent),
// so the pack item ships NO embedded effects; HoT has none by nature.
for (const d of [es, hot]) {
  const file = 'packData/cpr-spells-2024/' + d.name.replaceAll(' ', '_') + '_' + d._id + '.json';
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  console.log('wrote', file);
}
EOF
```

Expected output: `wrote packData/.../Ensnaring_Strike_cprEsnStrike2024.json` + the HoT line.

**Schema check before committing:** open the generated ES file next to `Hold_Person_qF1ZugZRSB3pK6Zv.json` and confirm the top-level keys match the template's set (`_id`, `_key`, `name`, `type`, `img`, `system`, `effects`, `flags`, `folder`, `sort`, `ownership`, `_stats` — copy any of the template's remaining bookkeeping keys the generator's `structuredClone` already preserved; delete none). Confirm Task 1's official texts were folded into `desc` values.

- [ ] **Step 2: Build compendiums (Foundry stopped) and rebuild scripts**

```bash
systemctl --user stop foundryvtt-v13
source ~/.nvm/nvm.sh && nvm use 22 && npm run buildCompendiums 2>&1 | tail -5
nvm use 25 && npm run build 2>&1 | tail -3
systemctl --user start foundryvtt-v13
```

Expected: buildCompendiums completes without errors; service restarts (poll `curl -s http://localhost:30001/api/status` until `"active":true`, ~10–60s).

- [ ] **Step 3: Verify in-world** — log the agent client in, then `browser_evaluate`:

```js
async () => {
  const pack = game.packs.get('chris-premades.CPRSpells2024');
  const idx = await pack.getIndex();
  const out = {};
  for (const n of ['Ensnaring Strike', 'Hail of Thorns']) {
    const e = idx.find(x => x.name === n);
    if (!e) { out[n] = 'MISSING'; continue; }
    const d = await pack.getDocument(e._id);
    const act = d.system.activities.contents[0];
    out[n] = {
      range: d.system.range.units + ':' + d.system.range.special,
      identifier: d.flags['chris-premades']?.info?.identifier,
      macros: d.flags['chris-premades']?.macros?.midi?.item,
      save: Array.from(act.save?.ability ?? []),
      guard: act.useConditionText,
      onSave: act.damage?.onSave ?? 'none'
    };
  }
  return out;
}
```

Expected: both present; ES `save:['str']`, HoT `save:['dex']` + `onSave:'half'`; both `guard: 'workflow.targets.size === 1'`, range `spec:The creature you just hit…`, correct identifiers/macros.

- [ ] **Step 4: Commit**

```bash
git add packData/cpr-spells-2024/Ensnaring_Strike_cprEsnStrike2024.json packData/cpr-spells-2024/Hail_of_Thorns_cprHailThorn2024.json
git commit -m "feat(packs): Ensnaring Strike + Hail of Thorns 2024 pack items (swap donors, Special range, target guard)"
```

---

### Task 5: Live verification — offer gates + decline + manual guard (out of combat)

**Files:** none (live testing; agent client, sole GM, Warpey; HI toggled off for the duration).

**Interfaces:**
- Consumes: everything deployed in Tasks 2–4.

- [ ] **Step 1: Stage Warpey** — `browser_evaluate`: record baseline (`spell1` slots, effects, HI state), set `system.attributes.inspiration = false`, grant 1 L1 slot if at 0, **apply the pack premades to his spells**: replace his current Ensnaring Strike item with the pack build (`actor.createEmbeddedDocuments('Item', [packDoc.toObject()])` after deleting `EnsnariStrike124` — record the old item id first), and temp-grant Hail of Thorns from the pack. Confirm both items on the actor carry `flags.chris-premades.macros.midi.item`.

- [ ] **Step 2: Offer appears on a ranged hit + decline is free** — target a goblin, `use-item` Warpey's Longbow (auto-rolls; pass `activityId` if it has multiple activities). Expected: after the damage roll, a CPR dialog ("After-Hit Spell") lists **Ensnaring Strike and Hail of Thorns** + a None option (capture via `renderApplicationV2` hook; CPR dialogs are ApplicationV2). Click None/decline. Verify: slots unchanged, no concentration, no new effects on anyone.

- [ ] **Step 3: Concentration gate** — cast Hunter's Mark via the Favored Enemy feat cast activity (activity `ylNjbzBDWxqOgjJG` — re-read the id if Warpey was re-imported; consumes the feat pool, restore after). Longbow-hit a goblin again. Expected: **no offer dialog renders** (watch 10s via the hook), workflow completes normally. Then remove the HM concentration + restore the feat pool baseline.

- [ ] **Step 4: Bonus-action gate** — in a quick combat (2 combatants, initiative set via `combatant.update({initiative})` BEFORE `startCombat()`), on Warpey's turn call `MidiQOL.setBonusActionUsed(workflow.actor)` equivalent: `chrisPremades.utils.actorUtils.setBonusActionUsed(actor)` — if not API-exposed, run `browser_evaluate` `await game.modules.get('midi-qol').api?.setBonusActionUsed?.(actor)`; fallback: cast HM (uses the bonus action) then attack. Longbow hit → expected: **no offer**. End combat, clean effects.

- [ ] **Step 5: Manual-cast guard** — clear targets; `use-item` ES directly (single activity, no picker expected). Expected: blocked warning "Ensnaring Strike needs exactly one target…" and **no slot consumed**. Target TWO goblins → same block. Target ONE goblin → the usage dialog appears (auto-click submit), cast completes (this doubles as the manual-path success check; state cleaned in Task 6's flow).

- [ ] **Step 6: Restore interim state** — remove any leftover concentration/effects from Step 5's successful cast; slots back to staged value.

No commit (no repo changes). Record pass/fail notes for the final task's log.

---

### Task 6: Live verification — ES full resolution in combat

**Files:** none.

- [ ] **Step 1: Combat setup** — Warpey + Goblin A + the Ogre ("Non Morto Ogre" token; place one from the actor if none on scene) in a combat; initiative preset (Warpey first), `startCombat()`.

- [ ] **Step 2: Failed-save path + OverTime tick** — on Warpey's turn: Longbow-hit Goblin A → accept **Ensnaring Strike** in the picker → usage dialog auto-submit (slot burns). Expected: STR save auto-rolls for the goblin (visible in the card's saves display); on a fail (STR −1 vs DC ~13 — retry once if it saves): goblin gains `Ensnared` (Restrained status) with the OverTime change + escape text w/ DC in the description; Warpey gains `Concentrating: Ensnaring Strike`. Advance to the goblin's turn (`next-turn`): expected **automatic 1d6 piercing roll + HP drop** (the OverTime tick).

- [ ] **Step 3: Concentration cascade** — delete Warpey's concentration effect. Expected: `Ensnared` disappears from the goblin (dependent effect).

- [ ] **Step 4: Success path ends the spell** — re-grant a slot; repeat the hit→accept flow but force the save to succeed (temporarily set the goblin's STR save bonus high: `token.actor.update({'system.abilities.str.value': 30})`, restore after). Expected: no Ensnared anywhere AND **Warpey's concentration is auto-removed** (the `use` macro's success branch), slot spent.

- [ ] **Step 5: Large-creature advantage** — re-grant a slot; hit the **Ogre**, accept ES. Expected: the save roll is made **with advantage** (2d20kh in the roll formula / the transient "Large Creature" effect appears then self-expires). Verify via the save roll's formula in chat flags.

- [ ] **Step 6: Full cleanup** — end combat; delete test effects; restore goblin/Ogre HP + STR; slots to baseline; feat pool baseline; keep HI off until Task 7 ends.

---

### Task 7: Live verification — Hail of Thorns burst + upcast

**Files:** none.

- [ ] **Step 1: Burst geometry** — position Goblin A and Goblin B adjacent (≤5 ft apart), Warpey at range. Longbow-hit Goblin A → accept **Hail of Thorns**. Expected: **both** goblins roll DEX saves; failed = full 1d10 piercing, passed = half (check HP deltas vs the damage card). If a third token (e.g. Warpey's own position test is impractical — skip ally-in-burst unless a PC token is within 5 ft naturally).

- [ ] **Step 2: Upcast** — grant Warpey one L2 slot (`system.spells.spell2 = {value: 1, max: 1, override: 1}`), repeat the hit→accept, choose **2nd level** in the usage dialog. Expected: damage roll is **2d10**. Restore spell2 to 0/0 (`override: null`) after.

- [ ] **Step 3: Melee shows ES only** — give Warpey a melee weapon if he lacks one (temp-add a Dagger from `dnd5e.items24`… verify pack id via `game.packs`), move adjacent to a goblin, melee-hit. Expected: picker lists **Ensnaring Strike only** (no HoT). Decline. Remove the temp weapon.

- [ ] **Step 4: Cleanup** — goblin HPs restored, temp items/slots removed, **Warpey's `inspiration` back to `true`**, effects clean.

---

### Task 8: Durability (re-import swap), regression, wrap-up

**Files:**
- Modify: `docs/superpowers/specs/2026-07-04-ranger-after-hit-premades-design.md` (as-built notes, only if behavior diverged)

- [ ] **Step 1: Fresh re-import Warpey** — record token position; `delete-actor` + `ddb-import-character` (DDB id 159822087); poll items + `chrisEffectsApplied` count stable; replace the scene token (`actor.getTokenDocument({x,y})` + `createEmbeddedDocuments`; Generic Actions self-heals).

- [ ] **Step 2: Verify the swap took our premade** — on the NEW Ensnaring Strike item: `flags.chris-premades.info.identifier === 'ensnaringStrike'` (ours — no longer the `dnd5e.spells24` medkit stamp), `macros.midi.item: ['ensnaringStrike']`, activity guard `workflow.targets.size === 1`, save `['str']`, **and the item header range shows `spec` + "The creature you just hit…"** (the `ddbi.correctedItems` merge). If the range header did NOT stick: record it, and fall back per spec (2-line enricher override in the ddb-importer fork — file as immediate follow-up, do not block this plan).

- [ ] **Step 3: Post-swap smoke** — one Longbow hit → offer appears → decline. One manual no-target ES cast → blocked + refunded.

- [ ] **Step 4: Regression sweep** — Toll the Dead (Nahuel, target Goblin A): completes with save + damage as before (restore HP). Magic Missile (Nahuel, no targets, out of combat): BG3 picker flow opens/cancellable as before. Console: 0 new errors across the session (ATL deprecation trace is pre-existing).

- [ ] **Step 5: Final state hygiene** — Warpey: HoT temp item REMOVED post-re-import (re-import already drops it — verify absent), slots/pools/inspiration at natural post-import values; goblins/Ogre clean; agent client browser closed.

- [ ] **Step 6: As-built + push**

```bash
git add -A docs/superpowers/
git commit -m "docs: as-built notes for ranger after-hit premades" # only if spec/plan edited
git push -u origin feat/ranger-after-hit-premades
```

Then merge to `v13` per fork convention (fast-forward or merge commit, matching prior feature merges) and push `v13`.

---

## Self-review notes (resolved at plan time)

- Spec coverage: hook gates (T2), ES resolution incl. Large-advantage + success-ends-concentration + OverTime (T2/T6), HoT burst + half-save + upcast (T3/T4/T7), Special range + correctedItems + fallback (T2/T3/T4/T8), guard on manual path (T4/T5), migration via re-import (T8), config knobs (T2; HoT deliberately none), failure behavior (T5), regression (T8). Escape stays documented-manual (effect description, T2 `use`).
- Known verify-at-step points are explicit steps, not placeholders: `findNearby` 'any' semantics (T3·S2), pack JSON schema vs template (T4·S1), official texts (T1), correctedItems stick (T8·S2 with fallback).
- Identifier consistency: `ensnaringStrike` / `hailOfThorns` / `ensnaredEffect` / `rangerAfterHit` used identically across T2/T3/T4/T8.
