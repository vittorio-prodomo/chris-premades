/**
 * verify-packs — does `packs/` still match `packData/`?
 *
 * WHY THIS EXISTS
 *
 * `buildCompendiums` treats `packData/` as the source of truth and overwrites `packs/` wholesale.
 * That is fine right up until someone edits a compendium *inside Foundry* — through the compendium
 * UI, which is a completely normal thing to do. That edit lives only in `packs/`, which is
 * gitignored AND binary, so git cannot see it and neither can a human. The next rebuild destroys it
 * without a word.
 *
 * So this is a PRE-FLIGHT check: run it before rebuilding. If it reports drift, someone edited
 * outside `packData/` and you must reconcile (usually `npm run extractCompendiums`, then review the
 * git diff on `packData/`) BEFORE building, or the edit is gone.
 *
 * It is equally useful as a POST-FLIGHT check: after a rebuild the two must agree by construction,
 * so a failure means the build did not write what it claimed.
 *
 * ⚠️ WHY NOT JUST DIFF FILE SIZES: a LevelDB rebuild legitimately changes byte size a lot — on
 * 2026-07-27 a like-for-like rebuild shrank `cpr-class-features-2024` by 52% purely from compacting
 * write-ahead logs, with all 2484 documents intact. Size proves nothing. Even document COUNT only
 * proves nothing was added or removed, not that nothing was modified. This compares content.
 *
 * ⚠️ FOUNDRY MUST BE STOPPED. Extracting opens the pack LevelDBs, and a running server holds an
 * exclusive lock — same precondition as `buildCompendiums` itself.
 *
 * Usage:
 *   npm run verifyPacks                 # every pack
 *   npm run verifyPacks cpr-items-2024  # just these
 *   node packData/verify-packs.mjs --json
 *
 * Exit code is 0 when clean, 1 on drift or error — so it can gate a build.
 */

import { extractPack } from '@foundryvtt/foundryvtt-cli';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/* -------------------------------------------- */
/*  Pack list — derived, never duplicated       */
/* -------------------------------------------- */

/**
 * Read the packs straight out of the module manifest rather than hardcoding a list.
 * `packData.mjs` and `unpackData.mjs` each keep their own copy and they have already drifted apart
 * (one flat list vs an item/actor split); a third copy would rot the same way. The manifest is the
 * one place that must be right for Foundry to load at all.
 */
function packsFromManifest() {
  const manifest = JSON.parse(readFileSync('module-template.json', 'utf8'));
  return manifest.packs.map((p) => ({
    name: p.path.split('/').pop(),
    path: p.path,
    type: p.type,
  }));
}

/* -------------------------------------------- */
/*  Normalisation                               */
/* -------------------------------------------- */

/**
 * ⚠️ MUST MATCH `unpackData.mjs`'s `transformEntry` EXACTLY.
 *
 * Those fields are stripped on extraction because Foundry rewrites them on its own (timestamps,
 * sort order, ownership). If this diverged, every document would read as drifted and the check
 * would be noise — which is worse than no check, because you would learn to ignore it.
 */
function normalise(entry, type) {
  delete entry._stats;
  delete entry.sort;
  delete entry.ownership;
  if (type === 'Item') {
    for (const i in entry.effects ?? {}) {
      if (entry.effects[i]?._stats) delete entry.effects[i]._stats;
    }
    if (entry.system?.source?.sourceClass) delete entry.system.source.sourceClass;
    if (entry.flags?.core?.sourceId) delete entry.flags.core.sourceId;
    if (entry.system?.materials?.value) entry.system.materials.value = '';
  }
  return entry;
}

/* -------------------------------------------- */
/*  Deep diff                                   */
/* -------------------------------------------- */

/**
 * Report the field PATHS that differ, not just "these are different" — "system.uses.max" tells you
 * what someone changed in Foundry; a boolean tells you nothing and sends you reading JSON by hand.
 * @returns {string[]}
 */
