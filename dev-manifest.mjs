// Dev-only: regenerates the gitignored live module.json from module-template.json.
//
// The tracked template must stay in upstream release shape (esmodules: dist/main.js,
// #{VERSION}#/#{DOWNLOAD}# placeholders substituted by .github/workflows/main.yml) —
// this script applies the dev-checkout differences instead of baking them into the
// template: the cache-busting dev-loader entry and a sentinel version that satisfies
// any minimum-version interop checks.
//
// Runs automatically as part of `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root = path.dirname(url.fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'module-template.json'), 'utf8'));

manifest.version = '999.0.0';
manifest.download = '';
manifest.esmodules = ['dev-loader.mjs'];

fs.writeFileSync(path.join(root, 'module.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('dev-manifest: module.json regenerated from module-template.json (dev-loader, v999.0.0)');
