import { state } from './state.js';
import { report } from './report.js';
import { settings } from './settings.js';

class ChatController {
  constructor() {
    this.container = null;
    this.input = null;
    this.submitBtn = null;
    this.abortBtn = null;
    this.statusBar = null;
    this.statusText = null;
    this.clearWorkspaceBtn = null;
    this.historyBtn = null;
    
    this.fullBuffer = '';
    this.activeAiMessageContentEl = null;

    // Cleaners for event subscriptions
    this.statusUnsub = null;
    this.chunkUnsub = null;
    this.doneUnsub = null;
    this.errorUnsub = null;
    this.phaseUnsub = null;
    this.subQueriesUnsub = null;
    this.sourcesCountUnsub = null;
    this.sourceScrapedUnsub = null;
    this.sourcesDetailedUnsub = null;
    this.metricsUnsub = null;
  }

  init() {
    this.container = document.getElementById('chat-messages-container');
    this.input = document.getElementById('chat-input-field');
    this.submitBtn = document.getElementById('chat-submit-btn');
    this.abortBtn = document.getElementById('chat-abort-btn');
    this.statusBar = document.getElementById('research-status-bar');
    this.statusText = document.getElementById('research-status-text');
    this.clearWorkspaceBtn = document.getElementById('chat-clear-btn');
    this.historyBtn = document.getElementById('chat-history-btn');
    this.followupToggle = document.getElementById('chat-followup-toggle');

    this.setupListeners();
    this.setupSubscriptions();

    // Disable all inputs by default on startup until session is checked
    if (this.input) {
      this.input.disabled = true;
      this.input.placeholder = "Verifying authentication...";
    }
    if (this.submitBtn) {
      this.submitBtn.style.opacity = 0.4;
      this.submitBtn.style.pointerEvents = 'none';
    }
    if (this.clearWorkspaceBtn) {
      this.clearWorkspaceBtn.disabled = true;
      this.clearWorkspaceBtn.style.opacity = 0.4;
      this.clearWorkspaceBtn.style.pointerEvents = 'none';
    }
    if (this.historyBtn) {
      this.historyBtn.disabled = true;
      this.historyBtn.style.opacity = 0.4;
      this.historyBtn.style.pointerEvents = 'none';
    }
    if (this.followupToggle) {
      this.followupToggle.disabled = true;
      const toggleContainer = document.getElementById('chat-followup-toggle-container');
      if (toggleContainer) {
        toggleContainer.style.opacity = 0.4;
        toggleContainer.style.pointerEvents = 'none';
      }
    }

    // Render loading state inside chat messages
    if (this.container) {
      this.container.innerHTML = `
        <div id="chat-auth-loader" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); font-size: var(--font-size-sm); gap: 12px;">
          <div class="status-spinner" style="width: 16px; height: 16px; border: 1.5px solid var(--border-medium); border-top-color: var(--text-primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>Verifying authorization...</span>
        </div>
      `;
    }

    // Check initial authentication and configure chat panel
    this.checkAuthAndConfigure();

    // Listen to auth status changes to toggle inputs and prompts
    if (window.api && window.api.onAuthStatusChanged) {
      window.api.onAuthStatusChanged((status) => {
        this.handleAuthStatusChange(status);
      });
    }

    window.addEventListener('app:auth-changed', (e) => {
      this.handleAuthStatusChange(e.detail);
    });
  }

