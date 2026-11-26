'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(projectRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert.equal(manifest.manifest_version, 3, 'manifest_version must be 3');
assert.equal(manifest.version, require('../package.json').version, 'manifest.json and package.json versions differ: use "npm run bump"');
assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts is required');
assert.equal(manifest.content_scripts[0].world, 'MAIN', 'The script must access the YouTube player in MAIN');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.permissions, undefined, 'No global Chrome permissions should be requested');
assert.equal(manifest.host_permissions, undefined, 'No additional host permissions should be requested');

const referencedFiles = [
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])]),
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ...(manifest.action && manifest.action.default_popup ? [manifest.action.default_popup] : []),
];

for (const relativePath of new Set(referencedFiles)) {
  const absolutePath = path.join(projectRoot, relativePath);
  assert.ok(fs.existsSync(absolutePath), `Missing manifest file: ${relativePath}`);
}

for (const relativePath of manifest.content_scripts[0].js) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  new vm.Script(source, { filename: relativePath });
}

for (const [declaredSize, relativePath] of Object.entries(manifest.icons)) {
  const data = fs.readFileSync(path.join(projectRoot, relativePath));
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', `${relativePath} is not a PNG file`);
  assert.equal(data.readUInt32BE(16), Number(declaredSize), `Incorrect width for ${relativePath}`);
  assert.equal(data.readUInt32BE(20), Number(declaredSize), `Incorrect height for ${relativePath}`);
}

console.log('Manifest, scripts, and icons: OK');
