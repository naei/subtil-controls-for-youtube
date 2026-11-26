'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/core.js');

const projectRoot = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(projectRoot, 'src/locales')).filter((name) => name.endsWith('.js'));
for (const name of files) require(`../src/locales/${name}`);
const locales = globalThis.__YOUTUBE_NO_VIDEO_LOCALES__;

test('every locale file is loaded by the manifest before content.js', () => {
  const scripts = require('../manifest.json').content_scripts[0].js;
  for (const name of files) {
    const index = scripts.indexOf(`src/locales/${name}`);
    assert.ok(index !== -1, `${name} is missing from manifest.json`);
    assert.ok(index < scripts.indexOf('src/content.js'), `${name} must load before content.js`);
  }
});

test('every locale registers under its file name with the same keys as en', () => {
  const reference = Object.keys(locales.en).sort();
  for (const name of files) {
    const code = path.basename(name, '.js');
    assert.ok(locales[code], `${name} must register the "${code}" locale`);
    assert.deepEqual(Object.keys(locales[code]).sort(), reference, `${name} keys differ from en.js`);
    for (const [key, value] of Object.entries(locales[code])) {
      assert.ok(typeof value === 'string' && value.trim(), `${name}: "${key}" must be a non-empty string`);
    }
  }
});

// The Chrome Web Store lists a language only if _locales/<code>/messages.json exists.
test('every locale has a store description in _locales', () => {
  for (const name of files) {
    const [language, region] = path.basename(name, '.js').split('-');
    const folder = region ? `${language}_${region.toUpperCase()}` : language;
    const messages = require(`../_locales/${folder}/messages.json`);
    const description = messages.extDescription && messages.extDescription.message;
    assert.ok(description && description.trim(), `_locales/${folder}: extDescription is missing`);
    assert.ok(description.length <= 132, `_locales/${folder}: description exceeds the store limit of 132 characters`);
  }
});

test('resolves the YouTube language to exact, base, then English messages', () => {
  const sample = { en: 'en', fr: 'fr', 'pt-br': 'pt-br' };
  assert.equal(Core.resolveLocale(sample, 'fr-FR'), 'fr');
  assert.equal(Core.resolveLocale(sample, 'pt-BR'), 'pt-br');
  assert.equal(Core.resolveLocale(sample, 'de'), 'en');
  assert.equal(Core.resolveLocale(sample, ''), 'en');
  assert.equal(Core.resolveLocale(locales, 'es-419'), locales.es);
});

test('every popup message key exists in the reference locale', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'src/popup.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 0, 'popup.html should declare data-i18n keys');
  for (const key of keys) assert.ok(locales.en[key], `popup.html uses unknown key "${key}"`);
});
