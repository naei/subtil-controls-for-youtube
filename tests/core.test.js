'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');

test('extracts only valid YouTube video IDs', () => {
  assert.equal(Core.getVideoId('https://www.youtube.com/watch?v=pcTx4lYk1_0&t=42'), 'pcTx4lYk1_0');
  assert.equal(Core.getVideoId('https://www.youtube.com/embed/pcTx4lYk1_0'), 'pcTx4lYk1_0');
  assert.equal(Core.getVideoId('https://www.youtube.com/shorts/pcTx4lYk1_0'), 'pcTx4lYk1_0');
  assert.equal(Core.getVideoId('https://www.youtube.com/watch?v=too-short'), null);
  assert.equal(Core.getVideoId('not a URL'), null);
});

test('limits the interface to watch pages', () => {
  assert.equal(Core.isSupportedWatchUrl('https://www.youtube.com/watch?v=pcTx4lYk1_0'), true);
  assert.equal(Core.isSupportedWatchUrl('https://www.youtube.com/shorts/pcTx4lYk1_0'), false);
  assert.equal(Core.isSupportedWatchUrl('https://m.youtube.com/watch?v=pcTx4lYk1_0'), false);
});

test('sorts thumbnails by area, removes duplicates, and adds lower-resolution fallbacks', () => {
  const response = {
    videoDetails: {
      thumbnail: {
        thumbnails: [
          { url: 'small.jpg', width: 120, height: 90 },
          { url: 'large.jpg', width: 1280, height: 720 },
          { url: 'large.jpg', width: 1920, height: 1080 },
        ],
      },
    },
  };
  const candidates = Core.getThumbnailCandidates(response, 'pcTx4lYk1_0');

  assert.equal(candidates[0], 'https://i.ytimg.com/vi/pcTx4lYk1_0/maxresdefault.jpg');
  assert.equal(candidates.filter((url) => url === 'large.jpg').length, 1);
  assert.ok(candidates.indexOf('large.jpg') < candidates.indexOf('small.jpg'));
  assert.ok(
    candidates.indexOf('https://i.ytimg.com/vi/pcTx4lYk1_0/hqdefault.jpg')
      < candidates.indexOf('small.jpg'),
  );
  assert.ok(candidates.includes('https://i.ytimg.com/vi/pcTx4lYk1_0/mqdefault.jpg'));
  assert.equal(candidates.at(-1), 'https://i.ytimg.com/vi/pcTx4lYk1_0/default.jpg');
});

test('rejects missing-resolution placeholders while accepting real thumbnail sizes', () => {
  assert.equal(Core.isThumbnailCandidateUsable(
    'https://i.ytimg.com/vi/pcTx4lYk1_0/maxresdefault.jpg',
    120,
    90,
  ), false);
  assert.equal(Core.isThumbnailCandidateUsable(
    'https://i.ytimg.com/vi/pcTx4lYk1_0/maxresdefault.jpg',
    1280,
    720,
  ), true);
  assert.equal(Core.isThumbnailCandidateUsable(
    'https://i.ytimg.com/vi/pcTx4lYk1_0/sddefault.jpg',
    640,
    480,
  ), true);
  assert.equal(Core.isThumbnailCandidateUsable(
    'https://i.ytimg.com/vi/pcTx4lYk1_0/default.jpg',
    120,
    90,
  ), true);
  assert.equal(Core.isThumbnailCandidateUsable('https://example.com/custom.jpg', 1, 1), true);
  assert.equal(Core.isThumbnailCandidateUsable('https://example.com/custom.jpg', 0, 0), false);
});

test('detects adaptive audio streams and distinguishes active live streams from replays', () => {
  assert.equal(Core.hasAudioRepresentation({
    streamingData: { adaptiveFormats: [{ mimeType: 'audio/webm; codecs="opus"' }] },
  }), true);
  assert.equal(Core.hasAudioRepresentation({
    streamingData: { adaptiveFormats: [{ mimeType: 'video/webm; codecs="vp9"' }] },
  }), false);
  assert.equal(Core.isActiveLiveContent({ videoDetails: { isLive: true } }), true);
  assert.equal(Core.isActiveLiveContent({ videoDetails: { isUpcoming: true } }), true);
  assert.equal(Core.isActiveLiveContent({
    videoDetails: { isLiveContent: true, lengthSeconds: '0' },
    microformat: {
      playerMicroformatRenderer: {
        liveBroadcastDetails: { isLiveNow: true },
      },
    },
  }), true);
  assert.equal(Core.isActiveLiveContent({
    videoDetails: { isLiveContent: true, lengthSeconds: '798' },
    microformat: {
      playerMicroformatRenderer: {
        liveBroadcastDetails: {
          isLiveNow: false,
          endTimestamp: '2026-08-26T18:46:08+00:00',
        },
      },
    },
  }), false);
  assert.equal(Core.isActiveLiveContent({ videoDetails: { isLiveContent: false } }), false);
});

test('builds audio arguments without modifying the source configuration', () => {
  const baseArgs = { autoplay: '0', player_response: 'old', untouched: 'yes' };
  const response = { videoDetails: { videoId: 'pcTx4lYk1_0' } };
  const snapshot = {
    playing: true,
    time: 87.25,
    videoId: 'pcTx4lYk1_0',
  };
  const args = Core.buildPlayerArgs(baseArgs, response, snapshot, true);

  assert.deepEqual(baseArgs, { autoplay: '0', player_response: 'old', untouched: 'yes' });
  assert.equal(args.player_response, undefined);
  assert.equal(args.raw_player_response, response);
  assert.equal(args.video_id, 'pcTx4lYk1_0');
  assert.equal(args.start, 87.25);
  assert.equal(args.start_seconds, 87.25);
  assert.equal(args.autoplay, '1');
  assert.equal(args.audio_only, '1');
});

test('clones the context without modifying YouTube\'s source object', () => {
  const baseContext = { rootElementId: 'movie_player', deviceIsAudioOnly: false, marker: 1 };
  const audioContext = Core.buildAudioContext(baseContext, 'ynv-audio-player');

  assert.deepEqual(baseContext, { rootElementId: 'movie_player', deviceIsAudioOnly: false, marker: 1 });
  assert.equal(audioContext.rootElementId, 'ynv-audio-player');
  assert.equal(audioContext.deviceIsAudioOnly, true);
  assert.equal(audioContext.showMiniplayerButton, false);
});

test('captures and clamps playback state', () => {
  const media = { currentTime: 10, muted: false, paused: true, ended: false, playbackRate: 1, volume: 1 };
  const player = {
    querySelector: () => media,
    getCurrentTime: () => 41.5,
    getPlaybackRate: () => 12,
    getPlayerState: () => 1,
    getVolume: () => 140,
    isMuted: () => true,
  };

  assert.deepEqual(Core.snapshotPlayback(player, 'pcTx4lYk1_0'), {
    muted: true,
    playing: true,
    playbackRate: 4,
    time: 41.5,
    videoId: 'pcTx4lYk1_0',
    volume: 100,
  });
});

test('keeps the player\'s static visual classes', () => {
  const copied = Core.copyPlayerClasses('html5-video-player playing-mode ytp-modern-caption ad-showing');
  assert.equal(copied.includes('playing-mode'), false);
  assert.equal(copied.includes('ad-showing'), false);
  assert.equal(copied.includes('ytp-modern-caption'), true);
  assert.equal(copied.includes('ynv-audio-player'), true);
});
