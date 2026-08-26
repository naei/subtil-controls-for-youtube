(function installYouTubeAudioOnly() {
  'use strict';

  if (window.__YOUTUBE_NO_VIDEO_INSTALLED__) return;
  Object.defineProperty(window, '__YOUTUBE_NO_VIDEO_INSTALLED__', {
    configurable: true,
    value: true,
  });

  const Core = window.__YOUTUBE_NO_VIDEO_CORE__;
  if (!Core) return;

  const AUDIO_ROOT_ID = 'ynv-audio-player';
  const AUDIO_ENGINE_ID = 'ynv-audio-engine';
  const BUTTON_ATTRIBUTE = 'data-ynv-toggle';
  const MODE_ATTRIBUTE = 'data-ynv-mode';
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
  const WATCH_CONTEXT_ID = 'WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH';

  const state = {
    audioApp: null,
    audioRoot: null,
    generation: 0,
    mode: 'video',
    originalArgs: null,
    originalHost: null,
    originalPlayer: null,
    playerResponse: null,
    reconcileTimer: 0,
    routeVideoId: null,
    snapshot: null,
    toastTimer: 0,
  };

  setDocumentMode('video');

  function createVideoIcon(crossed) {
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const body = document.createElementNS(SVG_NAMESPACE, 'rect');
    body.setAttribute('x', '7.5');
    body.setAttribute('y', '11');
    body.setAttribute('width', '16');
    body.setAttribute('height', '14');
    body.setAttribute('rx', '3');

    const lens = document.createElementNS(SVG_NAMESPACE, 'path');
    lens.setAttribute('d', 'm23.5 15 6-3v12l-6-3z');
    svg.append(body, lens);

    if (crossed) {
      const slash = document.createElementNS(SVG_NAMESPACE, 'path');
      slash.setAttribute('class', 'ynv-icon-slash');
      slash.setAttribute('d', 'M7 7 29 29');
      svg.appendChild(slash);
    }
    return svg;
  }

  function setDocumentMode(mode) {
    state.mode = mode;
    document.documentElement.setAttribute(MODE_ATTRIBUTE, mode);
    window.dispatchEvent(new CustomEvent('ynv:modechange', {
      detail: { mode },
    }));
    updateButtons();
  }

  function getOriginalPlayer() {
    const player = document.querySelector('#movie_player');
    if (!player || player === state.audioRoot) return null;
    return player;
  }

  function getActiveRoot() {
    return state.mode === 'audio' || state.mode === 'restoring'
      ? state.audioRoot
      : getOriginalPlayer();
  }

  function isPlayerReady(player) {
    return Boolean(
      player
      && typeof player.getPlayerResponse === 'function'
      && typeof player.getVideoData === 'function'
      && player.querySelector('.ytp-right-controls'),
    );
  }

  function isAdvertisement(player, expectedVideoId) {
    if (!player) return false;
    if (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')) return true;

    try {
      const data = player.getVideoData();
      return Boolean(data && data.video_id && expectedVideoId && data.video_id !== expectedVideoId);
    } catch (_error) {
      return false;
    }
  }

  function createToggleButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ytp-button ynv-toggle-button';
    button.setAttribute(BUTTON_ATTRIBUTE, '');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMode();
    });
    updateButton(button);
    return button;
  }

  function ensureButton(root) {
    if (!root || !root.isConnected) return;
    const controls = root.querySelector('.ytp-right-controls');
    if (!controls) return;

    let button = controls.querySelector(`[${BUTTON_ATTRIBUTE}]`);
    if (!button) {
      button = createToggleButton();
      const anchor = controls.querySelector('.ytp-settings-button')
        || controls.querySelector('.ytp-miniplayer-button')
        || controls.querySelector('.ytp-size-button')
        || controls.querySelector('.ytp-fullscreen-button');
      const directAnchor = anchor && (anchor.parentElement === controls
        ? anchor
        : Array.from(controls.children).find((child) => child.contains(anchor)));
      controls.insertBefore(button, directAnchor || null);
    }
    updateButton(button);
  }

  function updateButton(button) {
    if (!button) return;
    const active = state.mode === 'audio' || state.mode === 'restoring';
    const busy = state.mode === 'enabling' || state.mode === 'restoring';
    const label = active ? 'Restore video stream' : 'Turn off video stream';

    button.classList.toggle('ynv-toggle-button--active', active);
    button.disabled = busy;
    button.replaceChildren(createVideoIcon(active));
    button.setAttribute('aria-busy', String(busy));
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(active));
    button.title = `${label} (Maj+V)`;
  }

  function updateButtons() {
    for (const button of document.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`)) {
      updateButton(button);
    }
  }

  function reconcile() {
    state.reconcileTimer = 0;
    const supportedPage = Core.isSupportedWatchUrl(window.location.href);

    if (!supportedPage && state.mode === 'video') {
      for (const button of document.querySelectorAll(`[${BUTTON_ATTRIBUTE}]`)) button.remove();
      return;
    }

    if (state.mode === 'audio' || state.mode === 'restoring') {
      const currentVideoId = Core.getVideoId(window.location.href);
      if (!supportedPage || (state.routeVideoId && currentVideoId !== state.routeVideoId)) {
        abandonAudioMode();
        return;
      }

      const appVideoId = getAppVideoId(state.audioApp);
      const brokenAudioMode = !state.audioApp
        || !state.audioRoot
        || !state.audioRoot.isConnected
        || !state.originalPlayer
        || state.audioRoot.querySelector('video')
        || (appVideoId && appVideoId !== state.routeVideoId);

      if (brokenAudioMode) {
        restoreAfterBrokenAudioMode();
        return;
      }

      ensureButton(state.audioRoot);
      return;
    }

    const player = getOriginalPlayer();
    if (supportedPage && isPlayerReady(player)) ensureButton(player);
  }

  function scheduleReconcile(delay) {
    if (state.reconcileTimer) return;
    state.reconcileTimer = window.setTimeout(reconcile, delay == null ? 120 : delay);
  }

  function toggleMode() {
    if (state.mode === 'enabling' || state.mode === 'restoring') return;
    if (state.mode === 'audio') {
      disableAudioMode();
      return;
    }
    enableAudioMode();
  }

  async function enableAudioMode() {
    const generation = ++state.generation;
    const originalPlayer = getOriginalPlayer();
    const videoId = Core.getVideoId(window.location.href);

    if (!Core.isSupportedWatchUrl(window.location.href) || !videoId || !isPlayerReady(originalPlayer)) {
      showToast('The YouTube player is not ready yet.', 'error');
      return;
    }
    if (isAdvertisement(originalPlayer, videoId)) {
      showToast('Audio-only mode will be available after the ad.', 'info');
      return;
    }

    const playerResponse = originalPlayer.getPlayerResponse();
    if (!Core.hasAudioRepresentation(playerResponse)) {
      showToast('No separate audio stream is available for this video.', 'error');
      return;
    }
    if (Core.isLiveContent(playerResponse)) {
      showToast('YouTube live streams are not supported yet.', 'error');
      return;
    }

    const applicationFactory = window.yt
      && window.yt.player
      && window.yt.player.Application
      && window.yt.player.Application.create;
    const context = getWatchPlayerContext(originalPlayer);
    if (typeof applicationFactory !== 'function' || !context) {
      showToast('The YouTube audio player is unavailable on this page.', 'error');
      return;
    }

    const snapshot = Core.snapshotPlayback(originalPlayer, videoId);
    state.routeVideoId = videoId;
    setDocumentMode('enabling');

    let audioRoot = null;
    let audioApp = null;
    try {
      originalPlayer.pauseVideo();

      audioRoot = createAudioRoot(originalPlayer);
      const baseArgs = window.ytplayer && window.ytplayer.config && window.ytplayer.config.args;
      const args = Core.buildPlayerArgs(baseArgs, playerResponse, snapshot, true);
      // YouTube creates its own player element using rootElementId. Keep that
      // ID distinct from our mount node so the document never gets duplicate IDs.
      const audioContext = Core.buildAudioContext(context, AUDIO_ENGINE_ID);
      audioApp = applicationFactory.call(window.yt.player.Application, audioRoot, { args }, audioContext);

      state.audioApp = audioApp;
      state.audioRoot = audioRoot;
      state.originalArgs = Object.assign({}, baseArgs || {});
      state.originalPlayer = originalPlayer;
      state.playerResponse = playerResponse;
      state.routeVideoId = videoId;
      state.snapshot = snapshot;

      applyAudioSettings(audioApp, null, snapshot);
      if (snapshot.playing) audioApp.playVideo();

      const audio = await waitForMedia(audioRoot, 'audio', generation, 10000);
      applyAudioSettings(audioApp, audio, snapshot);
      if (snapshot.playing) audioApp.playVideo();
      else audioApp.pauseVideo();
      await waitForReadyState(audio, generation, 10000);

      assertCurrentGeneration(generation);
      if (audioRoot.querySelector('video')) throw new Error('The audio player created a video track.');

      const audioVideoId = getAppVideoId(audioApp);
      if (audioVideoId && audioVideoId !== videoId) throw new Error('The audio player loaded different content.');

      const currentAudioTime = getAudioTime(audioApp, audio);
      if (Math.abs(currentAudioTime - snapshot.time) > 2.5) {
        audioApp.seekTo(snapshot.time, true);
      }

      const audioEngine = audioRoot.querySelector(`#${AUDIO_ENGINE_ID}`) || audioRoot;
      installPreview(audioEngine, playerResponse, videoId);
      ensureButton(audioRoot);
      releaseOriginalVideo(originalPlayer);
      setOriginalPlayerHidden(originalPlayer, true);
      audioRoot.classList.remove('ynv-audio-player--pending');
      setDocumentMode('audio');
      announce('Video stream disabled. Audio-only playback enabled.');
    } catch (error) {
      if (audioApp) disposeAudioApp(audioApp);
      if (audioRoot && audioRoot.isConnected) audioRoot.remove();

      // Navigation invalidates this operation and abandonAudioMode() has
      // already released its state. Do not restart the former page's player.
      if (state.generation !== generation) return;

      setOriginalPlayerHidden(originalPlayer, false);
      clearAudioState();
      setDocumentMode('video');

      if (snapshot.playing) {
        try {
          originalPlayer.playVideo();
        } catch (_playError) {
          // The native play button remains available if autoplay is denied.
        }
      }

      console.warn('[YouTube Audio Only] Activation failed:', error);
      showToast('Unable to enable audio-only mode.', 'error');
    }
  }

  async function disableAudioMode() {
    if (!state.audioApp || !state.audioRoot || !state.originalPlayer || !state.snapshot) {
      abandonAudioMode();
      return;
    }

    const generation = ++state.generation;
    const audioApp = state.audioApp;
    const audioRoot = state.audioRoot;
    const originalPlayer = state.originalPlayer;
    const audio = audioRoot.querySelector('audio');
    let restoreSnapshot = readAudioSnapshot(audioApp, audio, state.snapshot);

    audioRoot.inert = true;
    audioRoot.setAttribute('aria-busy', 'true');
    setDocumentMode('restoring');
    try {
      const restoreArgs = Core.buildPlayerArgs(
        state.originalArgs,
        state.playerResponse,
        restoreSnapshot,
        false,
      );

      // A muted warm-up is autoplay-safe and prevents double audio while the
      // original MediaSource is reconstructed behind the preview.
      originalPlayer.setVolume(restoreSnapshot.volume);
      originalPlayer.mute();
      originalPlayer.loadVideoByPlayerVars(restoreArgs);
      originalPlayer.setPlaybackRate(restoreSnapshot.playbackRate);

      const video = await waitForMedia(originalPlayer, 'video', generation, 6000);
      video.muted = true;
      video.volume = restoreSnapshot.volume / 100;
      video.playbackRate = restoreSnapshot.playbackRate;

      if (restoreSnapshot.playing) {
        originalPlayer.playVideo();
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
      } else {
        originalPlayer.pauseVideo();
      }

      let restoredVideo = await waitForVideoRestore(
        originalPlayer,
        video,
        restoreSnapshot,
        generation,
        10000,
      );
      assertCurrentGeneration(generation);

      // The audio kept playing during the muted video warm-up. Capture its
      // latest position for the actual handoff, then stop it before unmuting.
      restoreSnapshot = readAudioSnapshot(audioApp, audio, restoreSnapshot);
      audioApp.pauseVideo();
      originalPlayer.setVolume(restoreSnapshot.volume);
      originalPlayer.setPlaybackRate(restoreSnapshot.playbackRate);
      if (typeof originalPlayer.seekTo === 'function') {
        originalPlayer.seekTo(restoreSnapshot.time, true);
      }
      if (restoreSnapshot.playing) originalPlayer.playVideo();
      else originalPlayer.pauseVideo();

      restoredVideo = await waitForVideoRestore(
        originalPlayer,
        restoredVideo,
        restoreSnapshot,
        generation,
        5000,
      );
      assertCurrentGeneration(generation);

      disposeAudioApp(audioApp);
      if (audioRoot.isConnected) audioRoot.remove();
      setOriginalPlayerHidden(originalPlayer, false);
      applyOriginalSettings(originalPlayer, restoredVideo, restoreSnapshot);

      clearAudioState();
      setDocumentMode('video');
      scheduleReconcile(0);
      announce('Video stream restored.');
    } catch (error) {
      // A YouTube SPA navigation disposes both players via abandonAudioMode().
      // Resurrecting either local reference here would corrupt the new page.
      if (state.generation !== generation) return;

      audioRoot.inert = false;
      audioRoot.removeAttribute('aria-busy');
      console.warn('[YouTube Audio Only] Restore failed:', error);
      showToast('The video could not be restored. Audio-only mode remains active.', 'error');

      releaseOriginalVideo(originalPlayer);
      setOriginalPlayerHidden(originalPlayer, true);
      if (restoreSnapshot.playing) {
        try {
          audioApp.playVideo();
        } catch (_playError) {
          // Keep the visible controls available for a manual resume.
        }
      }
      setDocumentMode('audio');
      scheduleReconcile(0);
    }
  }

  function createAudioRoot(originalPlayer) {
    const existing = document.getElementById(AUDIO_ROOT_ID);
    if (existing) existing.remove();

    const host = originalPlayer.parentElement;
    if (!host) throw new Error('Player container not found.');

    const audioRoot = document.createElement('div');
    audioRoot.id = AUDIO_ROOT_ID;
    audioRoot.className = `${Core.copyPlayerClasses(originalPlayer.className)} ynv-audio-player--pending`;
    audioRoot.setAttribute('aria-label', 'YouTube audio-only player');
    audioRoot.setAttribute('data-ynv-pipeline', 'audio-only');

    host.classList.add('ynv-player-host');
    host.appendChild(audioRoot);
    state.originalHost = host;
    return audioRoot;
  }

  function getWatchPlayerContext(player) {
    try {
      const configs = window.ytcfg
        && window.ytcfg.data_
        && window.ytcfg.data_.WEB_PLAYER_CONTEXT_CONFIGS;
      return (configs && configs[WATCH_CONTEXT_ID])
        || (typeof player.getWebPlayerContextConfig === 'function' && player.getWebPlayerContextConfig())
        || null;
    } catch (_error) {
      return null;
    }
  }

  function applyAudioSettings(app, audio, snapshot) {
    try {
      app.setPlaybackRate(snapshot.playbackRate);
    } catch (_error) {}

    try {
      app.BG.setVolume(snapshot.volume);
      if (snapshot.muted) app.BG.mute();
      else app.BG.unMute();
    } catch (_error) {}

    if (audio) {
      audio.playbackRate = snapshot.playbackRate;
      audio.volume = snapshot.volume / 100;
      audio.muted = snapshot.muted;
    }
  }

  function applyOriginalSettings(player, video, snapshot) {
    try {
      player.setPlaybackRate(snapshot.playbackRate);
      player.setVolume(snapshot.volume);
      if (snapshot.muted) player.mute();
      else player.unMute();
      if (snapshot.playing) player.playVideo();
      else player.pauseVideo();
    } catch (_error) {}

    if (video) {
      video.playbackRate = snapshot.playbackRate;
      video.volume = snapshot.volume / 100;
      video.muted = snapshot.muted;
      if (snapshot.playing && video.paused) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
      }
    }
  }

  function readAudioSnapshot(app, audio, fallback) {
    let time = fallback.time;
    let volume = fallback.volume;
    let muted = fallback.muted;

    try {
      time = app.getCurrentTime();
      volume = app.getVolume();
      muted = app.isMuted();
    } catch (_error) {}

    return {
      muted: Boolean(muted),
      playbackRate: Core.clamp(audio ? audio.playbackRate : fallback.playbackRate, 0.25, 4),
      playing: audio
        ? Boolean(!audio.paused && !audio.ended)
        : Boolean(fallback.playing),
      time: Math.max(0, Number(time) || 0),
      videoId: fallback.videoId,
      volume: Core.clamp(volume, 0, 100),
    };
  }

  function getAudioTime(app, audio) {
    try {
      return Number(app.getCurrentTime()) || 0;
    } catch (_error) {
      return Number(audio && audio.currentTime) || 0;
    }
  }

  function getAppVideoId(app) {
    try {
      const data = app.getVideoData();
      return data && (data.videoId || data.video_id) || null;
    } catch (_error) {
      return null;
    }
  }

  function releaseOriginalVideo(player) {
    for (const method of ['pauseVideo', 'stopVideo', 'clearVideo']) {
      try {
        if (typeof player[method] === 'function') player[method]();
      } catch (_error) {}
    }
  }

  function setOriginalPlayerHidden(player, hidden) {
    if (!player) return;
    player.classList.toggle('ynv-original-player--hidden', hidden);
    player.inert = hidden;
    if (hidden) player.setAttribute('aria-hidden', 'true');
    else player.removeAttribute('aria-hidden');
  }

  function installPreview(root, playerResponse, videoId) {
    const previous = root.querySelector('.ynv-preview');
    if (previous) previous.remove();

    const preview = document.createElement('div');
    preview.className = 'ynv-preview';
    preview.setAttribute('aria-hidden', 'true');

    const image = document.createElement('img');
    image.className = 'ynv-preview__image';
    image.alt = '';
    image.decoding = 'async';

    const candidates = Core.getThumbnailCandidates(playerResponse, videoId);
    let candidateIndex = 0;
    const loadNextCandidate = () => {
      const candidate = candidates[candidateIndex++];
      if (candidate) image.src = candidate;
      else image.classList.add('ynv-preview__image--unavailable');
    };
    image.addEventListener('error', loadNextCandidate);
    loadNextCandidate();

    const veil = document.createElement('div');
    veil.className = 'ynv-preview__veil';

    const badge = document.createElement('div');
    badge.className = 'ynv-preview__badge';
    const badgeLabel = document.createElement('span');
    badgeLabel.textContent = 'Audio only';
    badge.append(createVideoIcon(true), badgeLabel);

    preview.append(image, veil, badge);
    root.appendChild(preview);
  }

  function waitForMedia(root, selector, generation, timeout) {
    return new Promise((resolve, reject) => {
      const existing = root && root.querySelector(selector);
      if (existing) {
        try {
          assertCurrentGeneration(generation);
          resolve(existing);
        } catch (error) {
          reject(error);
        }
        return;
      }

      let timer = 0;
      const observer = new MutationObserver(() => {
        try {
          assertCurrentGeneration(generation);
          const media = root.querySelector(selector);
          if (!media) return;
          cleanup();
          resolve(media);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });

      const cleanup = () => {
        observer.disconnect();
        if (timer) window.clearTimeout(timer);
      };

      observer.observe(root, { childList: true, subtree: true });
      timer = window.setTimeout(() => {
        cleanup();
        try {
          assertCurrentGeneration(generation);
          reject(new Error(`The ${selector} media element was not created.`));
        } catch (error) {
          reject(error);
        }
      }, timeout);
    });
  }

  function waitForReadyState(media, generation, timeout) {
    if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      assertCurrentGeneration(generation);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      let timer = 0;
      const onReady = () => {
        try {
          assertCurrentGeneration(generation);
          cleanup();
          resolve();
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const onError = () => {
        cleanup();
        try {
          assertCurrentGeneration(generation);
          reject(media.error || new Error('The audio stream could not be loaded.'));
        } catch (error) {
          reject(error);
        }
      };
      const cleanup = () => {
        media.removeEventListener('loadeddata', onReady);
        media.removeEventListener('canplay', onReady);
        media.removeEventListener('error', onError);
        if (timer) window.clearTimeout(timer);
      };

      media.addEventListener('loadeddata', onReady, { once: true });
      media.addEventListener('canplay', onReady, { once: true });
      media.addEventListener('error', onError, { once: true });
      timer = window.setTimeout(() => {
        cleanup();
        try {
          assertCurrentGeneration(generation);
          reject(new Error('Audio stream loading timed out.'));
        } catch (error) {
          reject(error);
        }
      }, timeout);
    });
  }

  function waitForVideoRestore(player, video, snapshot, generation, timeout) {
    const startedAt = performance.now();

    return new Promise((resolve, reject) => {
      const poll = () => {
        try {
          assertCurrentGeneration(generation);
          const currentVideo = player.querySelector('video') || video;
          const ready = Boolean(
            currentVideo
            && currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
          );
          const nearTarget = ready
            && Math.abs((Number(currentVideo.currentTime) || 0) - snapshot.time) < 3;
          const loadedVideoId = getAppVideoId(player);

          if (loadedVideoId && loadedVideoId !== snapshot.videoId) {
            reject(new Error('The video player loaded different content.'));
            return;
          }

          if (currentVideo) {
            currentVideo.muted = true;
            currentVideo.volume = snapshot.volume / 100;
            currentVideo.playbackRate = snapshot.playbackRate;
          }

          if (ready && !nearTarget && typeof player.seekTo === 'function') {
            player.seekTo(snapshot.time, true);
          }

          if (ready && snapshot.playing && currentVideo.paused) {
            player.playVideo();
            const playPromise = currentVideo.play();
            if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
          }

          if (ready && nearTarget && (!snapshot.playing || !currentVideo.paused)) {
            resolve(currentVideo);
            return;
          }

          if (performance.now() - startedAt >= timeout) {
            reject(new Error('Video stream reconstruction timed out.'));
            return;
          }
          window.setTimeout(poll, 120);
        } catch (error) {
          reject(error);
        }
      };
      poll();
    });
  }

  function assertCurrentGeneration(generation) {
    if (state.generation !== generation) throw new DOMException('Operation superseded.', 'AbortError');
  }

  function disposeAudioApp(app) {
    try {
      app.pauseVideo();
    } catch (_error) {}
    try {
      app.dispose();
    } catch (_error) {}
  }

  function clearAudioState() {
    if (state.originalHost) state.originalHost.classList.remove('ynv-player-host');
    state.audioApp = null;
    state.audioRoot = null;
    state.originalArgs = null;
    state.originalHost = null;
    state.originalPlayer = null;
    state.playerResponse = null;
    state.routeVideoId = null;
    state.snapshot = null;
  }

  function abandonAudioMode() {
    ++state.generation;
    if (state.audioApp) disposeAudioApp(state.audioApp);
    if (state.audioRoot && state.audioRoot.isConnected) state.audioRoot.remove();
    setOriginalPlayerHidden(state.originalPlayer, false);
    clearAudioState();
    setDocumentMode('video');
    scheduleReconcile(0);
  }

  function restoreAfterBrokenAudioMode() {
    const audioApp = state.audioApp;
    const audioRoot = state.audioRoot;
    const originalPlayer = state.originalPlayer;
    const originalArgs = state.originalArgs;
    const playerResponse = state.playerResponse;
    const fallbackSnapshot = state.snapshot;
    const audio = audioRoot && audioRoot.querySelector('audio');
    const snapshot = audioApp && fallbackSnapshot
      ? readAudioSnapshot(audioApp, audio, fallbackSnapshot)
      : fallbackSnapshot;

    ++state.generation;
    if (audioApp) disposeAudioApp(audioApp);
    if (audioRoot && audioRoot.isConnected) audioRoot.remove();

    if (originalPlayer && snapshot && playerResponse) {
      try {
        originalPlayer.mute();
        originalPlayer.loadVideoByPlayerVars(Core.buildPlayerArgs(
          originalArgs,
          playerResponse,
          snapshot,
          false,
        ));
        applyOriginalSettings(originalPlayer, originalPlayer.querySelector('video'), snapshot);
      } catch (error) {
        console.warn('[YouTube Audio Only] Player recovery failed:', error);
      }
    }

    setOriginalPlayerHidden(originalPlayer, false);
    clearAudioState();
    setDocumentMode('video');
    scheduleReconcile(0);
    showToast('The audio player was reset.', 'error');
  }

  function showToast(message, kind) {
    const root = getActiveRoot() || getOriginalPlayer();
    if (!root) return;

    let toast = root.querySelector('.ynv-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'ynv-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      root.appendChild(toast);
    }

    toast.classList.toggle('ynv-toast--error', kind === 'error');
    toast.textContent = message;
    toast.classList.add('ynv-toast--visible');
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove('ynv-toast--visible');
    }, kind === 'error' ? 5200 : 3600);
  }

  function announce(message) {
    let region = document.getElementById('ynv-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'ynv-live-region';
      region.className = 'ynv-sr-only';
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 30);
  }

  function handleKeyboard(event) {
    if (event.defaultPrevented || Core.isEditableTarget(event.target)) return;

    if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyV') {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleMode();
      return;
    }

    if (state.mode !== 'audio' || !state.audioApp || !state.audioRoot) return;
    if (event.target && event.target.closest && event.target.closest(`[${BUTTON_ATTRIBUTE}]`)) return;

    const audio = state.audioRoot.querySelector('audio');
    const app = state.audioApp;
    let handled = true;

    switch (event.code) {
      case 'Space':
      case 'KeyK':
        if (audio && audio.paused) app.playVideo();
        else app.pauseVideo();
        break;
      case 'KeyJ':
        seekAudioBy(-10);
        break;
      case 'KeyL':
        seekAudioBy(10);
        break;
      case 'ArrowLeft':
        seekAudioBy(-5);
        break;
      case 'ArrowRight':
        seekAudioBy(5);
        break;
      case 'ArrowUp':
        setAudioVolume(Core.clamp(app.getVolume() + 5, 0, 100));
        break;
      case 'ArrowDown':
        setAudioVolume(Core.clamp(app.getVolume() - 5, 0, 100));
        break;
      case 'KeyM':
        if (app.isMuted()) app.BG.unMute();
        else app.BG.mute();
        break;
      case 'KeyF': {
        const fullscreenButton = state.audioRoot.querySelector('.ytp-fullscreen-button');
        if (fullscreenButton) fullscreenButton.click();
        else handled = false;
        break;
      }
      default: {
        const digit = event.code.match(/^Digit([0-9])$/);
        if (digit && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
          const duration = audio && Number(audio.duration);
          if (Number.isFinite(duration)) app.seekTo(duration * Number(digit[1]) / 10, true);
        } else {
          handled = false;
        }
      }
    }

    if (handled) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function seekAudioBy(seconds) {
    if (!state.audioApp || !state.audioRoot) return;
    const audio = state.audioRoot.querySelector('audio');
    const duration = audio && Number(audio.duration);
    const maximum = Number.isFinite(duration) ? duration : Number.MAX_SAFE_INTEGER;
    state.audioApp.seekTo(Core.clamp(getAudioTime(state.audioApp, audio) + seconds, 0, maximum), true);
  }

  function setAudioVolume(volume) {
    if (!state.audioApp) return;
    state.audioApp.BG.setVolume(volume);
    if (volume > 0 && state.audioApp.isMuted()) state.audioApp.BG.unMute();
  }

  function handleNavigationStart() {
    if (state.mode !== 'video') abandonAudioMode();
  }

  function handleNavigationFinish() {
    const nextVideoId = Core.getVideoId(window.location.href);
    if (state.mode !== 'video' && state.routeVideoId && nextVideoId !== state.routeVideoId) {
      abandonAudioMode();
      return;
    }
    state.routeVideoId = nextVideoId;
    scheduleReconcile(80);
  }

  document.addEventListener('keydown', handleKeyboard, true);
  document.addEventListener('yt-navigate-start', handleNavigationStart, true);
  document.addEventListener('yt-navigate-finish', handleNavigationFinish, true);
  document.addEventListener('yt-page-data-updated', () => scheduleReconcile(80), true);
  window.addEventListener('popstate', handleNavigationStart, true);
  window.addEventListener('pagehide', abandonAudioMode, { once: true });

  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      return node.matches('#movie_player, .ytp-right-controls, ytd-player, #ynv-audio-player')
        || node.querySelector('#movie_player, .ytp-right-controls, #ynv-audio-player');
    }));
    if (relevant) scheduleReconcile(80);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => {
    const currentVideoId = Core.getVideoId(window.location.href);
    if (state.mode !== 'video' && state.routeVideoId && currentVideoId !== state.routeVideoId) {
      abandonAudioMode();
    }
    scheduleReconcile(0);
  }, 1500);

  scheduleReconcile(0);
})();
