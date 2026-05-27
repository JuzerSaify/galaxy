import { state } from './state.js';

class SettingsController {
  constructor() {
    this.overlay = null;
    this.tabs = [];
    this.sections = [];
  }

  init() {
    this.overlay = document.getElementById('settings-view');
    this.tabs = document.querySelectorAll('.settings-tab-btn');
    this.sections = document.querySelectorAll('.settings-section');
    this.closeBtn = document.getElementById('settings-close-trigger');

    this.setupTabNavigation();
    this.setupCloseListeners();
    this.setupFormBindings();
    this.setupActionButtons();
  }

  toggleOverlay() {
    if (this.overlay) {
      const isActive = this.overlay.classList.toggle('active');
      if (isActive) {
        this.loadSettingsToForm();
        this.checkOllamaConnection();
      }
    }
  }

  isOpen() {
    return this.overlay && this.overlay.classList.contains('active');
  }

  closeOverlay() {
    if (this.overlay && this.overlay.classList.contains('active')) {
      this.overlay.classList.remove('active');
    }
  }

  openToTab(tabName) {
    if (this.overlay) {
      this.overlay.classList.add('active');
      this.loadSettingsToForm();
      this.checkOllamaConnection();

      const tab = Array.from(this.tabs).find(t => t.getAttribute('data-tab') === tabName);
      if (tab) {
        tab.click();
      }
    }
  }

