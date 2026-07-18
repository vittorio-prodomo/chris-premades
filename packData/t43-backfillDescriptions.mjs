// T43 (2026-07-18): backfill blank `system.description.value` across the two
// summon-feature packs from official local sources (PHB 2024 actors pack +
// DDB-imported summons, exported to a corpus JSON by the driving session).
//
// Usage: npm run buildCompendiums:backfillDescriptions -- /path/to/corpus.json
//   corpus.json = { count, corpus: [{source, actor, name, type, desc}] }
//   (sources: phb2024 = dnd-players-handbook.actors, ddb2014 = the world DDB
//    summons pack — note its text is 2024-edition, srd2024 = dnd5e.actors24)
//
// Policy: the 2024 pack is matched generically (phb2024 > ddb2014 > srd2024,
// scoped by the item's pack folder -> source actor). The 2014 pack gets ONLY
// explicit overrides (local official 2014 text barely exists — DDB migrated to
// 2024 wording; wrong-edition text is worse than blank). Everything still
// blank afterwards is reported for the queue's still-blank list.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packDataDir = dirname(fileURLToPath(import.meta.url));
const PACKS = ['cpr-summon-features', 'cpr-summon-features-2024'];

const corpusPath = process.argv[2];
if (!corpusPath) {
  console.error('Usage: node t43-backfillDescriptions.mjs <corpus.json>');
  process.exit(1);
}
let corpusRaw = JSON.parse(readFileSync(corpusPath, 'utf8'));
if (typeof corpusRaw === 'string') corpusRaw = JSON.parse(corpusRaw); // browser export double-encodes
const stripSecrets = html => html.replace(/<section class="secret"[\s\S]*?<\/section>/g, '').trim();
const corpus = corpusRaw.corpus
  .map(e => ({ ...e, desc: stripSecrets(e.desc) }))
  .filter(e => e.desc);

const norm = s => s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();
const SOURCE_PRIORITY = { phb2024: 0, ddb2014: 1, srd2024: 2 };

// Pack folder name -> candidate source-actor scoping.
const folderActors = folderName => {
  const f = norm(folderName);
  if (f === 'primal companion') return a => norm(a).startsWith('beast of the');
  return a => norm(a).includes(f);
};

// name alias fixups (CPR name -> official item name)
const ALIASES = {
  'stone lethargy': 'stony lethargy',
  'claws': 'claw',
};

// Literal / corpus-pointer overrides, keyed `<pack>/<file>`.
// { actor, name, source? } = corpus pointer; { html } = literal text.
const OVERRIDES = {
  // ---- 2024 pack: items with no direct official twin ----
  // Fey Step mood rider split out by CPR; official clause lives inside the
  // PHB 2024 Fey Spirit "Fey Step" description.
  'cpr-summon-features-2024/Fuming_FhnjzjP8Isu3cgOM.json': {
    html: "<p><em>Fey Step (Fuming mood):</em> after the spirit uses its Fey Step, it has Advantage on the next attack roll it makes before the end of this turn.</p>",
  },
  // CPR uses a single Slam item for every object size; official damage is per
  // size, so this composites the PHB 2024 per-size values.
  'cpr-summon-features-2024/Slam__Animated_Object__gXKD6pkqNfAPBaDA.json': {
    html: "<p><em>Melee Attack Roll:</em> Bonus equals your spell attack modifier, reach 5 ft. <em>Hit:</em> Force damage based on the object's size — 1d4 + 3 (Tiny, Small, or Medium), 2d6 + 3 + your spellcasting ability modifier (Large), or 2d12 + 3 + your spellcasting ability modifier (Huge).</p>",
  },
  // CPR splits Rotting Claw's paralysis rider into its own item.
  'cpr-summon-features-2024/Rotting_Claw__Putrid_Only___Paralyze_D2zH0owCx3lCbjDO.json': {
    html: "<p>Rider of the spirit's Rotting Claw: if the target has the &amp;Reference[poisoned apply=false] condition, it has the &amp;Reference[paralyzed apply=false] condition until the end of its next turn.</p>",
  },
  // ---- 2014 pack: explicit fills only ----
  // Bigby's Hand options — DDB "Arcane Hand (Red)" carries the 2014 text.
  'cpr-summon-features/Clenched_Fist_AynfnFKNnRqksFLM.json': { actor: 'Arcane Hand (Red)', name: 'Clenched Fist' },
  'cpr-summon-features/Forceful_Hand_5y4X6vwzF7SXOaJe.json': { actor: 'Arcane Hand (Red)', name: 'Forceful Hand' },
  'cpr-summon-features/Grasping_Hand_CObgIbwM59wqhhLW.json': { actor: 'Arcane Hand (Red)', name: 'Grasping Hand' },
  'cpr-summon-features/Interposing_Hand_4Mul5s5FBFfo3PEo.json': { actor: 'Arcane Hand (Red)', name: 'Interposing Hand' },
  // Flaming Sphere spell-effect items (2014 spell text via the DDB effects).
  'cpr-summon-features/Flaming_Sphere__End_Turn_tSz0EhFMDmxkOTEX.json': { actor: 'Flaming Sphere', name: 'Flame Damage' },
  'cpr-summon-features/Flaming_Sphere__Ram_12i7ZjlJVDuuPwbL.json': { actor: 'Flaming Sphere', name: 'Move and Attack' },
  'cpr-summon-features/Guardian_of_Faith__Damage_iKcEmUdogdV3pYHF.json': { actor: 'Guardian of Faith', name: 'Guardian Aura' },
  // Primal-Companion traits shared across editions (wording identical).
  'cpr-summon-features/Primal_Bond_GxD5bpMgwqVNSTyr.json': { actor: 'Beast of the Land', name: 'Primal Bond', source: 'phb2024' },
  'cpr-summon-features/Amphibious_aCqOMn26RxupmHC2.json': { actor: 'Beast of the Sea', name: 'Amphibious', source: 'phb2024' },
  'cpr-summon-features/Flyby_r8LNc8W7fuV17CGi.json': { actor: 'Beast of the Sky', name: 'Flyby', source: 'phb2024' },
};

