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
    assert.equal(await page.locator('#ynv-audio-player .ynv-preview__playback').count(), 0);

    const iconState = await page.evaluate(() => {
      const root = document.querySelector('#ynv-audio-player');
      const button = root.querySelector('[data-ynv-toggle]');
      const icon = button && button.querySelector('.ynv-video-icon');
      const cameraBody = icon && icon.querySelector('rect');
      const slash = icon && icon.querySelector('.ynv-icon-slash');
      const slashBackdrop = icon && icon.querySelector('.ynv-icon-slash-backdrop');
      const nativeIcon = root.querySelector('.ytp-subtitles-button svg');
      const iconRect = icon && icon.getBoundingClientRect();
      const nativeRect = nativeIcon && nativeIcon.getBoundingClientRect();
      return {
        cameraFill: cameraBody && getComputedStyle(cameraBody).fill,
        height: iconRect && iconRect.height,
        nativeHeight: nativeRect && nativeRect.height,
        nativeWidth: nativeRect && nativeRect.width,
        slashBackdropStroke: slashBackdrop && getComputedStyle(slashBackdrop).stroke,
        slashStroke: slash && getComputedStyle(slash).stroke,
        viewBox: icon && icon.getAttribute('viewBox'),
        width: iconRect && iconRect.width,
      };
    });
    assert.equal(iconState.viewBox, '0 0 24 24');
    assert.ok(
      Math.abs(iconState.width - iconState.nativeWidth) < 0.5,
      `Extension icon should match native width: ${JSON.stringify(iconState)}`,
    );
    assert.ok(
      Math.abs(iconState.height - iconState.nativeHeight) < 0.5,
      `Extension icon should match native height: ${JSON.stringify(iconState)}`,
    );
    assert.equal(iconState.cameraFill, 'rgb(255, 255, 255)');
    assert.equal(iconState.slashStroke, 'rgb(255, 0, 51)');
    assert.notEqual(iconState.slashBackdropStroke, 'none');

    const inspectNativePlaybackFeedback = () => page.evaluate(() => {
      const root = document.querySelector('#ynv-audio-player');
      const audio = root && root.querySelector('audio');
      const preview = root && root.querySelector('.ynv-preview');
      const bezel = root && root.querySelector('.ytp-bezel');
      const icon = bezel && bezel.querySelector('.ytp-bezel-icon');
      const previewStyle = preview && getComputedStyle(preview);
      const bezelStyle = bezel && getComputedStyle(bezel);
      const bezelRect = bezel && bezel.getBoundingClientRect();
      const iconRect = icon && icon.getBoundingClientRect();
      return {
        bezelDisplay: bezelStyle && bezelStyle.display,
        bezelHeight: bezelRect && bezelRect.height,
        bezelOpacity: bezelStyle && bezelStyle.opacity,
        bezelVisibility: bezelStyle && bezelStyle.visibility,
        bezelWidth: bezelRect && bezelRect.width,
        bezelZIndex: bezelStyle && bezelStyle.zIndex,
        iconHeight: iconRect && iconRect.height,
        iconWidth: iconRect && iconRect.width,
        paused: audio && audio.paused,
        previewPointerEvents: previewStyle && previewStyle.pointerEvents,
        previewZIndex: previewStyle && previewStyle.zIndex,
      };
    });

    const assertNativePlaybackFeedback = (feedback) => {
      assert.equal(feedback.previewPointerEvents, 'none');
      assert.equal(feedback.bezelDisplay, 'block');
      assert.equal(feedback.bezelVisibility, 'visible');
      assert.ok(Number(feedback.bezelOpacity) > 0.1, 'YouTube playback feedback should be visible');
      assert.ok(feedback.bezelWidth > 50 && feedback.bezelHeight > 50);
      assert.ok(feedback.iconWidth > 30 && feedback.iconHeight > 30);
      assert.ok(Number(feedback.bezelZIndex) > Number(feedback.previewZIndex));
    };

    const playbackSurfaceRect = await page.locator('#ynv-audio-player').boundingBox();
    await page.mouse.click(playbackSurfaceRect.x + 180, playbackSurfaceRect.y + 180);
    await page.waitForTimeout(80);
    assertNativePlaybackFeedback(await inspectNativePlaybackFeedback());
    await page.waitForTimeout(260);
    await page.waitForFunction(() => document.querySelector('#ynv-audio-player audio').paused);

    await page.mouse.click(playbackSurfaceRect.x + 180, playbackSurfaceRect.y + 180);
    await page.waitForTimeout(80);
    assertNativePlaybackFeedback(await inspectNativePlaybackFeedback());
    await page.waitForTimeout(260);
    await page.waitForFunction(() => !document.querySelector('#ynv-audio-player audio').paused);

    await page.evaluate(() => {
      const root = document.querySelector('#ynv-audio-player');
      root.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, { capture: true, once: true });
    });
    await page.mouse.click(playbackSurfaceRect.x + 180, playbackSurfaceRect.y + 180);
    await page.waitForFunction(() => document.querySelector('#ynv-audio-player audio').paused);

    await page.mouse.click(playbackSurfaceRect.x + 180, playbackSurfaceRect.y + 180);
    await page.waitForFunction(() => !document.querySelector('#ynv-audio-player audio').paused);

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

    const inspectLayout = () => page.evaluate(() => {
      const flexy = document.querySelector('ytd-watch-flexy');
      const audioRoot = document.querySelector('#ynv-audio-player');
      const rightControls = audioRoot && audioRoot.querySelector('.ytp-right-controls');
      const engine = audioRoot && audioRoot.querySelector('#ynv-audio-engine');
      const chromeBottom = audioRoot && audioRoot.querySelector('.ytp-chrome-bottom');
      const progressBar = audioRoot && audioRoot.querySelector('.ytp-progress-bar-container');
      const button = rightControls && rightControls.querySelector('[data-ynv-toggle]');
      const rightStyle = rightControls && getComputedStyle(rightControls);
      return {
        audioRootRect: audioRoot && audioRoot.getBoundingClientRect().toJSON(),
        buttonConnected: Boolean(button && button.isConnected),
        chromeBottomRect: chromeBottom && chromeBottom.getBoundingClientRect().toJSON(),
        engineRect: engine && engine.getBoundingClientRect().toJSON(),
        fullscreen: Boolean(document.fullscreenElement),
        fullscreenElementId: document.fullscreenElement && document.fullscreenElement.id,
        progressBarRect: progressBar && progressBar.getBoundingClientRect().toJSON(),
        rightControlsDisplay: rightStyle && rightStyle.display,
        rightControlsOpacity: rightStyle && rightStyle.opacity,
        rightControlsRect: rightControls && rightControls.getBoundingClientRect().toJSON(),
        theater: Boolean(flexy && flexy.hasAttribute('theater')),
        theaterRequested: Boolean(flexy && flexy.hasAttribute('theater-requested_')),
      };
    });

    const waitForResponsiveLayout = () => page.waitForFunction(() => {
      const root = document.querySelector('#ynv-audio-player');
      const chromeBottom = root && root.querySelector('.ytp-chrome-bottom');
      const progressBar = root && root.querySelector('.ytp-progress-bar-container');
      const rightControls = root && root.querySelector('.ytp-right-controls');
      if (!root || !chromeBottom || !progressBar || !rightControls) return false;

      const rootRect = root.getBoundingClientRect();
      const chromeRect = chromeBottom.getBoundingClientRect();
      const progressRect = progressBar.getBoundingClientRect();
      const rightRect = rightControls.getBoundingClientRect();
      return Math.abs(chromeRect.width - (rootRect.width - 24)) < 2
        && Math.abs(chromeRect.right - (rootRect.right - 12)) < 2
        && Math.abs(progressRect.width - chromeRect.width) < 2
        && Math.abs(rightRect.right - chromeRect.right) < 2;
    }, null, { timeout: 4000 });

    const assertResponsiveLayout = (layout, label) => {
      assert.ok(layout.audioRootRect, `${label}: audio root should exist`);
      assert.ok(layout.chromeBottomRect, `${label}: control bar should exist`);
      assert.ok(layout.progressBarRect, `${label}: progress bar should exist`);
      assert.ok(layout.rightControlsRect, `${label}: right controls should exist`);
      assert.ok(
        Math.abs(layout.chromeBottomRect.width - (layout.audioRootRect.width - 24)) < 2,
        `${label}: control bar should match the player width`,
      );
      assert.ok(
        Math.abs(layout.chromeBottomRect.right - (layout.audioRootRect.right - 12)) < 2,
        `${label}: control bar should stay aligned to the player's right edge`,
      );
      assert.ok(
        Math.abs(layout.progressBarRect.width - layout.chromeBottomRect.width) < 2,
        `${label}: progress bar should match the control bar width`,
      );
      assert.ok(
        Math.abs(layout.rightControlsRect.right - layout.chromeBottomRect.right) < 2,
        `${label}: right controls should remain inside the control bar`,
      );
      assert.equal(layout.buttonConnected, true, `${label}: extension button should remain connected`);
      assert.equal(layout.rightControlsDisplay, 'flex', `${label}: right controls should remain visible`);
    };

    await waitForResponsiveLayout();
    const layoutBefore = await inspectLayout();
    assertResponsiveLayout(layoutBefore, 'Classic mode');
    await page.locator('#ynv-audio-player .ytp-size-button').click();
    await page.waitForFunction(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
    await waitForResponsiveLayout();
    const layoutAfterTheater = await inspectLayout();
    assert.equal(layoutAfterTheater.theater, true);
    assert.ok(layoutAfterTheater.audioRootRect.width > layoutBefore.audioRootRect.width);
    assertResponsiveLayout(layoutAfterTheater, 'Theater mode');

    await page.locator('#ynv-audio-player .ytp-size-button').click();
    await page.waitForFunction(() => !document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
    await waitForResponsiveLayout();
    const layoutAfterTheaterExit = await inspectLayout();
    assert.equal(layoutAfterTheaterExit.theater, false);
    assertResponsiveLayout(layoutAfterTheaterExit, 'Classic mode after theater');

    await page.locator('#ynv-audio-player .ytp-fullscreen-button').click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await waitForResponsiveLayout();
    const layoutInFullscreen = await inspectLayout();
    assert.equal(layoutInFullscreen.fullscreen, true);
    assertResponsiveLayout(layoutInFullscreen, 'Fullscreen mode');
    await page.locator('#ynv-audio-player .ytp-fullscreen-button').click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForFunction(() => {
      const root = document.querySelector('#ynv-audio-player');
      return root && root.getBoundingClientRect().width < window.innerWidth - 100;
    });
    await waitForResponsiveLayout();
    const layoutAfterFullscreenExit = await inspectLayout();
    assert.equal(layoutAfterFullscreenExit.fullscreen, false);
    assertResponsiveLayout(layoutAfterFullscreenExit, 'Classic mode after fullscreen');

    await page.locator('#ynv-audio-player .ytp-size-button').click();
    await page.waitForFunction(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
    await waitForResponsiveLayout();

    await page.waitForTimeout(8000);
    await page.mouse.move(40, 40);
    await page.locator('#ynv-audio-engine').hover({ position: { x: 680, y: 480 } });
    await page.waitForTimeout(350);
    const layoutAfterIdle = await inspectLayout();
    assert.equal(layoutAfterIdle.theater, true);
    assertResponsiveLayout(layoutAfterIdle, 'Theater mode after idle');

    await page.screenshot({ path: path.join(os.tmpdir(), 'ynv-audio-mode.png'), fullPage: false });
    await page.evaluate(() => document.querySelector('#ynv-audio-player .ytp-right-controls').remove());
    await page.locator('#ynv-audio-player > .ynv-fallback-button').waitFor({
      state: 'visible',
      timeout: 4000,
    });
    const fallbackVisible = await page.locator('#ynv-audio-player > .ynv-fallback-button').isVisible();
    assert.equal(fallbackVisible, true);

    await page.locator('#ynv-audio-player > .ynv-fallback-button').click();
    await page.waitForFunction(() => document.documentElement.getAttribute('data-ynv-mode') === 'video', null, {
      timeout: 18000,
    });

    const restoredState = await inspect(page);
    assert.equal(restoredState.mode, 'video');
    assert.equal(restoredState.audioRoot, false);
    assert.equal(restoredState.originalButtonLabel, 'Turn off video stream');
    assert.ok(restoredState.originalVideo.readyState >= 2);

    console.log(JSON.stringify({
      audioState,
      controlState,
      iconState,
      layoutBefore,
      layoutAfterTheater,
      layoutAfterTheaterExit,
      layoutInFullscreen,
      layoutAfterFullscreenExit,
      layoutAfterIdle,
      fallbackVisible,
      restoredState,
    }, null, 2));
  } finally {
    await context.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