function diffPaths(a, b, path = '', out = [], limit = 8) {
  if (out.length >= limit) return out;
  if (a === b) return out;

  const aObj = a && typeof a === 'object';
  const bObj = b && typeof b === 'object';
  if (!aObj || !bObj) {
    out.push(`${path || '(root)'}: ${short(a)} -> ${short(b)}`);
    return out;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: array/object mismatch`);
    return out;
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (out.length >= limit) break;
    const p = path ? `${path}.${key}` : key;
    if (!(key in a)) out.push(`${p}: (absent) -> ${short(b[key])}`);
    else if (!(key in b)) out.push(`${p}: ${short(a[key])} -> (absent)`);
    else diffPaths(a[key], b[key], p, out, limit);
  }
  return out;
}

function short(v) {
  if (v === undefined) return '(absent)';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 57) + '…' : s;
}

/* -------------------------------------------- */
/*  Per-pack comparison                         */
/* -------------------------------------------- */

function readPackData(dir, type) {
  const docs = new Map();
  if (!existsSync(dir)) return docs;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    docs.set(doc._id ?? file, { doc: normalise(doc, type), file });
  }
  return docs;
}

async function verifyPack(pack, tmpRoot) {
  const live = join(tmpRoot, pack.name);
  await extractPack(pack.path, live, { log: false, documentType: pack.type });

  const fromPacks = readPackData(live, pack.type);
  const fromData = readPackData(join('packData', pack.name), pack.type);

  const onlyInPacks = [];
  const onlyInData = [];
  const modified = [];

  for (const [id, { doc, file }] of fromPacks) {
    if (!fromData.has(id)) {
      onlyInPacks.push(`${doc.name ?? file} (${id})`);
      continue;
    }
    const paths = diffPaths(fromData.get(id).doc, doc);
    if (paths.length) modified.push({ name: doc.name ?? file, id, paths });
  }
  for (const [id, { doc, file }] of fromData) {
    if (!fromPacks.has(id)) onlyInData.push(`${doc.name ?? file} (${id})`);
  }

  return {
    pack: pack.name,
    counts: { packs: fromPacks.size, packData: fromData.size },
    onlyInPacks,
    onlyInData,
    modified,
    clean: !onlyInPacks.length && !onlyInData.length && !modified.length,
  };
}

/* -------------------------------------------- */
/*  Main                                        */
/* -------------------------------------------- */

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const selected = args.filter((a) => !a.startsWith('--'));

const all = packsFromManifest();
const unknown = selected.filter((s) => !all.some((p) => p.name === s));
if (unknown.length) {
  console.error(`unknown pack(s): ${unknown.join(', ')}`);
  process.exit(1);
}
const packs = selected.length ? all.filter((p) => selected.includes(p.name)) : all;

const tmpRoot = mkdtempSync(join(tmpdir(), 'cpr-verify-'));
const results = [];
let failed = null;

try {
  for (const pack of packs) {
    if (!existsSync(pack.path)) {
      results.push({ pack: pack.name, missing: true, clean: false });
      continue;
    }
    results.push(await verifyPack(pack, tmpRoot));
  }
} catch (err) {
  const msg = String(err?.message ?? err);
  /**
   * ⚠️ A RUNNING FOUNDRY DOES NOT REPORT ITSELF AS A LOCK ERROR.
   *
   * Verified 2026-07-27: with the server up, extraction fails with
   *   "Iterator is not open: cannot call next() after close()"
   * — an abstract-level teardown message that says nothing about locks and sends you debugging the
   * wrong thing entirely. (`packData.mjs` documents the same message appearing for an unrelated
   * node>=25 teardown quirk, which makes it doubly misleading.) Stopping Foundry fixes it.
   *
   * So: name that message explicitly, and since a held lock is the overwhelmingly likely cause of
   * ANY failure here, always surface it as the first thing to check rather than only on a match.
   */
  const looksLikeLock = /LOCK|lock|EBUSY|already held|Iterator is not open/i.test(msg);
  console.error(
    `\nCould not read a pack.${looksLikeLock ? '' : ' (Unrecognised error — but check this first anyway.)'}\n` +
      '  Foundry is almost certainly still RUNNING and holding the LevelDB lock:\n' +
      '      systemctl --user stop foundryvtt-v13\n' +
      '  ⚠️ A running server does NOT produce a "lock" error here — it surfaces as\n' +
      '     "Iterator is not open: cannot call next() after close()".\n'
  );
  failed = msg;
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

if (failed) {
  console.error(`verify-packs failed: ${failed}`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const dirty = results.filter((r) => !r.clean);
  const totalPacks = results.reduce((n, r) => n + (r.counts?.packs ?? 0), 0);
  const totalData = results.reduce((n, r) => n + (r.counts?.packData ?? 0), 0);

  console.log(`\nverify-packs — ${results.length} pack(s): ${totalPacks} doc(s) in packs/, ${totalData} in packData/\n`);

  for (const r of dirty) {
    if (r.missing) {
      console.log(`  ${r.pack}: MISSING on disk (packs/${r.pack} does not exist)`);
      continue;
    }
    console.log(`  ${r.pack}:`);
    for (const n of r.onlyInPacks) {
      console.log(`      IN FOUNDRY ONLY  ${n}  <-- a rebuild would DELETE this`);
    }
    for (const n of r.onlyInData) {
      console.log(`      IN packData ONLY ${n}  <-- present in source, absent from the built pack`);
    }
    for (const m of r.modified) {
      console.log(`      MODIFIED         ${m.name} (${m.id})  <-- a rebuild would REVERT this`);
      for (const p of m.paths) console.log(`                         ${p}`);
    }
  }

  if (!dirty.length) {
    console.log('  clean — packs/ and packData/ hold the same documents with the same content.');
    console.log('  Safe to run buildCompendiums.\n');
  } else {
    console.log(
      `\n  ${dirty.length} pack(s) DRIFTED.\n` +
        '  If these are edits you made in Foundry and want to keep, capture them FIRST:\n' +
        '      npm run extractCompendiums   # rewrites packData/ from packs/\n' +
        '      git diff packData/           # review, then commit\n' +
        '  Rebuilding before doing that will silently discard them.\n'
    );
  }
}

process.exit(results.every((r) => r.clean) ? 0 : 1);