  setupTabNavigation() {
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');

        this.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        this.sections.forEach(sec => {
          if (sec.getAttribute('data-section') === targetTab) {
            sec.classList.add('active');
          } else {
            sec.classList.remove('active');
          }
        });

        if (targetTab === 'history') {
          this.loadHistoryList();
        } else if (targetTab === 'profile') {
          import('./auth-controller.js').then(module => {
            module.auth.checkStatus();
          });
        }
      });
    });
  }

  setupCloseListeners() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.toggleOverlay();
      });
    }
  }

  async checkOllamaConnection() {
    const badge = document.getElementById('model-connection-badge');
    const headerDot = document.getElementById('ollama-status-indicator');
    if (!badge) return;

    badge.innerText = 'Verifying...';
    badge.className = 'status-badge';
    if (headerDot) {
      headerDot.className = 'ollama-status-dot';
      headerDot.title = 'Ollama Status: Verifying...';
    }

    try {
      const isConnected = await window.api.checkOllamaHealth();
      state.ollamaConnected = isConnected;

      if (isConnected) {
        badge.innerText = 'Connected';
        badge.classList.add('connected');
        if (headerDot) {
          headerDot.className = 'ollama-status-dot connected';
          headerDot.title = 'Ollama Status: Connected';
        }
        await this.populateModelList();
      } else {
        badge.innerText = 'Disconnected';
        badge.classList.add('disconnected');
        if (headerDot) {
          headerDot.className = 'ollama-status-dot disconnected';
          headerDot.title = 'Ollama Status: Disconnected';
        }
        this.showNoModels();
      }
    } catch (e) {
      badge.innerText = 'Error';
      badge.classList.add('disconnected');
      if (headerDot) {
        headerDot.className = 'ollama-status-dot disconnected';
        headerDot.title = 'Ollama Status: Disconnected';
      }
      this.showNoModels();
    }
  }

  async populateModelList() {
    const select = document.getElementById('set-selected-model');
    if (!select) return;

    try {
      const models = await window.api.listModels();
      state.availableModels = models;

      select.innerHTML = '';
      if (models.length === 0) {
        select.innerHTML = '<option value="">No models pulled (Check Ollama library)</option>';
        return;
      }

      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.innerText = `${m.name} (${Math.round(m.size / (1024*1024*1024)*100)/100} GB)`;
        if (state.settings.selectedModel === m.name) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });

      if (!state.settings.selectedModel && models.length > 0) {
        await state.saveSetting('selectedModel', models[0].name);
        select.value = models[0].name;
      }
    } catch (e) {
      console.error('Failed to populate models:', e);
      this.showNoModels();
    }
  }

  showNoModels() {
    const select = document.getElementById('set-selected-model');
    if (select) {
      select.innerHTML = '<option value="">No models available (Check local host connection)</option>';
    }
  }

  loadSettingsToForm() {
    // General
    const autoFocus = document.getElementById('set-auto-focus');
    if (autoFocus) autoFocus.checked = true;

    // Model
    const hostInput = document.getElementById('set-ollama-host');
    if (hostInput) hostInput.value = state.settings.ollamaHost;

    const tempInput = document.getElementById('set-temperature');
    const tempVal = document.getElementById('val-temp');
    if (tempInput) {
      tempInput.value = state.settings.temperature;
      if (tempVal) tempVal.innerText = state.settings.temperature;
    }

    // Research
    const researchMode = document.getElementById('set-research-mode');
    if (researchMode) researchMode.value = state.settings.researchMode;

    const multiQuery = document.getElementById('set-enable-multi-query');
    if (multiQuery) multiQuery.checked = state.settings.enableMultiQuery;

    const maxSubQueries = document.getElementById('set-max-sub-queries');
    const maxSubQueriesVal = document.getElementById('val-max-sub-queries');
    if (maxSubQueries) {
      maxSubQueries.value = state.settings.maxSubQueries;
      if (maxSubQueriesVal) maxSubQueriesVal.innerText = state.settings.maxSubQueries;
    }

    const searchDepth = document.getElementById('set-search-depth');
    if (searchDepth) searchDepth.value = state.settings.searchDepth;


    const followups = document.getElementById('set-enable-followups');
    if (followups) followups.checked = state.settings.enableFollowups;

    const sourceScoring = document.getElementById('set-enable-source-scoring');
    if (sourceScoring) sourceScoring.checked = state.settings.enableSourceScoring;

    // Theme loading
    const themeSelect = document.getElementById('set-app-theme');
    if (themeSelect) themeSelect.value = state.settings.appTheme || 'system';

    // Prompt
    const systemPromptTextarea = document.getElementById('set-system-prompt');
    if (systemPromptTextarea) systemPromptTextarea.value = state.settings.systemPrompt;

    // Report
    const autoReport = document.getElementById('set-auto-report');
    if (autoReport) autoReport.checked = state.settings.autoGenerateReport;

    const fontSizeInput = document.getElementById('set-font-size');
    const fontSizeVal = document.getElementById('val-font-size');
    if (fontSizeInput) {
      fontSizeInput.value = state.settings.reportFontSize;
      if (fontSizeVal) fontSizeVal.innerText = `${state.settings.reportFontSize}px`;
    }

    // Advanced
    const keepAlive = document.getElementById('set-keep-alive');
    if (keepAlive) keepAlive.value = state.settings.keepAlive;

    const contextLimit = document.getElementById('set-context-length');
    const contextVal = document.getElementById('val-context');
    if (contextLimit) {
      contextLimit.value = state.settings.contextLength || 16384;
      if (contextVal) contextVal.innerText = state.settings.contextLength || 16384;
    }
  }

  setupFormBindings() {
    // Model Host change
    const hostInput = document.getElementById('set-ollama-host');
    if (hostInput) {
      hostInput.addEventListener('change', async () => {
        let val = hostInput.value.trim();
        if (val) {
          await state.saveSetting('ollamaHost', val);
          this.checkOllamaConnection();
        }
      });
    }

    // Model select change
    const select = document.getElementById('set-selected-model');
    if (select) {
      select.addEventListener('change', async () => {
        await state.saveSetting('selectedModel', select.value);
      });
    }

    // Temperature slider
    const tempInput = document.getElementById('set-temperature');
    const tempVal = document.getElementById('val-temp');
    if (tempInput) {
      tempInput.addEventListener('input', () => {
        if (tempVal) tempVal.innerText = tempInput.value;
      });
      tempInput.addEventListener('change', async () => {
        await state.saveSetting('temperature', parseFloat(tempInput.value));
      });
    }

    // Research Mode
    const researchMode = document.getElementById('set-research-mode');
    if (researchMode) {
      researchMode.addEventListener('change', async () => {
        await state.saveSetting('researchMode', researchMode.value);
      });
    }

    // Multi-Query toggle
    const multiQuery = document.getElementById('set-enable-multi-query');
    if (multiQuery) {
      multiQuery.addEventListener('change', async () => {
        await state.saveSetting('enableMultiQuery', multiQuery.checked);
      });
    }

    // Max Sub-Queries slider
    const maxSubQueries = document.getElementById('set-max-sub-queries');
    const maxSubQueriesVal = document.getElementById('val-max-sub-queries');
    if (maxSubQueries) {
      maxSubQueries.addEventListener('input', () => {
        if (maxSubQueriesVal) maxSubQueriesVal.innerText = maxSubQueries.value;
      });
      maxSubQueries.addEventListener('change', async () => {
        await state.saveSetting('maxSubQueries', parseInt(maxSubQueries.value));
      });
    }

    // Search Depth dropdown
    const searchDepth = document.getElementById('set-search-depth');
    if (searchDepth) {
      searchDepth.addEventListener('change', async () => {
        await state.saveSetting('searchDepth', parseInt(searchDepth.value));
      });
    }



    // Followups toggle
    const followups = document.getElementById('set-enable-followups');
    if (followups) {
      followups.addEventListener('change', async () => {
        await state.saveSetting('enableFollowups', followups.checked);
      });
    }

    // Source scoring toggle
    const sourceScoring = document.getElementById('set-enable-source-scoring');
    if (sourceScoring) {
      sourceScoring.addEventListener('change', async () => {
        await state.saveSetting('enableSourceScoring', sourceScoring.checked);
      });
    }

    // Theme select change
    const themeSelect = document.getElementById('set-app-theme');
    if (themeSelect) {
      themeSelect.addEventListener('change', async () => {
        const val = themeSelect.value;
        await state.saveSetting('appTheme', val);
        document.documentElement.setAttribute('data-theme', val);
      });
    }

    // System prompt textarea
    const systemPromptTextarea = document.getElementById('set-system-prompt');
    if (systemPromptTextarea) {
      systemPromptTextarea.addEventListener('change', async () => {
        await state.saveSetting('systemPrompt', systemPromptTextarea.value);
      });
    }

    // Auto-generate report toggle
    const autoReport = document.getElementById('set-auto-report');
    if (autoReport) {
      autoReport.addEventListener('change', async () => {
        await state.saveSetting('autoGenerateReport', autoReport.checked);
      });
    }

    // Font size slider
    const fontSizeInput = document.getElementById('set-font-size');
    const fontSizeVal = document.getElementById('val-font-size');
    if (fontSizeInput) {
      fontSizeInput.addEventListener('input', () => {
        if (fontSizeVal) fontSizeVal.innerText = `${fontSizeInput.value}px`;
        const reportTarget = document.getElementById('report-render-target');
        if (reportTarget) {
          reportTarget.style.fontSize = `${fontSizeInput.value}px`;
        }
      });
      fontSizeInput.addEventListener('change', async () => {
        await state.saveSetting('reportFontSize', parseInt(fontSizeInput.value));
      });
    }

    // Keep alive change
    const keepAlive = document.getElementById('set-keep-alive');
    if (keepAlive) {
      keepAlive.addEventListener('change', async () => {
        await state.saveSetting('keepAlive', keepAlive.value.trim());
      });
    }

    // Context Limit change
    const contextLimit = document.getElementById('set-context-length');
    const contextVal = document.getElementById('val-context');
    if (contextLimit) {
      contextLimit.addEventListener('input', () => {
        if (contextVal) contextVal.innerText = contextLimit.value;
      });
      contextLimit.addEventListener('change', async () => {
        await state.saveSetting('contextLength', parseInt(contextLimit.value));
      });
    }
  }

  setupActionButtons() {
    // Ping connection button
    const pingBtn = document.getElementById('model-ping-btn');
    if (pingBtn) {
      pingBtn.addEventListener('click', () => {
        this.checkOllamaConnection();
      });
    }

    // Reset prompt button
    const resetPromptBtn = document.getElementById('prompt-reset-btn');
    if (resetPromptBtn) {
      resetPromptBtn.addEventListener('click', async () => {
        const defaultPrompt = `You are Galaxy, an elite AI deep research agent. You produce the highest quality intelligence reports in the industry.

CRITICAL RULES:
1. ONLY use the provided real-time SOURCE data. You are strictly prohibited from using any pre-trained internal knowledge, facts, dates, prices, or version numbers that are not explicitly found in the provided sources.
2. If the provided sources do not contain the specific information required to answer the query, you MUST state explicitly: "Information not available in retrieved search results." NEVER make up, assume, or fabricate any details, prices, or statistics.
3. Every claim, number, date, or price must be traced directly to a source URL. Cite all source URLs explicitly.
4. Cross-reference facts across multiple sources when possible.
5. Include confidence indicators: HIGH (3+ sources agree), MEDIUM (2 sources), LOW (1 source only). Basing statements on internal training memory is a violation of these indicators.

VISUAL CHARTS RULE:
When illustrating statistics, trends, distributions, ratios, or numeric tables, you are highly encouraged to generate visual interactive graphs. You can do this by outputting a code block with language "chart" containing a clean JSON specification. The app will automatically render it as a premium SVG chart:
- Bar chart: {"type": "bar", "title": "Market Growth", "labels": ["2024", "2025", "2026"], "datasets": [{"label": "Revenue", "data": [120, 190, 310]}]}
- Line area chart: {"type": "line", "title": "Trends Over Time", "labels": ["Jan", "Feb", "Mar"], "datasets": [{"label": "Visits", "data": [50, 85, 140]}]}
- Donut chart: {"type": "donut", "title": "Market Share", "labels": ["Search", "Direct", "Social"], "datasets": [{"label": "Percentage", "data": [65, 20, 15]}]}
Note: Provide ONLY ONE dataset per chart. Keep labels short and descriptive. Do not put comments or markdown inside the JSON code block.

OUTPUT FORMAT:
Your response MUST contain exactly two sections separated by markers:

---CHAT---
[Natural, professional, conversational summary of findings. No emoji. No markdown. Just clear paragraphs.]

---REPORT---
[Comprehensive markdown report with: Executive Summary, Key Findings, Detailed Analysis sections, Dynamic SVG Charts where applicable, Data Tables, Source Citations with URLs, and a Methodology Note at the end.]

---FOLLOWUPS---
[Exactly 3 follow-up research questions the user might want to explore next, one per line, prefixed with numbers 1. 2. 3.]`;

        await state.saveSetting('systemPrompt', defaultPrompt);
        const systemPromptTextarea = document.getElementById('set-system-prompt');
        if (systemPromptTextarea) systemPromptTextarea.value = defaultPrompt;
      });
    }

    // Reset app data
    const resetBtn = document.getElementById('set-clear-history-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to reset all cached settings and history? The app will reload.')) {
          try {
            await window.api.resetSettings();
            localStorage.clear();
            location.reload();
          } catch (e) {
            console.error('Failed to reset app data:', e);
          }
        }
      });
    }

    // Clear research history
    const clearHistoryBtn = document.getElementById('clear-research-history-btn');
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', async () => {
        if (confirm('Permanently delete all research history?')) {
          try {
            await window.api.clearResearchHistory();
            this.renderHistoryList([]);
          } catch (e) {
            console.error('Failed to clear research history:', e);
          }
        }
      });
    }
  }

  async loadHistoryList() {
    try {
      const history = await window.api.getResearchHistory();
      this.renderHistoryList(Array.isArray(history) ? history : []);
    } catch (e) {
      console.error('Failed to load research history:', e);
      this.renderHistoryList([]);
    }
  }

  renderHistoryList(items) {
    const container = document.getElementById('history-list-container');
    if (!container) return;

    container.innerHTML = '';

    if (!items || items.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'history-empty';
      empty.innerText = 'No research history recorded yet.';
      container.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const info = document.createElement('div');
      info.className = 'history-item-info';

      const queryText = document.createElement('span');
      queryText.className = 'history-item-query';
      queryText.innerText = item.query || 'Untitled research';

      const dateText = document.createElement('span');
      dateText.className = 'history-item-date';
      dateText.innerText = this.formatDate(item.timestamp || item.date);

      info.appendChild(queryText);
      info.appendChild(dateText);

      const loadBtn = document.createElement('button');
      loadBtn.className = 'history-load-btn';
      loadBtn.innerText = 'Load';
      loadBtn.addEventListener('click', () => {
        const input = document.getElementById('chat-input-field');
        if (input) {
          input.value = item.query || '';
          input.style.height = 'auto';
          input.style.height = `${input.scrollHeight}px`;
          input.focus();
        }
        this.closeOverlay();
      });

      row.appendChild(info);
      row.appendChild(loadBtn);
      container.appendChild(row);
    });
  }

  formatDate(timestamp) {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      const month = d.toLocaleString('default', { month: 'short' });
      const day = d.getDate();
      const year = d.getFullYear();
      const hours = d.getHours().toString().padStart(2, '0');
      const mins = d.getMinutes().toString().padStart(2, '0');
      return `${month} ${day}, ${year} at ${hours}:${mins}`;
    } catch (e) {
      return String(timestamp);
    }
  }
}

export const settings = new SettingsController();
