# YouTube Audio-Only Mode

This Chrome extension adds a **Turn off video stream** button to the YouTube playback bar, immediately before Settings. Clicking it replaces the video pipeline with YouTube's internal audio-only player, displays the video thumbnail, and keeps the playback controls available.

## Local installation

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`youtube-no-video`).
5. Open or reload a YouTube video, for example:
   <https://www.youtube.com/watch?v=pcTx4lYk1_0>

The camera button appears in the player controls. You can also use **Shift+V**.

## What the extension actually does

- It creates a YouTube player whose media element is an `<audio>` element.
- It reuses the signed response for the current video without extracting or deciphering a private URL.
- It calls `stopVideo()` and then `clearVideo()` on the original player, closing its MediaSource and stopping the active video pipeline.
- It restores the playback position, speed, volume, and play/pause state when video playback is enabled again.
- It requests no global Chrome permissions and installs no network-blocking rules.

Hiding a `<video>` element or switching it to 144p is not enough because decoding and downloads would continue. Here, the active player contains only an `<audio>` element, while the original `<video>` reaches `readyState === 0`.

Chrome may temporarily retain previously received bytes in its HTTP cache or internal allocations. The practical guarantee is therefore **no active video download, decoding, or rendering after switching**, rather than “zero historical bytes in RAM.”

## Compatibility and limitations

- Chrome 111 or later.
- On-demand videos on `youtube.com/watch` pages.
- Live streams, Shorts, and ads are not switched to audio-only mode.
- YouTube does not publicly document its audio-only player context. An internal player change may therefore require an extension update.
- The Next button and autoplay are hidden in the standalone audio player to prevent the media from changing without a matching page URL update. YouTube links and recommendations remain available as usual.

## Verification

With Node.js 18 or later:

```bash
npm run check
```

This command validates the manifest, scripts, icon dimensions, and pure functions for URL parsing, thumbnails, playback state, and audio configuration.

After `npm install`, an end-to-end test using a real Chrome instance is also available:

```bash
npm run test:e2e
```

For a more detailed manual inspection:

1. Open DevTools and select the **Media** panel, or open `chrome://media-internals`.
2. Enable audio-only mode.
3. Confirm that `#ynv-audio-player` contains an `<audio>` element but no `<video>` element.
4. Confirm that `#movie_player video` is paused with a `readyState` of `0`.
5. Compare CPU, memory, and network usage in Chrome Task Manager.
