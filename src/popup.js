'use strict';

// The manifest is the single list of locales: load the same files the content script uses.
const manifest = chrome.runtime.getManifest();
const localeFiles = manifest.content_scripts[0].js.filter((file) => file.includes('/locales/'));

document.getElementById('version').textContent = `v${manifest.version}`;

Promise.all(localeFiles.map((file) => new Promise((resolve) => {
  const script = document.createElement('script');
  script.src = `/${file}`;
  script.onload = script.onerror = resolve;
  document.head.append(script);
}))).then(() => {
  const locales = globalThis.__YOUTUBE_NO_VIDEO_LOCALES__ || {};
  const messages = globalThis.__YOUTUBE_NO_VIDEO_CORE__.resolveLocale(locales, navigator.language);
  if (!messages) return; // keep the English text written in popup.html

  document.documentElement.lang = Object.keys(locales).find((code) => locales[code] === messages);
  for (const element of document.querySelectorAll('[data-i18n]')) {
    const message = messages[element.dataset.i18n];
    if (message) element.textContent = message;
  }
});
