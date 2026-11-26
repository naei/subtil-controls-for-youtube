'use strict';

// Run by the npm "version" lifecycle: copies the new package.json version into manifest.json.
const fs = require('node:fs');
const path = require('node:path');

const manifestPath = path.resolve(__dirname, '../manifest.json');
const { version } = require('../package.json');
const manifest = fs.readFileSync(manifestPath, 'utf8');
const updated = manifest.replace(/("version":\s*")[^"]+/, `$1${version}`);
if (!updated.includes(`"version": "${version}"`)) throw new Error('No "version" field found in manifest.json');
fs.writeFileSync(manifestPath, updated);
console.log(`manifest.json: ${version}`);