const findCorpus = ({ actor, name, source }) => {
  const hits = corpus.filter(e =>
    norm(e.actor) === norm(actor) && norm(e.name) === norm(name) && (!source || e.source === source));
  return hits[0] ?? null;
};

const parseName = full => {
  const m = full.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { base: full, qualifier: null };
  return { base: m[1], qualifier: m[2].replace(/\s+only$/i, '') };
};

const matchGeneric = (itemName, folderName) => {
  const inScope = folderActors(folderName);
  const { base, qualifier } = parseName(itemName);
  const candidates = corpus.filter(e => inScope(e.actor));
  const ranked = list => list.sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source])[0] ?? null;
  const byName = n => candidates.filter(e => norm(e.name) === norm(n));
  // 1) exact full name; 2) qualifier-variant actor + base; 3) base; 4) alias
  let hit = ranked(byName(itemName));
  if (!hit && qualifier) {
    const variant = candidates.filter(e => norm(e.actor).includes(norm(qualifier)) && norm(e.name) === norm(base));
    hit = ranked(variant);
  }
  if (!hit) hit = ranked(byName(base));
  if (!hit && ALIASES[norm(base)]) hit = ranked(byName(ALIASES[norm(base)]));
  return hit;
};

const report = { filled: [], stillBlank: [] };
for (const pack of PACKS) {
  const dir = join(packDataDir, pack);
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const folders = {};
  const items = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!j.system) { folders[j._id] = j.name; continue; } // pack folder doc
    items.push({ f, j });
  }
  for (const { f, j } of items) {
    if ((j.system.description?.value ?? '').trim()) continue;
    const key = `${pack}/${f}`;
    const ov = OVERRIDES[key];
    let desc = null, from = null;
    if (ov?.html) { desc = ov.html; from = 'curated'; }
    else if (ov) {
      const hit = findCorpus(ov);
      if (hit) { desc = hit.desc; from = `${hit.source}:${hit.actor}`; }
    } else if (pack === 'cpr-summon-features-2024') {
      const folderName = folders[j.folder] ?? '';
      const hit = matchGeneric(j.name, folderName);
      if (hit) { desc = hit.desc; from = `${hit.source}:${hit.actor}`; }
    }
    if (desc) {
      j.system.description.value = desc;
      writeFileSync(join(dir, f), JSON.stringify(j, null, 2) + '\n');
      report.filled.push({ pack, file: f, id: j._id, name: j.name, from });
    } else {
      report.stillBlank.push({ pack, file: f, id: j._id, name: j.name });
    }
  }
}

console.log(JSON.stringify(report, null, 1));
console.log(`# filled=${report.filled.length} stillBlank=${report.stillBlank.length}`);
