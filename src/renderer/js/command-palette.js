import { chat } from './chat.js';
import { settings } from './settings.js';
import { report } from './report.js';
import { state } from './state.js';

class CommandPaletteController {
  constructor() {
    this.overlay = null;
    this.input = null;
    this.resultsContainer = null;
    
    this.isOpen = false;
    this.selectedIndex = 0;
    this.filteredCommands = [];
    
    this.commands = [
      { id: 'new-research', title: 'New Research', shortcut: 'Ctrl+N', icon: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' },
      { id: 'clear-workspace', title: 'Clear Workspace', shortcut: '', icon: '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>' },
      { id: 'open-settings', title: 'Open Settings Panel', shortcut: '', icon: '<svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"></path><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"></path></svg>' },
      { id: 'search-history', title: 'Search Research History', shortcut: '', icon: '<svg viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></svg>' },
      { id: 'export-md', title: 'Export Report as Markdown', shortcut: '', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>' },
      { id: 'export-html', title: 'Export Report as HTML', shortcut: '', icon: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' },
      { id: 'toggle-followup', title: 'Toggle Followup Q&A Mode', shortcut: '', icon: '<svg viewBox="0 0 24 24"><rect x="1" y="5" width="22" height="14" rx="7" ry="7"></rect><circle cx="16" cy="12" r="3"></circle></svg>' },
      { id: 'settings-model', title: 'Settings: Choose Model', shortcut: '', icon: '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>' },
      { id: 'settings-prompt', title: 'Settings: Customize System Prompt', shortcut: '', icon: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>' }
    ];
  }

  init() {
    this.overlay = document.getElementById('command-palette');
    this.input = document.getElementById('command-palette-input');
    this.resultsContainer = document.getElementById('command-palette-results');

    this.setupListeners();
  }

  setupListeners() {
    if (this.input) {
      this.input.addEventListener('input', () => this.filterResults());
      
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.moveSelection(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.moveSelection(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.executeSelected();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        }
      });
    }

    if (this.overlay) {
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.close();
        }
      });
    }
  }

  open() {
    if (this.overlay && this.input) {
      this.isOpen = true;
      this.overlay.classList.add('active');
      this.input.value = '';
      this.selectedIndex = 0;
      this.filterResults();
      setTimeout(() => this.input.focus(), 50);
    }
  }

  close() {
    if (this.overlay) {
      this.isOpen = false;
      this.overlay.classList.remove('active');
      const inputEl = document.getElementById('chat-input-field');
      if (inputEl) inputEl.focus();
    }
  }

  filterResults() {
    const query = this.input.value.toLowerCase().trim();
    
    if (!query) {
      this.filteredCommands = [...this.commands];
    } else {
      this.filteredCommands = this.commands.filter(cmd => 
        cmd.title.toLowerCase().includes(query) || cmd.id.toLowerCase().includes(query)
      );
    }

    this.selectedIndex = 0;
    this.renderResults();
  }

  renderResults() {
    if (!this.resultsContainer) return;
    this.resultsContainer.innerHTML = '';

    if (this.filteredCommands.length === 0) {
      const noResults = document.createElement('div');
      noResults.style.padding = '12px 16px';
      noResults.style.fontSize = '13px';
      noResults.style.color = 'var(--text-tertiary)';
      noResults.style.textAlign = 'center';
      noResults.textContent = 'No commands found';
      this.resultsContainer.appendChild(noResults);
      return;
    }

    this.filteredCommands.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = 'command-palette-item';
      if (idx === this.selectedIndex) {
        item.classList.add('selected');
      }

      const left = document.createElement('div');
      left.className = 'command-palette-item-left';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'command-palette-item-icon';
      iconSpan.innerHTML = cmd.icon;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'command-palette-item-title';
      titleSpan.textContent = cmd.title;

      left.appendChild(iconSpan);
      left.appendChild(titleSpan);
      item.appendChild(left);

      if (cmd.shortcut) {
        const right = document.createElement('span');
        right.className = 'command-palette-item-shortcut';
        right.textContent = cmd.shortcut;
        item.appendChild(right);
      }

      item.addEventListener('click', () => {
        this.selectedIndex = idx;
        this.executeSelected();
      });

      this.resultsContainer.appendChild(item);
    });

    this.scrollSelectionIntoView();
  }

  moveSelection(direction) {
    if (this.filteredCommands.length === 0) return;
    
    this.selectedIndex += direction;
    if (this.selectedIndex < 0) {
      this.selectedIndex = this.filteredCommands.length - 1;
    } else if (this.selectedIndex >= this.filteredCommands.length) {
      this.selectedIndex = 0;
    }

    this.renderResults();
  }

  scrollSelectionIntoView() {
    const selectedElement = this.resultsContainer.querySelector('.command-palette-item.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }

  executeSelected() {
    const command = this.filteredCommands[this.selectedIndex];
    if (!command) return;

    this.close();

    switch (command.id) {
      case 'new-research':
        const chatInput = document.getElementById('chat-input-field');
        if (chatInput) {
          chatInput.focus();
        }
        break;
      case 'clear-workspace':
        chat.clearWorkspace();
        break;
      case 'open-settings':
        settings.openToTab('general');
        break;
      case 'search-history':
        settings.openToTab('history');
        break;
      case 'export-md':
        report.exportMarkdown();
        break;
      case 'export-html':
        const htmlBtn = document.getElementById('report-export-html-btn');
        if (htmlBtn) htmlBtn.click();
        break;
      case 'toggle-followup':
        const toggle = document.getElementById('chat-followup-toggle');
        if (toggle && !toggle.disabled) {
          toggle.checked = !toggle.checked;
          // Trigger change event manually
          toggle.dispatchEvent(new Event('change'));
        } else {
          alert('Generate a report first to enable Followup Mode');
        }
        break;
      case 'settings-model':
        settings.openToTab('model');
        break;
      case 'settings-prompt':
        settings.openToTab('prompt');
        break;
    }
  }
}

export const commandPalette = new CommandPaletteController();
