import { state } from './state.js';
import { setupTitlebar } from './titlebar.js';
import { settings } from './settings.js';
import { report } from './report.js';
import { chat } from './chat.js';
import { commandPalette } from './command-palette.js';
import { auth } from './auth-controller.js';
import { bugReport } from './bug-report.js';

async function bootstrap() {
  console.log('Knovant initializing...');

  // 1. Load persistent settings from Electron Store
  await state.loadSettings();

  // Apply appearance theme immediately
  const activeTheme = state.settings.appTheme || 'system';
  document.documentElement.setAttribute('data-theme', activeTheme);

  // 2. Initialize frontend controllers
  setupTitlebar();
  settings.init();
  report.init();
  chat.init();
  commandPalette.init();
  auth.init();
  bugReport.init();

  // 3. Perform initial health check to verify connection to local Ollama host
  await settings.checkOllamaConnection();

  // 4. Auto focus the input field as requested
  const inputEl = document.getElementById('chat-input-field');
  if (inputEl) {
    inputEl.focus();
  }

  // 5. Split Pane Dynamic Resize Logic
  const resizeHandle = document.getElementById('resize-handle');
  const mainContent = document.querySelector('.main-content');
  if (resizeHandle && mainContent) {
    let isResizing = false;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      resizeHandle.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const rect = mainContent.getBoundingClientRect();
      const newWidth = Math.max(300, Math.min(700, e.clientX - rect.left));
      mainContent.style.setProperty('--chat-width', `${newWidth}px`);
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // 6. Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+K: Open command palette
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      commandPalette.open();
    }

    // Ctrl+N: Clear chat history and reset workspace state
    if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      chat.clearWorkspace();
    }

    // Escape: Close settings view overlay or command palette if open
    if (e.key === 'Escape') {
      if (commandPalette.isOpen) {
        commandPalette.close();
      } else if (settings.isOpen()) {
        settings.closeOverlay();
      }
    }
  });

  // Hide splash screen
  const splash = document.getElementById('splash-screen');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => splash.remove(), 400);
  }

  console.log('Knovant successfully initialized.');
}

window.addEventListener('DOMContentLoaded', bootstrap);
