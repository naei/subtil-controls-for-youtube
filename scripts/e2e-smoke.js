'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const playwrightPath = process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core';
const { chromium } = require(playwrightPath);

const extensionPath = path.resolve(__dirname, '..');
const chromePath = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const referenceUrl = process.env.YOUTUBE_TEST_URL
  || 'https://www.youtube.com/watch?v=pcTx4lYk1_0';
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ynv-e2e-'));

async function inspect(page) {
  return page.evaluate(() => {
    const original = document.querySelector('#movie_player');
    const audioRoot = document.querySelector('#ynv-audio-player');
    const video = original && original.querySelector('video');
    const audio = audioRoot && audioRoot.querySelector('audio');

    return {
      activeButton: Boolean(audioRoot && audioRoot.querySelector('[data-ynv-toggle][aria-pressed="true"]')),
      audioButtonLabel: audioRoot
        && audioRoot.querySelector('[data-ynv-toggle]')
        && audioRoot.querySelector('[data-ynv-toggle]').getAttribute('aria-label'),
      audio: audio && {
        currentTime: audio.currentTime,
        paused: audio.paused,
        readyState: audio.readyState,
      },
      audioHasVideo: Boolean(audioRoot && audioRoot.querySelector('video')),
      audioEngine: Boolean(audioRoot && audioRoot.querySelector('#ynv-audio-engine')),
      audioRoot: Boolean(audioRoot),
      audioRootCount: document.querySelectorAll('#ynv-audio-player').length,
      mode: document.documentElement.getAttribute('data-ynv-mode'),
      originalButtonLabel: original
        && original.querySelector('[data-ynv-toggle]')
        && original.querySelector('[data-ynv-toggle]').getAttribute('aria-label'),
      originalVideo: video && {
        currentTime: video.currentTime,
        paused: video.paused,
        readyState: video.readyState,
      },
      preview: Boolean(audioRoot && audioRoot.querySelector('.ynv-preview__image')),
      previewLabel: audioRoot
        && audioRoot.querySelector('.ynv-preview__badge span')
        && audioRoot.querySelector('.ynv-preview__badge span').textContent,
    };
  });
}

(async () => {
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: chromePath,
    headless: process.env.HEADLESS !== '0',
    ignoreDefaultArgs: ['--disable-extensions'],
    locale: 'en-US',
    viewport: { width: 1440, height: 960 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    const pages = context.pages();
    const page = pages[0] || await context.newPage();
    await page.goto(referenceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    const rejectConsent = page
      .locator('ytd-consent-bump-v2-lightbox button')
      .filter({ hasText: /Tout refuser|Reject all/i })
      .first();
    const consentVisible = await rejectConsent
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true, () => false);
    if (consentVisible) {
      await rejectConsent.click();
      await page.locator('ytd-consent-bump-v2-lightbox').waitFor({ state: 'hidden', timeout: 8000 });
    }

    await page.waitForSelector('#movie_player [data-ynv-toggle]', { timeout: 30000 });

    const originalPlayButton = page.locator('#movie_player .ytp-play-button');
    const originalPaused = await page.evaluate(() => document.querySelector('#movie_player video').paused);
    if (originalPaused) await originalPlayButton.click();
    await page.evaluate(() => document.querySelector('#movie_player').playVideo());
    await page.waitForFunction(() => !document.querySelector('#movie_player video').paused, null, {
      timeout: 6000,
    });
    await page.waitForTimeout(1200);

    await page.locator('#movie_player [data-ynv-toggle]').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ynv-mode') === 'audio', null, {
      timeout: 15000,
    });

    const audioState = await inspect(page);
    assert.equal(audioState.mode, 'audio');
    assert.equal(audioState.audioRoot, true);
    assert.equal(audioState.audioRootCount, 1);
    assert.equal(audioState.audioEngine, true);
    assert.equal(audioState.activeButton, true);
    assert.equal(audioState.audioButtonLabel, 'Restore video stream');
    assert.equal(audioState.preview, true);
    assert.equal(audioState.previewLabel, 'Audio only');
    assert.equal(audioState.audioHasVideo, false);
    assert.ok(audioState.audio && audioState.audio.readyState >= 2);
    assert.equal(audioState.audio.paused, false);
    assert.equal(audioState.originalVideo.readyState, 0);

    const audioTime = audioState.audio.currentTime;
    await page.waitForTimeout(1800);
    const advancedState = await inspect(page);
    assert.ok(advancedState.audio.currentTime > audioTime + 0.7, 'Audio playback time should continue advancing');

    await page.locator('#ynv-audio-engine').hover({ position: { x: 700, y: 500 } });
    await page.waitForTimeout(350);
    const controlState = await page.evaluate(() => {
      const root = document.querySelector('#ynv-audio-player');
      const controls = root && root.querySelector('.ytp-chrome-bottom');
      const button = root && root.querySelector('[data-ynv-toggle]');
      const controlsStyle = controls && getComputedStyle(controls);
      const buttonStyle = button && getComputedStyle(button);
      return {
        buttonOpacity: buttonStyle && buttonStyle.opacity,
        buttonRect: button && button.getBoundingClientRect().toJSON(),
        controlsOpacity: controlsStyle && controlsStyle.opacity,
        controlsVisibility: controlsStyle && controlsStyle.visibility,
        hovered: Boolean(root && root.matches(':hover')),
      };
    });
    assert.equal(controlState.hovered, true);
    assert.ok(
      Number(controlState.controlsOpacity) > 0.5,
      `Controls should be visible on hover: ${JSON.stringify(controlState)}`,
    );
    await page.screenshot({ path: path.join(os.tmpdir(), 'ynv-audio-mode.png'), fullPage: false });
    await page.locator('#ynv-audio-player [data-ynv-toggle]').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ynv-mode') === 'video', null, {
      timeout: 18000,
    });

    const restoredState = await inspect(page);
    assert.equal(restoredState.mode, 'video');
    assert.equal(restoredState.audioRoot, false);
    assert.equal(restoredState.originalButtonLabel, 'Turn off video stream');
    assert.ok(restoredState.originalVideo.readyState >= 2);

    console.log(JSON.stringify({ audioState, controlState, restoredState }, null, 2));
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
