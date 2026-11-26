'use strict';

// Asks which part of the version to bump, then lets "npm version" do the work.
// An argument skips the question: npm run bump minor
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');

const [major, minor, patch] = require('../package.json').version.split('.').map(Number);
const choices = [
  ['patch', `${major}.${minor}.${patch + 1}`],
  ['minor', `${major}.${minor + 1}.0`],
  ['major', `${major + 1}.0.0`],
];

async function ask() {
  console.log(`Current version: ${major}.${minor}.${patch}`);
  choices.forEach(([type, next], index) => console.log(`  ${index + 1}) ${type}  ${next}`));
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await prompt.question('Bump [1-3, empty to cancel]: ')).trim().toLowerCase();
  prompt.close();
  const choice = choices[Number(answer) - 1] || choices.find(([type]) => type === answer);
  if (!choice) {
    console.log('Cancelled, version unchanged.');
    process.exit(answer ? 1 : 0);
  }
  return choice[0];
}

(async () => {
  const type = process.argv[2] || await ask();
  const result = spawnSync('npm', ['version', type, '--no-git-tag-version'], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
})();
