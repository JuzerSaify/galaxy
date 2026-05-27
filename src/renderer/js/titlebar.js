import { settings } from './settings.js';

export function setupTitlebar() {
  const minBtn = document.getElementById('win-min-btn');
  const maxBtn = document.getElementById('win-max-btn');
  const closeBtn = document.getElementById('win-close-btn');
  const settingsBtn = document.getElementById('settings-trigger-btn');

  if (minBtn) {
    minBtn.addEventListener('click', () => {
      window.api.minimize();
    });
  }

  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      window.api.maximize();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.api.close();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      settings.toggleOverlay();
    });
  }
}
