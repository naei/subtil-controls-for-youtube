'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const archiveName = 'subtil-controls-for-youtube.zip';
const archivePath = path.join(projectRoot, archiveName);
const extensionFiles = ['manifest.json', 'src', 'icons', 'README.md'];

function runZip(arguments_) {
  const result = spawnSync('zip', arguments_, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error('The system "zip" command is required to package the extension.');
    } else {
      console.error(result.error.message);
    }
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status || 1);
}

const mode = fs.existsSync(archivePath) ? '-FSr' : '-r';
runZip([mode, archiveName, ...extensionFiles]);
runZip(['-T', archiveName]);

console.log(`Extension package created: ${archivePath}`);
