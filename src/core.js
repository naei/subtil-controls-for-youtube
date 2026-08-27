(function exposeCore(root, factory) {
  const core = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = core;
    return;
  }

  Object.defineProperty(root, '__YOUTUBE_NO_VIDEO_CORE__', {
    configurable: true,
    value: core,
  });
})(typeof globalThis === 'object' ? globalThis : this, function createCore() {
  'use strict';

  const VIDEO_ID_PATTERN = /^[\w-]{11}$/;
  const TRANSIENT_PLAYER_CLASSES = new Set([
    'ad-created',
    'ad-interrupting',
    'ad-showing',
    'buffering-mode',
    'ended-mode',
    'playing-mode',
    'paused-mode',
    'unstarted-mode',
    'ytp-autohide',
    'ytp-fullscreen',
  ]);

  function clamp(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return minimum;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function getVideoId(urlLike) {
    let url;
    try {
      url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
    } catch (_error) {
      return null;
    }

    let candidate = null;
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})(?:\/|$)/);
      candidate = match ? match[1] : null;
    }

    return candidate && VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
  }

  function isSupportedWatchUrl(urlLike) {
    try {
      const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike));
      return url.hostname === 'www.youtube.com' && url.pathname === '/watch' && Boolean(getVideoId(url));
    } catch (_error) {
      return false;
    }
  }

  function getThumbnailCandidates(playerResponse, videoId) {
    const details = playerResponse && playerResponse.videoDetails;
    const microformat = playerResponse
      && playerResponse.microformat
      && playerResponse.microformat.playerMicroformatRenderer;
    const candidates = [];

    for (const source of [
      details && details.thumbnail && details.thumbnail.thumbnails,
      microformat && microformat.thumbnail && microformat.thumbnail.thumbnails,
    ]) {
      if (!Array.isArray(source)) continue;
      for (const thumbnail of source) {
        if (!thumbnail || typeof thumbnail.url !== 'string') continue;
        candidates.push({
          area: Number(thumbnail.width || 0) * Number(thumbnail.height || 0),
          url: thumbnail.url,
        });
      }
    }

    if (videoId && VIDEO_ID_PATTERN.test(videoId)) {
      candidates.push(
        { area: 3840 * 2160, url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` },
        { area: 640 * 480, url: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg` },
        { area: 480 * 360, url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
        { area: 320 * 180, url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` },
        { area: 120 * 90, url: `https://i.ytimg.com/vi/${videoId}/default.jpg` },
      );
    }

    const seen = new Set();
    return candidates
      .sort((left, right) => right.area - left.area)
      .map((candidate) => candidate.url)
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
  }

  function isThumbnailCandidateUsable(url, naturalWidth, naturalHeight) {
    const width = Number(naturalWidth) || 0;
    const height = Number(naturalHeight) || 0;
    if (width < 1 || height < 1) return false;

    let pathname = '';
    try {
      pathname = new URL(String(url), 'https://www.youtube.com').pathname;
    } catch (_error) {
      return false;
    }

    const filename = pathname.match(
      /\/(maxresdefault|sddefault|hqdefault|mqdefault|default)\.(?:jpg|webp)$/,
    );
    if (!filename) return true;

    const minimumDimensions = {
      maxresdefault: [640, 360],
      sddefault: [480, 360],
      hqdefault: [320, 180],
      mqdefault: [200, 110],
      default: [90, 60],
    };
    const [minimumWidth, minimumHeight] = minimumDimensions[filename[1]];
    return width >= minimumWidth && height >= minimumHeight;
  }

  function hasAudioRepresentation(playerResponse) {
    const formats = playerResponse
      && playerResponse.streamingData
      && playerResponse.streamingData.adaptiveFormats;
    return Array.isArray(formats)
      && formats.some((format) => typeof format.mimeType === 'string' && format.mimeType.startsWith('audio/'));
  }

  function isActiveLiveContent(playerResponse) {
    if (!playerResponse) return false;
    const details = playerResponse.videoDetails || {};
    const microformat = playerResponse.microformat && playerResponse.microformat.playerMicroformatRenderer;
    const liveDetails = (microformat && microformat.liveBroadcastDetails) || {};
    const hasZeroDuration = Number(details.lengthSeconds) === 0;

    return Boolean(
      details.isLive === true
      || details.isUpcoming === true
      || liveDetails.isLiveNow === true
      || (
        details.isLiveContent === true
        && hasZeroDuration
        && !liveDetails.endTimestamp
      ),
    );
  }

  function snapshotPlayback(player, videoId) {
    const media = player && player.querySelector ? player.querySelector('video') : null;
    const playerState = safeCall(player, 'getPlayerState', -1);
    const time = safeCall(player, 'getCurrentTime', media ? media.currentTime : 0);

    return {
      muted: Boolean(safeCall(player, 'isMuted', media ? media.muted : false)),
      playing: playerState === 1 || Boolean(media && !media.paused && !media.ended),
      playbackRate: clamp(safeCall(player, 'getPlaybackRate', media ? media.playbackRate : 1), 0.25, 4),
      time: Math.max(0, Number(time) || 0),
      videoId,
      volume: clamp(safeCall(player, 'getVolume', media ? media.volume * 100 : 100), 0, 100),
    };
  }

  function buildPlayerArgs(baseArgs, playerResponse, snapshot, audioOnly) {
    const args = Object.assign({}, baseArgs || {});
    const start = Math.max(0, Number(snapshot.time) || 0);

    delete args.player_response;
    args.raw_player_response = playerResponse;
    args.video_id = snapshot.videoId;
    args.start = start;
    args.start_seconds = start;
    args.autoplay = snapshot.playing ? '1' : '0';
    args.audio_only = audioOnly ? '1' : '0';
    args.controls = '1';

    return args;
  }

  function buildAudioContext(baseContext, rootElementId) {
    return Object.assign({}, baseContext || {}, {
      deviceIsAudioOnly: true,
      rootElementId,
      showMiniplayerButton: false,
    });
  }

  function copyPlayerClasses(className) {
    const classes = String(className || '')
      .split(/\s+/)
      .filter(Boolean)
      .filter((name) => !TRANSIENT_PLAYER_CLASSES.has(name));

    if (!classes.includes('html5-video-player')) classes.unshift('html5-video-player');
    if (!classes.includes('ynv-audio-player')) classes.push('ynv-audio-player');
    return classes.join(' ');
  }

  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    const tagName = target.tagName && target.tagName.toLowerCase();
    return Boolean(
      target.isContentEditable
      || tagName === 'input'
      || tagName === 'textarea'
      || tagName === 'select',
    );
  }

  function safeCall(object, method, fallback) {
    try {
      return object && typeof object[method] === 'function' ? object[method]() : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  return Object.freeze({
    buildAudioContext,
    buildPlayerArgs,
    clamp,
    copyPlayerClasses,
    getThumbnailCandidates,
    getVideoId,
    hasAudioRepresentation,
    isEditableTarget,
    isActiveLiveContent,
    isSupportedWatchUrl,
    isThumbnailCandidateUsable,
    safeCall,
    snapshotPlayback,
  });
});