  setupListeners() {
    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.handleSend());
    }

    if (this.input) {
      // Premium multiline support: Enter makes new line, Ctrl+Enter sends
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSend();
        }
      });

      // Auto resize input box height dynamically
      this.input.addEventListener('input', () => {
        this.input.style.height = 'auto';
        this.input.style.height = `${this.input.scrollHeight}px`;
      });
    }

    if (this.abortBtn) {
      this.abortBtn.addEventListener('click', () => {
        this.abortGeneration();
      });
    }

    if (this.clearWorkspaceBtn) {
      this.clearWorkspaceBtn.addEventListener('click', () => {
        this.clearWorkspace();
      });
    }

    if (this.historyBtn) {
      this.historyBtn.addEventListener('click', () => {
        settings.openToTab('history');
      });
    }

    if (this.followupToggle) {
      this.followupToggle.addEventListener('change', (e) => {
        state.followUpModeEnabled = e.target.checked;
        console.log('[chat] Follow-up mode changed:', state.followUpModeEnabled);
      });
    }
  }

  setupSubscriptions() {
    // Unsubscribe from any old subscriptions first to prevent leaks
    if (this.statusUnsub) this.statusUnsub();
    if (this.chunkUnsub) this.chunkUnsub();
    if (this.doneUnsub) this.doneUnsub();
    if (this.errorUnsub) this.errorUnsub();
    if (this.phaseUnsub) this.phaseUnsub();
    if (this.subQueriesUnsub) this.subQueriesUnsub();
    if (this.sourcesCountUnsub) this.sourcesCountUnsub();
    if (this.sourceScrapedUnsub) this.sourceScrapedUnsub();
    if (this.sourcesDetailedUnsub) this.sourcesDetailedUnsub();
    if (this.metricsUnsub) this.metricsUnsub();

    // Subscribe to IPC streaming events
    this.statusUnsub = window.api.onResearchStatus((status) => {
      this.showStatus(status);
    });

    this.chunkUnsub = window.api.onResearchChunk((chunk) => {
      this.handleIncomingChunk(chunk);
    });

    this.doneUnsub = window.api.onResearchDone(() => {
      this.finishGeneration();
    });

    this.errorUnsub = window.api.onResearchError((err) => {
      this.handleGenerationError(err);
    });

    this.phaseUnsub = window.api.onResearchPhase((data) => {
      this.updatePhasesBar(data.phase, data.detail);
    });

    this.subQueriesUnsub = window.api.onResearchSubQueries((subQueries) => {
      this.renderSubQueries(subQueries);
    });

    this.sourcesCountUnsub = window.api.onResearchSourcesCount((count) => {
      state.sourcesCount = count;
    });

    this.sourceScrapedUnsub = window.api.onResearchSourceScraped((data) => {
      this.appendScrapeLog(data);
    });

    this.sourcesDetailedUnsub = window.api.onResearchSourcesDetailed((sources) => {
      state.sourcesDetailed = sources;
      report.updateMetaBar();
    });

    this.metricsUnsub = window.api.onResearchMetrics((metrics) => {
      this.updateMetricsText(metrics);
    });
  }

  clearWorkspace() {
    // Block action if unauthenticated (inputs disabled)
    if (this.input && this.input.disabled) return;

    // Reset report state
    report.clear();

    // Reset chat history
    state.chatHistory = [];

    // Clear report history versions
    state.reportVersions = [];

    // Clear chat messages container message wrappers
    if (this.container) {
      this.container.innerHTML = '';
    }

    // Reset phase indicators & clear temporary visual blocks
    state.resetPhases();

    const phasesBar = document.getElementById('research-phases-bar');
    if (phasesBar) phasesBar.style.display = 'none';

    const subQueriesDisplay = document.getElementById('sub-queries-display');
    if (subQueriesDisplay) subQueriesDisplay.style.display = 'none';

    const followupArea = document.getElementById('followup-area');
    if (followupArea) followupArea.style.display = 'none';

    const scrapeLog = document.getElementById('research-scrape-log');
    if (scrapeLog) {
      scrapeLog.innerHTML = '';
      scrapeLog.style.display = 'none';
      scrapeLog.classList.remove('collapsed');
    }

    // Reset input text & height
    if (this.input) {
      this.input.value = '';
      this.input.style.height = '24px';
      this.input.focus();
    }

    // Reset metrics
    this.updateMetricsText(null);

    // Reset follow-up toggle and state (lock & fade out until next report)
    if (this.followupToggle) {
      this.followupToggle.checked = false;
      this.followupToggle.disabled = true;
    }
    const toggleContainer = document.getElementById('chat-followup-toggle-container');
    if (toggleContainer) {
      toggleContainer.style.opacity = '0.4';
      toggleContainer.style.pointerEvents = 'none';
    }
    state.followUpModeEnabled = false;

    // Render empty state
    this.renderEmptyState();
  }

  async handleSend() {
    if (state.isGenerating) return;
    // Block submission if unauthenticated (inputs disabled)
    if (this.input && this.input.disabled) return;

    const query = this.input.value.trim();
    if (!query) return;

    // Clear container if it has empty state before rendering user message
    if (state.chatHistory.length === 0 && this.container) {
      this.container.innerHTML = '';
    }

    // Clear input panel
    this.input.value = '';
    this.input.style.height = '24px';

    // 1. Render User Message
    this.renderMessage('User', query);
    
    // Save query to state history
    state.chatHistory.push({ role: 'user', content: query });
    state.isGenerating = true;
    this.fullBuffer = '';
    
    // Reset phase indicators & clear temporary UIs
    state.resetPhases();
    
    const phasesBar = document.getElementById('research-phases-bar');
    if (phasesBar) phasesBar.style.display = 'none';
    
    const subQueriesDisplay = document.getElementById('sub-queries-display');
    if (subQueriesDisplay) subQueriesDisplay.style.display = 'none';
    
    const followupArea = document.getElementById('followup-area');
    if (followupArea) followupArea.style.display = 'none';

    const scrapeLog = document.getElementById('research-scrape-log');
    if (scrapeLog) {
      scrapeLog.innerHTML = '';
      scrapeLog.style.display = 'none';
      scrapeLog.classList.remove('collapsed');
    }

    // Toggle button visibility
    if (this.submitBtn) this.submitBtn.style.display = 'none';
    if (this.abortBtn) this.abortBtn.style.display = 'flex';

    // Clear metrics
    this.updateMetricsText(null);

    // 2. Prepare AI streaming message container
    this.activeAiMessageContentEl = this.renderMessage('Knovant', '', true);

    // 3. Initiate Deep Research loop
    try {
      this.showStatus('Initiating deep research...');
      // Pass prior history turns only, excluding the query itself, and send activeReport state context & followUpModeEnabled!
      await window.api.startResearch(
        query,
        state.settings.selectedModel,
        state.chatHistory.slice(0, -1),
        state.currentReportBuffer,
        state.followUpModeEnabled
      );
    } catch (e) {
      this.handleGenerationError(e.message);
    }
  }

  handleIncomingChunk(chunk) {
    this.fullBuffer += chunk;

    const parsed = this.parseSplitStream(this.fullBuffer);

    // Update Chat Panel (Natural text parsed as markdown)
    if (this.activeAiMessageContentEl) {
      const cleanChat = parsed.chat;
      if (cleanChat) {
        // Clear typing indicator if present
        const typing = this.activeAiMessageContentEl.querySelector('.typing-indicator');
        if (typing) {
          this.activeAiMessageContentEl.innerHTML = '';
        }

        if (window.marked && typeof window.marked.parse === 'function') {
          this.activeAiMessageContentEl.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(cleanChat)) : window.marked.parse(cleanChat);
        } else {
          this.activeAiMessageContentEl.innerText = cleanChat;
        }
      }
    }

    // Update Report Panel (Structured markdown)
    if (parsed.report) {
      state.currentReportBuffer = parsed.report;
      report.update(parsed.report);
    }

    this.scrollToBottom();
  }

  parseSplitStream(buffer) {
    let chat = '';
    let reportText = '';
    let followupsText = '';

    // Matches various formats of CHAT, REPORT, FOLLOWUPS (e.g. ---CHAT---, ### CHAT, CHAT:)
    const chatRegex = /(?:^|\n)(?:(?:---|###|\*\*|\[|#)\s*CHAT\s*(?:---|###|\*\*|\]|#|:)?|CHAT:)(?:\s*\n|\s*$)/i;
    const reportRegex = /(?:^|\n)(?:(?:---|###|\*\*|\[|#)\s*REPORT\s*(?:---|###|\*\*|\]|#|:)?|REPORT:)(?:\s*\n|\s*$)/i;
    const followupsRegex = /(?:^|\n)(?:(?:---|###|\*\*|\[|#)\s*(?:FOLLOWUPS|FOLLOW-UPS|FOLLOW\s*UP|FOLLOW\s*UPS)\s*(?:---|###|\*\*|\]|#|:)?|(?:FOLLOWUPS|FOLLOW-UPS|FOLLOW\s*UP|FOLLOW\s*UPS):)(?:\s*\n|\s*$)/i;

    const chatMatch = buffer.match(chatRegex);
    const reportMatch = buffer.match(reportRegex);
    const followupsMatch = buffer.match(followupsRegex);

    const sections = [];
    if (chatMatch) {
      sections.push({ name: 'chat', index: chatMatch.index, length: chatMatch[0].length });
    }
    if (reportMatch) {
      sections.push({ name: 'report', index: reportMatch.index, length: reportMatch[0].length });
    }
    if (followupsMatch) {
      sections.push({ name: 'followups', index: followupsMatch.index, length: followupsMatch[0].length });
    }

    sections.sort((a, b) => a.index - b.index);

    if (sections.length === 0) {
      chat = buffer;
    } else {
      if (sections[0].index > 0) {
        chat += buffer.substring(0, sections[0].index);
      }

      for (let i = 0; i < sections.length; i++) {
        const current = sections[i];
        const start = current.index + current.length;
        const end = (i + 1 < sections.length) ? sections[i + 1].index : buffer.length;
        const val = buffer.substring(start, end).trim();

        if (current.name === 'chat') {
          chat += (chat ? '\n' : '') + val;
        } else if (current.name === 'report') {
          reportText = val;
        } else if (current.name === 'followups') {
          followupsText = val;
        }
      }
    }

    return {
      chat: chat.trim(),
      report: reportText.trim(),
      followups: followupsText.trim()
    };
  }

  updatePhasesBar(activePhaseName, detail) {
    const bar = document.getElementById('research-phases-bar');
    if (!bar) return;

    bar.style.display = 'flex';
    state.setPhaseActive(activePhaseName);

    state.researchPhases.forEach((p, idx) => {
      const dot = bar.querySelector(`.phase-dot[data-phase="${p.name}"]`);
      const label = bar.querySelector(`.phase-label[data-phase-label="${p.name}"]`);

      if (dot) {
        dot.className = 'phase-dot';
        if (p.status === 'active') dot.classList.add('active');
        if (p.status === 'completed') dot.classList.add('completed');
      }

      if (label) {
        label.className = 'phase-label';
        if (p.status === 'active') label.classList.add('active');
        if (p.status === 'completed') label.classList.add('completed');
      }

      // Connecting lines
      if (idx < state.researchPhases.length - 1) {
        const line = bar.querySelector(`.phase-line[data-line="${idx}"]`);
        if (line) {
          if (p.status === 'completed') {
            line.classList.add('completed');
          } else {
            line.classList.remove('completed');
          }
        }
      }
    });

    if (detail) {
      this.showStatus(detail);
    }
  }

  renderSubQueries(subQueries) {
    const container = document.getElementById('sub-queries-display');
    if (!container) return;

    state.subQueries = subQueries;
    container.innerHTML = '';
    
    if (subQueries && subQueries.length > 0) {
      container.style.display = 'flex';
      subQueries.forEach(q => {
        const el = document.createElement('div');
        el.className = 'sub-query-item';
        el.innerText = `> Investigating sub-search: "${q}"`;
        container.appendChild(el);
      });
    } else {
      container.style.display = 'none';
    }
  }

  appendScrapeLog(data) {
    const container = document.getElementById('research-scrape-log');
    if (!container) return;

    container.style.display = 'block';
    
    // Save to state logs
    state.scrapeLogs.push(data);

    const completedCount = state.scrapeLogs.length;
    const totalCount = state.sourcesCount || '?';
    const isCollapsed = container.classList.contains('collapsed');

    // Header
    const headerHtml = `
      <div class="scrape-log-header" id="scrape-log-toggle">
        <span class="scrape-log-title">Scraped Sources (${completedCount}/${totalCount})</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="scrape-log-toggle-text">${isCollapsed ? 'Expand' : 'Collapse'}</span>
          <svg class="scrape-log-toggle-icon" viewBox="0 0 24 24" style="width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 2.5; transition: transform var(--transition-normal); ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
    `;

    // Scanner
    let scannerHtml = '';
    const isDone = typeof totalCount === 'number' && completedCount >= totalCount;
    if (!isDone) {
      scannerHtml = `
        <div class="scrape-track-container" style="margin: 8px 0;">
          <div class="scrape-line-track">
            <div class="scrape-circle-icon">
              <svg viewBox="0 0 24 24">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
          </div>
        </div>
      `;
    }

    // Body
    let bodyHtml = `<div class="scrape-log-body" style="${isCollapsed ? 'display: none;' : 'display: flex;'}">`;
    state.scrapeLogs.forEach(log => {
      let domain = 'Website';
      try {
        domain = new URL(log.url).hostname;
      } catch (e) {
        domain = log.url;
      }
      
      const isSuccess = log.status === 'Success';
      const statusClass = isSuccess ? 'success' : 'failed';
      const sizeKb = log.size ? `${(log.size / 1024).toFixed(1)} KB` : '0 KB';
      const trustScore = isSuccess ? `[Trust: ${log.score}]` : '';

      bodyHtml += `
        <div class="scrape-log-item">
          <div class="scrape-status-dot ${statusClass}"></div>
          <span class="scrape-item-domain">${window.DOMPurify ? window.DOMPurify.sanitize(domain) : domain.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
          <span class="scrape-item-details">${isSuccess ? `${sizeKb} ${trustScore}` : 'Failed'}</span>
        </div>
      `;
    });
    bodyHtml += `</div>`;

    container.innerHTML = headerHtml + scannerHtml + bodyHtml;

    // Attach toggle handler
    const toggleBtn = container.querySelector('#scrape-log-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        container.classList.toggle('collapsed');
        const body = container.querySelector('.scrape-log-body');
        const icon = container.querySelector('.scrape-log-toggle-icon');
        const text = container.querySelector('.scrape-log-toggle-text');
        const nextCollapsedState = container.classList.contains('collapsed');
        
        if (nextCollapsedState) {
          if (body) body.style.display = 'none';
          if (icon) icon.style.transform = 'rotate(-90deg)';
          if (text) text.innerText = 'Expand';
        } else {
          if (body) body.style.display = 'flex';
          if (icon) icon.style.transform = 'none';
          if (text) text.innerText = 'Collapse';
        }
      });
    }
  }

  renderFollowups(followupsText) {
    const area = document.getElementById('followup-area');
    if (!area) return;

    area.innerHTML = '';
    
    const lines = followupsText
      .split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.length > 5);

    state.followups = lines;

    if (lines.length > 0) {
      area.style.display = 'flex';
      lines.forEach(q => {
        const item = document.createElement('div');
        item.className = 'followup-item';
        item.innerText = q;
        item.addEventListener('click', () => {
          if (this.input) {
            this.input.value = q;
            this.input.style.height = 'auto';
            this.input.style.height = `${this.input.scrollHeight}px`;
            area.style.display = 'none';
            this.handleSend();
          }
        });
        area.appendChild(item);
      });
    } else {
      area.style.display = 'none';
    }
  }

  renderMessage(sender, text, isStreaming = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    
    // Add relative timestamp next to sender
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.innerHTML = `${sender} <span class="message-timestamp">${timeStr}</span>`;

    const content = document.createElement('div');
    content.className = 'message-content';
    if (isStreaming) {
      content.classList.add('streaming-cursor');
      content.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    } else {
      if (window.marked && typeof window.marked.parse === 'function') {
        content.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(text)) : window.marked.parse(text);
      } else {
        content.innerText = text;
      }
    }

    wrapper.appendChild(meta);
    wrapper.appendChild(content);

    // Build message actions (Copy, Regenerate)
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-action-btn copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.innerText = 'Copy';
    copyBtn.addEventListener('click', () => {
      const rawText = content.innerText;
      navigator.clipboard.writeText(rawText);
      copyBtn.innerText = 'Copied!';
      setTimeout(() => { copyBtn.innerText = 'Copy'; }, 1500);
    });
    actions.appendChild(copyBtn);

    if (sender === 'Knovant' && !isStreaming) {
      const regenBtn = document.createElement('button');
      regenBtn.className = 'message-action-btn regen-btn';
      regenBtn.title = 'Regenerate this response';
      regenBtn.innerText = 'Regenerate';
      regenBtn.addEventListener('click', () => {
        if (state.isGenerating) return;
        this.handleRegenerate();
      });
      actions.appendChild(regenBtn);
    }

    wrapper.appendChild(actions);

    if (this.container) {
      this.container.appendChild(wrapper);
      this.scrollToBottom();
    }

    return content;
  }

  updateMetricsText(metrics) {
    const el = document.getElementById('research-metrics-text');
    if (!el) return;
    if (metrics && metrics.speed && metrics.tokenCount) {
      el.style.display = 'inline';
      el.innerText = `${metrics.speed} T/S | ${metrics.tokenCount} TOKENS`;
    } else {
      el.style.display = 'none';
      el.innerText = '';
    }
  }

  renderEmptyState() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="chat-empty-state">
        <div class="chat-empty-title">Start a Research Session</div>
        <div class="chat-empty-subtitle">Provide a query to decompose, search the live web, rank reliability of parsed sources, and draft a high-fidelity intelligence report.</div>
        <div class="chat-chips-container">
          <button class="chat-chip" data-query="Deep dive into Quantum Computing progress in 2026">Deconstruct Quantum Computing progress in 2026</button>
          <button class="chat-chip" data-query="Compare React Server Components vs Svelte Runes performance">Compare RSC vs Svelte Runes performance</button>
          <button class="chat-chip" data-query="Draft an analysis of global semi-conductor supply chain trends">Analyze global semi-conductor supply chain trends</button>
          <button class="chat-chip" data-query="Explain the current state of Solid State battery commercialization">Commercialization of Solid State batteries</button>
        </div>
      </div>
    `;

    // Attach event listeners to chips
    const chips = this.container.querySelectorAll('.chat-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (this.input) {
          this.input.value = query;
          this.input.style.height = 'auto';
          this.input.style.height = `${this.input.scrollHeight}px`;
          this.handleSend();
        }
      });
    });
  }

  handleRegenerate() {
    if (state.isGenerating) return;

    let lastUserQueryIndex = -1;
    for (let i = state.chatHistory.length - 1; i >= 0; i--) {
      if (state.chatHistory[i].role === 'user') {
        lastUserQueryIndex = i;
        break;
      }
    }

    if (lastUserQueryIndex !== -1) {
      const query = state.chatHistory[lastUserQueryIndex].content;
      state.chatHistory = state.chatHistory.slice(0, lastUserQueryIndex);

      if (this.container) {
        this.container.innerHTML = '';
        state.chatHistory.forEach(msg => {
          const sender = msg.role === 'user' ? 'User' : 'Knovant';
          this.renderMessage(sender, msg.content, false);
        });
      }

      if (this.input) {
        this.input.value = query;
        this.handleSend();
      }
    }
  }

  async abortGeneration() {
    await window.api.abortChat();
    this.showStatus('Research canceled.');
    setTimeout(() => this.hideStatus(), 2000);
    this.finishGeneration();
  }

  finishGeneration() {
    state.isGenerating = false;

    // Remove streaming blink cursor and render final markdown
    if (this.activeAiMessageContentEl) {
      this.activeAiMessageContentEl.classList.remove('streaming-cursor');
      const parsed = this.parseSplitStream(this.fullBuffer);
      if (parsed.chat) {
        if (window.marked && typeof window.marked.parse === 'function') {
          this.activeAiMessageContentEl.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(window.marked.parse(parsed.chat)) : window.marked.parse(parsed.chat);
        } else {
          this.activeAiMessageContentEl.innerText = parsed.chat;
        }
      }
    }

    // Add regenerate button to actions of the newly completed Knovant response
    if (this.container) {
      const wrappers = this.container.querySelectorAll('.message-wrapper');
      if (wrappers.length > 0) {
        const lastWrapper = wrappers[wrappers.length - 1];
        const meta = lastWrapper.querySelector('.message-meta');
        if (meta && meta.innerText.includes('Knovant')) {
          const actions = lastWrapper.querySelector('.message-actions');
          if (actions && !actions.querySelector('.regen-btn')) {
            const regenBtn = document.createElement('button');
            regenBtn.className = 'message-action-btn regen-btn';
            regenBtn.title = 'Regenerate this response';
            regenBtn.innerText = 'Regenerate';
            regenBtn.addEventListener('click', () => {
              if (state.isGenerating) return;
              this.handleRegenerate();
            });
            actions.appendChild(regenBtn);
          }
        }
      }
    }

    // Save active response to state chat history
    const parsed = this.parseSplitStream(this.fullBuffer);
    state.chatHistory.push({ role: 'assistant', content: parsed.chat || this.fullBuffer });

    // Save report versions when done
    if (parsed.report) {
      const userPrompt = state.chatHistory[state.chatHistory.length - 2]?.content || 'Research Draft';
      state.reportVersions.push({
        query: userPrompt,
        markdown: parsed.report,
        sourcesDetailed: [...state.sourcesDetailed],
        sourcesCount: state.sourcesCount
      });
      report.renderVersionSelect();

      // Save session history serialization to storage
      window.api.saveResearchHistory({
        query: userPrompt,
        timestamp: Date.now(),
        reportMarkdown: parsed.report
      }).catch(e => console.error('Failed to save session to local history store:', e));

      // Auto-enable and unlock followup mode once a report is generated!
      if (this.followupToggle) {
        this.followupToggle.disabled = false;
        this.followupToggle.checked = true;
        state.followUpModeEnabled = true;
        console.log('[chat] Unlocked and auto-enabled Followup Mode upon report generation.');
      }
      const toggleContainer = document.getElementById('chat-followup-toggle-container');
      if (toggleContainer) {
        toggleContainer.style.opacity = '1';
        toggleContainer.style.pointerEvents = 'auto';
      }
    }

    // Extract and display suggested next questions
    if (parsed.followups && state.settings.enableFollowups) {
      this.renderFollowups(parsed.followups);
    }

    // Render all research phase indicators as complete
    state.completeAllPhases();
    this.updatePhasesBar('synthesize');

    // Toggle back action buttons
    if (this.submitBtn) this.submitBtn.style.display = 'flex';
    if (this.abortBtn) this.abortBtn.style.display = 'none';

    this.hideStatus();
    this.scrollToBottom();
  }

  handleGenerationError(errMessage) {
    this.showStatus(`Error: ${errMessage}`);
    if (this.activeAiMessageContentEl) {
      this.activeAiMessageContentEl.classList.remove('streaming-cursor');
      const errEl = document.createElement('div');
      errEl.style.color = '#c92a2a';
      errEl.style.fontSize = '12px';
      errEl.style.fontWeight = '500';
      errEl.style.marginTop = '8px';
      errEl.textContent = `Generation error: ${errMessage}`;
      this.activeAiMessageContentEl.appendChild(errEl);
    }
    this.finishGeneration();
  }

  showStatus(text) {
    if (this.statusBar && this.statusText) {
      this.statusBar.classList.add('active');
      this.statusText.innerText = text;
    }
  }

  hideStatus() {
    if (this.statusBar) {
      this.statusBar.classList.remove('active');
    }
  }

  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  async checkAuthAndConfigure() {
    try {
      const status = await window.api.getUser();
      this.handleAuthStatusChange(status);
    } catch (e) {
      this.handleAuthStatusChange({ isAuthenticated: false });
    }
  }

  handleAuthStatusChange(status) {
    if (!status.isAuthenticated) {
      if (this.input) {
        this.input.disabled = true;
        this.input.placeholder = "Authentication required. Please sign in to start research...";
      }
      if (this.submitBtn) {
        this.submitBtn.style.opacity = 0.4;
        this.submitBtn.style.pointerEvents = 'none';
      }
      if (this.clearWorkspaceBtn) {
        this.clearWorkspaceBtn.disabled = true;
        this.clearWorkspaceBtn.style.opacity = 0.4;
        this.clearWorkspaceBtn.style.pointerEvents = 'none';
      }
      if (this.historyBtn) {
        this.historyBtn.disabled = true;
        this.historyBtn.style.opacity = 0.4;
        this.historyBtn.style.pointerEvents = 'none';
      }
      if (this.followupToggle) {
        this.followupToggle.disabled = true;
        const toggleContainer = document.getElementById('chat-followup-toggle-container');
        if (toggleContainer) {
          toggleContainer.style.opacity = 0.4;
          toggleContainer.style.pointerEvents = 'none';
        }
      }
      this.renderLoginPrompt();
    } else {
      if (this.input) {
        this.input.disabled = false;
        this.input.placeholder = "Ask anything or request a deep report...";
      }
      if (this.submitBtn) {
        this.submitBtn.style.opacity = 1;
        this.submitBtn.style.pointerEvents = 'all';
      }
      if (this.clearWorkspaceBtn) {
        this.clearWorkspaceBtn.disabled = false;
        this.clearWorkspaceBtn.style.opacity = 1;
        this.clearWorkspaceBtn.style.pointerEvents = 'all';
      }
      if (this.historyBtn) {
        this.historyBtn.disabled = false;
        this.historyBtn.style.opacity = 1;
        this.historyBtn.style.pointerEvents = 'all';
      }
      if (this.followupToggle) {
        const activeReport = document.getElementById('report-markdown-body');
        const hasContent = activeReport && activeReport.innerHTML.trim().length > 0;
        if (hasContent) {
          this.followupToggle.disabled = false;
          const toggleContainer = document.getElementById('chat-followup-toggle-container');
          if (toggleContainer) {
            toggleContainer.style.opacity = 1;
            toggleContainer.style.pointerEvents = 'all';
          }
        }
      }
      this.removeLoginPrompt();

      // Also clean up initial loader if present and render empty state
      const loader = document.getElementById('chat-auth-loader');
      if (loader) {
        loader.remove();
        if (state.chatHistory.length === 0) {
          this.renderEmptyState();
        }
      }
    }
  }

  renderLoginPrompt() {
    if (document.getElementById('chat-login-prompt')) return;

    const promptEl = document.createElement('div');
    promptEl.id = 'chat-login-prompt';
    promptEl.className = 'chat-login-prompt-wrapper';
    promptEl.innerHTML = `
      <div class="chat-login-prompt-content">
        <h3 class="login-prompt-title">Sign in to Knovant</h3>
        <p class="login-prompt-desc">
          To run deep research queries, estimate tokens, and synchronize your session, please authenticate first.
        </p>
        <button type="button" class="chat-login-google-btn" id="chat-google-login-trigger">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.54 14.98 1 12 1 7.35 1 3.37 3.65 1.39 7.56l3.85 3C6.17 7.59 8.87 5.04 12 5.04z"/><path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.34H12v4.47h6.44c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.97 3.39-4.88 3.39-8.52z"/><path fill="#FBBC05" d="M5.24 14.56c-.24-.72-.38-1.5-.38-2.31s.14-1.59.38-2.31L1.39 6.94C.5 8.73 0 10.73 0 12.8s.5 4.07 1.39 5.86l3.85-3.1z"/><path fill="#34A853" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.66-2.84c-1.1.74-2.52 1.18-4.3 1.18-3.13 0-5.83-2.55-6.76-5.52l-3.85 3C3.37 20.35 7.35 23 12 23z"/></svg>
          Continue with Google
        </button>
        <div class="login-prompt-divider">or</div>
        <button type="button" class="chat-login-settings-btn" id="chat-settings-login-trigger">
          Open Settings Authentication
        </button>
      </div>
    `;

    this.container.innerHTML = '';
    this.container.appendChild(promptEl);

    const googleTrigger = document.getElementById('chat-google-login-trigger');
    if (googleTrigger) {
      googleTrigger.addEventListener('click', async () => {
        googleTrigger.disabled = true;
        googleTrigger.innerText = 'Connecting...';
        await window.api.signInWithGoogle();
      });
    }

    const settingsTrigger = document.getElementById('chat-settings-login-trigger');
    if (settingsTrigger) {
      settingsTrigger.addEventListener('click', () => {
        import('./settings.js').then(module => {
          module.settings.openToTab('profile');
        });
      });
    }
  }

  removeLoginPrompt() {
    const promptEl = document.getElementById('chat-login-prompt');
    if (promptEl) {
      promptEl.remove();
      if (state.chatHistory.length === 0) {
        this.renderEmptyState();
      }
    }
  }
}

export const chat = new ChatController();






