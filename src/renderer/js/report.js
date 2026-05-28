import { state } from './state.js';

class ReportController {
  constructor() {
    this.target = null;
    this.emptyState = null;
    this.scrollContainer = null;
    this.tocScrollHandler = null;
    this.versionSelect = null;
    this.lastRenderTime = 0;
    this.renderTimeout = null;
  }

  init() {
    this.target = document.getElementById('report-render-target');
    this.emptyState = document.getElementById('report-empty-state-view');
    this.scrollContainer = document.getElementById('report-scroll-container');

    this.copyBtn = document.getElementById('report-copy-btn');
    this.exportHtmlBtn = document.getElementById('report-export-html-btn');
    this.exportPdfBtn = document.getElementById('report-export-pdf-btn');
    this.exportMdBtn = document.getElementById('report-export-md-btn');
    this.clearBtn = document.getElementById('report-clear-btn');
    this.versionSelect = document.getElementById('report-version-select');

    this.setupActions();
    this.applyStylesFromState();
    this.createConfidencePopup();

    if (this.scrollContainer) {
      this.scrollContainer.addEventListener('scroll', () => this.updateReadingProgress());
    }

    // Event delegation for confidence popup triggers
    const metaBar = document.getElementById('report-meta-bar');
    if (metaBar) {
      metaBar.addEventListener('click', (e) => {
        if (e.target && (e.target.id === 'confidence-badge-trigger' || e.target.id === 'confidence-details-toggle')) {
          e.stopPropagation();
          const popup = document.getElementById('confidence-popup');
          if (popup) {
            popup.classList.toggle('active');
          }
        }
      });
    }

    // Close popup if user clicks anywhere outside of it
    document.addEventListener('click', (e) => {
      const popup = document.getElementById('confidence-popup');
      if (popup && popup.classList.contains('active')) {
        const badgeTrigger = document.getElementById('confidence-badge-trigger');
        const detailsToggle = document.getElementById('confidence-details-toggle');
        if (!popup.contains(e.target) && e.target !== badgeTrigger && e.target !== detailsToggle) {
          popup.classList.remove('active');
        }
      }
    });
  }

  applyStylesFromState() {
    if (this.target) {
      this.target.style.fontSize = `${state.settings.reportFontSize}px`;
    }
  }

  update(markdown, force = false) {
    if (!this.target || !this.emptyState) return;

    if (!markdown || !markdown.trim()) {
      this.clear();
      return;
    }

    const now = Date.now();
    // Throttle renders during streaming to max 2 per second (500ms spacing)
    if (!force && state.isGenerating && (now - this.lastRenderTime < 500)) {
      if (this.renderTimeout) clearTimeout(this.renderTimeout);
      this.renderTimeout = setTimeout(() => {
        this.update(markdown, false);
      }, 500 - (now - this.lastRenderTime));
      return;
    }

    if (this.renderTimeout) {
      clearTimeout(this.renderTimeout);
      this.renderTimeout = null;
    }
    this.lastRenderTime = now;

    // Hide empty state and show target wrapper
    this.emptyState.style.display = 'none';
    this.target.style.display = 'block';

    try {
      // Parse markdown to HTML using Marked library loaded in HTML header
      const html = window.marked.parse(markdown);
      this.target.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;

      // Handle all links in report to open in external browser securely
      const links = this.target.querySelectorAll('a');
      links.forEach(l => {
        l.addEventListener('click', (e) => {
          e.preventDefault();
          if (l.href) {
            window.api.openExternal(l.href).catch(err => {
              console.error('Failed to open link external:', err);
            });
          }
        });
      });

      // Post-process HTML for custom SVG chart blocks
      const codeBlocks = this.target.querySelectorAll('pre code');
      codeBlocks.forEach(code => {
        if (code.classList.contains('language-chart') || code.innerText.trim().startsWith('{') && code.innerText.includes('"type"')) {
          try {
            const spec = JSON.parse(code.innerText.trim());
            const chartHtml = this.renderSVGChart(spec);
            if (chartHtml) {
              const preElement = code.parentElement;
              const container = document.createElement('div');
              container.className = 'report-chart-container';
              container.innerHTML = chartHtml;
              preElement.replaceWith(container);
            }
          } catch (err) {
            // Keep original pre-block if JSON parse fails
          }
        }
      });

      // Generate dynamic Table of Contents and update stats meta bar
      this.generateTOC();
      this.updateMetaBar();
      this.updateReadingProgress();

    } catch (e) {
      console.error('Failed to parse markdown:', e);
      this.target.innerText = markdown;
    }
  }

  clear() {
    if (this.target && this.emptyState) {
      this.target.innerHTML = '';
      this.target.style.display = 'none';
      this.emptyState.style.display = 'flex';
      
      const withToc = document.getElementById('report-with-toc');
      if (withToc) withToc.style.display = 'none';
      
      const metaBar = document.getElementById('report-meta-bar');
      if (metaBar) metaBar.style.display = 'none';

      // Hide popup if open
      const popup = document.getElementById('confidence-popup');
      if (popup) popup.classList.remove('active');

      // Hide version select
      if (this.versionSelect) {
        this.versionSelect.innerHTML = '';
        this.versionSelect.style.display = 'none';
      }

      // Hide reading progress
      const progressContainer = document.getElementById('reading-progress-container');
      if (progressContainer) progressContainer.style.display = 'none';
      const progressBar = document.getElementById('reading-progress-bar');
      if (progressBar) progressBar.style.width = '0%';

      // Clean up scroll listener
      if (this.scrollContainer && this.tocScrollHandler) {
        this.scrollContainer.removeEventListener('scroll', this.tocScrollHandler);
        this.tocScrollHandler = null;
      }

      state.currentReportBuffer = '';
      state.sourcesCount = 0;
    }
  }

  generateTOC() {
    const toc = document.getElementById('report-toc');
    const withToc = document.getElementById('report-with-toc');
    if (!toc || !withToc) return;

    toc.innerHTML = '';
    
    // Find all h2 and h3 inside report-render-target
    const headings = this.target.querySelectorAll('h2, h3');
    if (headings.length === 0) {
      withToc.style.display = 'block';
      toc.style.display = 'none';
      return;
    }

    withToc.style.display = 'flex';
    toc.style.display = 'flex';

    headings.forEach((heading, index) => {
      // Ensure unique ID for anchor
      const id = heading.id || `heading-${index}`;
      heading.id = id;

      const link = document.createElement('div');
      link.className = `toc-heading toc-${heading.tagName.toLowerCase()}`;
      link.innerText = heading.innerText;
      link.setAttribute('data-target', id);

      link.addEventListener('click', () => {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Set active styling locally
        toc.querySelectorAll('.toc-heading').forEach(el => el.classList.remove('active'));
        link.classList.add('active');
      });

      toc.appendChild(link);
    });

    this.setupTOCScrollHighlight();
  }

  setupTOCScrollHighlight() {
    const toc = document.getElementById('report-toc');
    if (!toc) return;

    const headings = Array.from(this.target.querySelectorAll('h2, h3'));
    if (headings.length === 0) return;

    const onScroll = () => {
      let activeId = '';
      const threshold = 120; // viewport top threshold

      for (const heading of headings) {
        const rect = heading.getBoundingClientRect();
        if (rect.top <= threshold) {
          activeId = heading.id;
        } else {
          break;
        }
      }

      if (activeId) {
        toc.querySelectorAll('.toc-heading').forEach(link => {
          if (link.getAttribute('data-target') === activeId) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        });
      }
    };

    if (this.scrollContainer) {
      // Remove any prior scroll handler to prevent memory leaks
      if (this.tocScrollHandler) {
        this.scrollContainer.removeEventListener('scroll', this.tocScrollHandler);
      }
      this.tocScrollHandler = onScroll;
      this.scrollContainer.addEventListener('scroll', this.tocScrollHandler);
    }
  }

  createConfidencePopup() {
    let popup = document.getElementById('confidence-popup');
    if (popup) popup.remove();

    popup = document.createElement('div');
    popup.className = 'confidence-popup';
    popup.id = 'confidence-popup';

    const reportPanel = document.querySelector('.report-panel');
    if (reportPanel) {
      reportPanel.appendChild(popup);
    }
  }

  renderVersionSelect() {
    if (!this.versionSelect) return;

    if (state.reportVersions.length <= 1) {
      this.versionSelect.style.display = 'none';
      return;
    }

    this.versionSelect.innerHTML = '';
    state.reportVersions.forEach((v, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.innerText = `Draft v${idx + 1}: ${v.query.substring(0, 18)}...`;
      if (idx === state.reportVersions.length - 1) {
        opt.selected = true;
      }
      this.versionSelect.appendChild(opt);
    });

    this.versionSelect.style.display = 'inline-block';
  }

  updateMetaBar() {
    const metaBar = document.getElementById('report-meta-bar');
    const readingTimeEl = document.getElementById('report-reading-time');
    const countEl = document.getElementById('report-sources-count');
    const confidenceEl = document.getElementById('report-confidence-summary');

    if (!metaBar) return;

    const text = this.target.innerText || '';
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const minutes = Math.max(1, Math.round(words / 200));

    if (readingTimeEl) {
      readingTimeEl.innerText = `${minutes} min read`;
    }

    if (countEl) {
      countEl.innerText = `${state.sourcesCount || 0} sources cited`;
    }

    if (confidenceEl) {
      // ── Intelligent Factual Scoring Logic ──
      let highCount = 0;
      let mediumCount = 0;
      let lowCount = 0;

      // Extract scores directly from the active scraped source telemetry arrays
      if (state.sourcesDetailed && state.sourcesDetailed.length > 0) {
        state.sourcesDetailed.forEach(s => {
          if (s.status === 'Success') {
            if (s.score === 'HIGH') highCount++;
            else if (s.score === 'MEDIUM') mediumCount++;
            else if (s.score === 'LOW') lowCount++;
          }
        });
      }

      // Naive text regex count fallback if sources are not fully initialized yet
      if (highCount === 0 && mediumCount === 0 && lowCount === 0) {
        const regexHigh = /confidence[\s:]*(indicators?[\s:]*)?high/gi;
        const regexMedium = /confidence[\s:]*(indicators?[\s:]*)?medium/gi;
        const regexLow = /confidence[\s:]*(indicators?[\s:]*)?low/gi;

        highCount = (text.match(regexHigh) || []).length;
        mediumCount = (text.match(regexMedium) || []).length;
        lowCount = (text.match(regexLow) || []).length;
      }

      let confidence = 'MEDIUM';
      let badgeClass = 'medium';

      if (highCount > lowCount && highCount > mediumCount) {
        confidence = 'HIGH';
        badgeClass = 'high';
      } else if (lowCount > highCount && lowCount > mediumCount) {
        confidence = 'LOW';
        badgeClass = 'low';
      }

      confidenceEl.innerHTML = `
        Confidence: <span class="confidence-badge ${badgeClass}" id="confidence-badge-trigger" style="cursor: pointer;" title="Toggle Breakdown">${confidence}</span>
        <button class="confidence-toggle-btn" id="confidence-details-toggle" title="Toggle Breakdown">Details</button>
      `;

      // Update the internal details values inside the dynamic popup
      this.updateConfidencePopupValues(highCount, mediumCount, lowCount);
    }

    metaBar.style.display = 'flex';
  }

  updateConfidencePopupValues(high, medium, low) {
    const popup = document.getElementById('confidence-popup');
    if (!popup) return;

    const total = high + medium + low || 1;
    const highPct = Math.round((high / total) * 100);
    const mediumPct = Math.round((medium / total) * 100);
    const lowPct = Math.round((low / total) * 100);

    // Build the dynamic audited domains list if available
    let domainsHtml = '';
    if (state.sourcesDetailed && state.sourcesDetailed.length > 0) {
      domainsHtml = `
        <div style="border-top: 1px solid var(--border-light); margin-top: 12px; padding-top: 10px; display: flex; flex-direction: column; gap: 6px;">
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-tertiary); letter-spacing: 0.03em;">Audited Domains Log</span>
          <div style="max-height: 90px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 4px;" id="popup-domain-scroll">
      `;

      state.sourcesDetailed.forEach(s => {
        try {
          const domain = new URL(s.url).hostname.replace(/^www\./i, '');
          const badgeClass = s.score.toLowerCase();
          const colorClass = s.status === 'Success' ? 'var(--text-primary)' : '#c92a2a';
          domainsHtml += `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: var(--font-size-xs); color: ${colorClass}; gap: 8px;">
              <span class="popup-domain-link" style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 140px; cursor: pointer; text-decoration: underline;" data-url="${s.url}" title="${s.url}">${domain}</span>
              <span class="confidence-badge ${badgeClass}" style="font-size: 8px; padding: 0 4px; line-height: 1.4;">${s.score}</span>
            </div>
          `;
        } catch (e) {
          // ignore invalid URLs
        }
      });

      domainsHtml += `
          </div>
        </div>
      `;
    }

    popup.innerHTML = `
      <div class="confidence-popup-title">
        <span>Confidence Audit</span>
        <span class="confidence-popup-close" id="confidence-popup-close" title="Close">&times;</span>
      </div>
      <p class="confidence-popup-description">
        Audit breakdown of factual cross-referencing agreements detected inside this intelligence report.
      </p>
      <div class="confidence-bar-list">
        <div class="confidence-bar-row">
          <span class="confidence-bar-label">High Trust</span>
          <div class="confidence-bar-outer">
            <div class="confidence-bar-inner high" style="width: ${highPct}%;"></div>
          </div>
          <span class="confidence-bar-value">${high} (${highPct}%)</span>
        </div>
        <div class="confidence-bar-row">
          <span class="confidence-bar-label">Med Trust</span>
          <div class="confidence-bar-outer">
            <div class="confidence-bar-inner medium" style="width: ${mediumPct}%;"></div>
          </div>
          <span class="confidence-bar-value">${medium} (${mediumPct}%)</span>
        </div>
        <div class="confidence-bar-row">
          <span class="confidence-bar-label">Low Trust</span>
          <div class="confidence-bar-outer">
            <div class="confidence-bar-inner low" style="width: ${lowPct}%;"></div>
          </div>
          <span class="confidence-bar-value">${low} (${lowPct}%)</span>
        </div>
      </div>
      ${domainsHtml}
    `;

    // Wire up popup close button
    const closeBtn = popup.querySelector('#confidence-popup-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.classList.remove('active');
      });
    }

    // Wire up domain hyperlinks inside the popup
    const links = popup.querySelectorAll('.popup-domain-link');
    links.forEach(l => {
      l.addEventListener('click', (e) => {
        e.preventDefault();
        const url = l.getAttribute('data-url');
        if (url) {
          window.api.openExternal(url).catch(err => {
            console.error('Failed to open link external:', err);
          });
        }
      });
    });
  }

  renderSVGChart(spec) {
    const type = spec.type || 'bar';
    const title = spec.title || 'Data Visualisation';
    const labels = spec.labels || [];
    const datasets = spec.datasets || [];

    if (datasets.length === 0 || labels.length === 0) return '';

    let svgHtml = '';
    const colors = [
      '#111111', // Deep Black
      '#555555', // Charcoal Grey
      '#888888', // Medium Grey
      '#AAAAAA', // Light Grey
      '#D0D0D0'  // Sub-light Grey
    ];

    if (type === 'bar') {
      const data = datasets[0].data || [];
      const label = datasets[0].label || '';
      const maxVal = Math.max(...data, 1);
      const ticks = 4;
      const xOffset = 55;
      const yOffset = 25;
      const chartHeight = 150;
      const chartWidth = 340;

      // Draw Grid Lines and Y Ticks
      let gridLines = '';
      for (let i = 0; i <= ticks; i++) {
        const val = Math.round((maxVal / ticks) * i);
        const y = yOffset + chartHeight - (i / ticks) * chartHeight;
        gridLines += `
          <line x1="${xOffset}" y1="${y}" x2="${xOffset + chartWidth}" y2="${y}" stroke="var(--border-light)" stroke-dasharray="4" stroke-width="1" />
          <text x="${xOffset - 10}" y="${y + 4}" font-size="9" text-anchor="end" fill="var(--text-tertiary)" font-family="var(--font-sans)">${val}</text>
        `;
      }

      // Draw Bars and X Axis Labels
      let bars = '';
      const barCount = data.length;
      const colWidth = chartWidth / barCount;
      const barWidth = colWidth * 0.55;

      data.forEach((val, idx) => {
        const barHeight = (val / maxVal) * chartHeight;
        const x = xOffset + idx * colWidth + (colWidth - barWidth) / 2;
        const y = yOffset + chartHeight - barHeight;
        const color = colors[idx % colors.length];

        bars += `
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="1" ry="1" />
          <text x="${x + barWidth / 2}" y="${y - 6}" font-size="9" text-anchor="middle" font-weight="600" fill="var(--text-secondary)" font-family="var(--font-sans)">${val}</text>
          <text x="${x + barWidth / 2}" y="${yOffset + chartHeight + 16}" font-size="9" text-anchor="middle" fill="var(--text-tertiary)" font-family="var(--font-sans)">${labels[idx] || ''}</text>
        `;
      });

      svgHtml = `
        <h4 class="chart-title">${title}</h4>
        <svg viewBox="0 0 420 210" class="chart-svg">
          <!-- Axes -->
          <line x1="${xOffset}" y1="${yOffset}" x2="${xOffset}" y2="${yOffset + chartHeight}" stroke="var(--border-medium)" stroke-width="1" />
          <line x1="${xOffset}" y1="${yOffset + chartHeight}" x2="${xOffset + chartWidth}" y2="${yOffset + chartHeight}" stroke="var(--border-medium)" stroke-width="1" />
          ${gridLines}
          ${bars}
        </svg>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-color" style="background-color: ${colors[0]};"></span>
            <span>${label}</span>
          </div>
        </div>
      `;
    } else if (type === 'line') {
      const data = datasets[0].data || [];
      const label = datasets[0].label || '';
      const maxVal = Math.max(...data, 1);
      const ticks = 4;
      const xOffset = 55;
      const yOffset = 25;
      const chartHeight = 150;
      const chartWidth = 340;

      // Draw Grid Lines and Y Ticks
      let gridLines = '';
      for (let i = 0; i <= ticks; i++) {
        const val = Math.round((maxVal / ticks) * i);
        const y = yOffset + chartHeight - (i / ticks) * chartHeight;
        gridLines += `
          <line x1="${xOffset}" y1="${y}" x2="${xOffset + chartWidth}" y2="${y}" stroke="var(--border-light)" stroke-dasharray="4" stroke-width="1" />
          <text x="${xOffset - 10}" y="${y + 4}" font-size="9" text-anchor="end" fill="var(--text-tertiary)" font-family="var(--font-sans)">${val}</text>
        `;
      }

      // Draw Line and Points
      const pointCount = data.length;
      const colWidth = chartWidth / (pointCount - 1 || 1);
      let pointsPath = '';
      let areaPath = `M ${xOffset} ${yOffset + chartHeight}`;
      let points = '';

      data.forEach((val, idx) => {
        const x = xOffset + idx * colWidth;
        const y = yOffset + chartHeight - (val / maxVal) * chartHeight;

        if (idx === 0) {
          pointsPath += `M ${x} ${y}`;
        } else {
          pointsPath += ` L ${x} ${y}`;
        }

        areaPath += ` L ${x} ${y}`;

        points += `
          <circle cx="${x}" cy="${y}" r="3" fill="#FFFFFF" stroke="#111111" stroke-width="1.5" />
          <text x="${x}" y="${y - 8}" font-size="9" text-anchor="middle" font-weight="600" fill="var(--text-secondary)" font-family="var(--font-sans)">${val}</text>
          <text x="${x}" y="${yOffset + chartHeight + 16}" font-size="9" text-anchor="middle" fill="var(--text-tertiary)" font-family="var(--font-sans)">${labels[idx] || ''}</text>
        `;
      });

      areaPath += ` L ${xOffset + chartWidth} ${yOffset + chartHeight} Z`;

      svgHtml = `
        <h4 class="chart-title">${title}</h4>
        <svg viewBox="0 0 420 210" class="chart-svg">
          <!-- Gradient fill -->
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#111111" stop-opacity="0.08" />
              <stop offset="100%" stop-color="#111111" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          <!-- Axes -->
          <line x1="${xOffset}" y1="${yOffset}" x2="${xOffset}" y2="${yOffset + chartHeight}" stroke="var(--border-medium)" stroke-width="1" />
          <line x1="${xOffset}" y1="${yOffset + chartHeight}" x2="${xOffset + chartWidth}" y2="${yOffset + chartHeight}" stroke="var(--border-medium)" stroke-width="1" />
          ${gridLines}
          <path d="${areaPath}" fill="url(#areaGrad)" />
          <path d="${pointsPath}" fill="none" stroke="#111111" stroke-width="1.8" />
          ${points}
        </svg>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-color" style="background-color: #111111;"></span>
            <span>${label}</span>
          </div>
        </div>
      `;
    } else if (type === 'pie' || type === 'donut') {
      const data = datasets[0].data || [];
      const total = data.reduce((a, b) => a + b, 0);
      let accumulated = 0;
      let segments = '';
      let legends = '';

      data.forEach((val, idx) => {
        const percent = (val / total) * 100;
        const circumference = 2 * Math.PI * 50; // circle of radius 50
        const strokeLength = (percent / 100) * circumference;
        const strokeOffset = -(accumulated / 100) * circumference;
        const color = colors[idx % colors.length];
        accumulated += percent;

        // Circular stroke math rotated to start at top center (-90deg)
        segments += `
          <circle r="50" cx="100" cy="100" fill="transparent" stroke="${color}" stroke-width="16" 
                  stroke-dasharray="${strokeLength} ${circumference}" 
                  stroke-dashoffset="${strokeOffset}" 
                  transform="rotate(-90 100 100)" />
        `;

        legends += `
          <div class="legend-item">
            <span class="legend-color" style="background-color: ${color};"></span>
            <span>${labels[idx] || ''}: ${val} (${Math.round(percent)}%)</span>
          </div>
        `;
      });

      svgHtml = `
        <h4 class="chart-title">${title}</h4>
        <svg viewBox="0 0 200 200" class="chart-svg" style="max-height: 160px; margin: 0 auto;">
          <circle r="50" cx="100" cy="100" fill="transparent" stroke="var(--bg-hover)" stroke-width="16" />
          ${segments}
        </svg>
        <div class="chart-legend">
          ${legends}
        </div>
      `;
    } else if (type === 'radar') {
      const data = datasets[0].data || [];
      const label = datasets[0].label || '';
      const maxVal = Math.max(...data, 100);
      const N = labels.length;
      const centerX = 100;
      const centerY = 100;
      const r = 60;

      const angles = [];
      for (let i = 0; i < N; i++) {
        angles.push(i * (2 * Math.PI / N) - Math.PI / 2);
      }

      let webGrid = '';
      const levels = 4;
      for (let lvl = 1; lvl <= levels; lvl++) {
        const pct = lvl / levels;
        const curR = r * pct;
        let pointsStr = '';
        for (let i = 0; i < N; i++) {
          const x = centerX + curR * Math.cos(angles[i]);
          const y = centerY + curR * Math.sin(angles[i]);
          pointsStr += `${x},${y} `;
        }
        webGrid += `<polygon points="${pointsStr.trim()}" fill="none" stroke="var(--border-light)" stroke-width="0.8" />`;
        const valLabel = Math.round((maxVal / levels) * lvl);
        const labelY = centerY - curR;
        webGrid += `<text x="${centerX + 4}" y="${labelY + 6}" font-size="6" fill="var(--text-tertiary)" font-family="var(--font-sans)">${valLabel}</text>`;
      }

      let axesLines = '';
      let axisLabels = '';
      for (let i = 0; i < N; i++) {
        const x = centerX + r * Math.cos(angles[i]);
        const y = centerY + r * Math.sin(angles[i]);
        axesLines += `<line x1="${centerX}" y1="${centerY}" x2="${x}" y2="${y}" stroke="var(--border-medium)" stroke-width="0.8" />`;

        const labelR = r + 12;
        const lx = centerX + labelR * Math.cos(angles[i]);
        const ly = centerY + labelR * Math.sin(angles[i]);
        let textAnchor = 'middle';
        if (Math.cos(angles[i]) > 0.1) textAnchor = 'start';
        else if (Math.cos(angles[i]) < -0.1) textAnchor = 'end';

        axisLabels += `<text x="${lx}" y="${ly + 2}" font-size="7.5" text-anchor="${textAnchor}" fill="var(--text-secondary)" font-family="var(--font-sans)">${labels[i] || ''}</text>`;
      }

      let dataPoints = '';
      let polygonPoints = '';
      data.forEach((val, idx) => {
        const curR = r * (val / maxVal);
        const x = centerX + curR * Math.cos(angles[idx]);
        const y = centerY + curR * Math.sin(angles[idx]);
        polygonPoints += `${x},${y} `;
        dataPoints += `<circle cx="${x}" cy="${y}" r="2" fill="#FFFFFF" stroke="var(--accent-primary)" stroke-width="1.2" />`;
      });

      const polygonHtml = `<polygon points="${polygonPoints.trim()}" fill="var(--accent-glow)" stroke="var(--accent-primary)" stroke-width="1.5" />`;

      svgHtml = `
        <h4 class="chart-title">${title}</h4>
        <svg viewBox="0 0 200 200" class="chart-svg" style="max-height: 180px; margin: 0 auto; overflow: visible;">
          ${webGrid}
          ${axesLines}
          ${polygonHtml}
          ${dataPoints}
          ${axisLabels}
        </svg>
        <div class="chart-legend" style="margin-top: 8px;">
          <div class="legend-item">
            <span class="legend-color" style="background-color: var(--accent-primary);"></span>
            <span>${label}</span>
          </div>
        </div>
      `;
    } else if (type === 'timeline') {
      const data = datasets[0].data || [];
      const chartWidth = 340;
      const xOffset = 40;
      const yOffset = 70;

      let timelineNodes = '';
      const step = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;

      data.forEach((item, idx) => {
        const x = xOffset + idx * step;
        const dateText = item.date || '';
        const eventText = item.event || '';

        const isUpper = idx % 2 === 0;
        const textY = isUpper ? yOffset - 22 : yOffset + 16;
        const dateY = isUpper ? yOffset - 34 : yOffset + 38;

        const words = eventText.split(' ');
        let lines = [];
        let curLine = '';
        words.forEach(w => {
          if ((curLine + ' ' + w).trim().length > 15) {
            lines.push(curLine.trim());
            curLine = w;
          } else {
            curLine += ' ' + w;
          }
        });
        if (curLine.trim()) lines.push(curLine.trim());

        let tspanHtml = '';
        lines.slice(0, 3).forEach((lineText, lineIdx) => {
          tspanHtml += `<tspan x="${x}" dy="${lineIdx === 0 ? 0 : 9}">${lineText}</tspan>`;
        });

        timelineNodes += `
          <circle cx="${x}" cy="${yOffset}" r="4.5" fill="var(--bg-app)" stroke="var(--accent-primary)" stroke-width="2" />
          <text x="${x}" y="${dateY}" font-size="8.5" font-weight="700" text-anchor="middle" fill="var(--accent-primary)" font-family="var(--font-sans)">${dateText}</text>
          <text x="${x}" y="${textY}" font-size="8" text-anchor="middle" fill="var(--text-primary)" font-family="var(--font-sans)">
            ${tspanHtml}
          </text>
        `;
      });

      svgHtml = `
        <h4 class="chart-title">${title}</h4>
        <svg viewBox="0 0 420 140" class="chart-svg" style="overflow: visible;">
          <line x1="${xOffset}" y1="${yOffset}" x2="${xOffset + chartWidth}" y2="${yOffset}" stroke="var(--border-medium)" stroke-width="1.5" />
          ${timelineNodes}
        </svg>
      `;
    }

    return svgHtml;
  }

  exportMarkdown() {
    if (!state.currentReportBuffer) {
      alert('No report available to export.');
      return;
    }

    try {
      const blob = new Blob([state.currentReportBuffer], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `knovant-report-${Date.now()}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export MD failed:', e);
    }
  }

  async exportPdf() {
    if (!state.currentReportBuffer) {
      alert('No report available to export.');
      return;
    }

    try {
      const parsedHtml = window.marked.parse(state.currentReportBuffer);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(parsedHtml) : parsedHtml;

      // Post-process HTML for custom SVG chart blocks
      const codeBlocks = tempDiv.querySelectorAll('pre code');
      codeBlocks.forEach(code => {
        if (code.classList.contains('language-chart') || code.innerText.trim().startsWith('{') && code.innerText.includes('"type"')) {
          try {
            const spec = JSON.parse(code.innerText.trim());
            const chartHtml = this.renderSVGChart(spec);
            if (chartHtml) {
              const preElement = code.parentElement;
              const container = document.createElement('div');
              container.className = 'report-chart-container';
              container.innerHTML = chartHtml;
              preElement.replaceWith(container);
            }
          } catch (err) {
            // Keep original pre-block if JSON parse fails
          }
        }
      });

      const processedHtml = tempDiv.innerHTML;
      const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knovant Deep Research Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-app: #FFFFFF;
      --text-primary: #0F0F15;
      --text-secondary: #4B5563;
      --text-tertiary: #6B7280;
      --border-light: #E5E7EB;
      --border-medium: #D1D5DB;
      --accent-primary: #0284C7;
      --accent-glow: rgba(2, 132, 199, 0.10);
      --bg-hover: #F3F4F6;
      --font-sans: 'Inter', -apple-system, sans-serif;
    }
    @media print {
      body {
        margin: 20mm;
      }
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      line-height: 1.7;
      color: #111111;
      background-color: #FFFFFF;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px;
      font-size: 14px;
    }
    h1 {
      font-size: 26px;
      font-weight: 600;
      margin-bottom: 24px;
      border-bottom: 1.5px solid #EBEBEB;
      padding-bottom: 8px;
      color: #0F0F16;
    }
    h2 {
      font-size: 18px;
      font-weight: 600;
      margin-top: 32px;
      margin-bottom: 14px;
      color: #0F0F16;
      page-break-after: avoid;
    }
    h3 {
      font-size: 14px;
      font-weight: 600;
      margin-top: 22px;
      margin-bottom: 10px;
      color: #0F0F16;
      page-break-after: avoid;
    }
    p {
      margin-bottom: 14px;
      color: #333333;
    }
    ul, ol {
      margin-bottom: 14px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 6px;
      color: #333333;
    }
    blockquote {
      margin: 20px 0;
      padding-left: 16px;
      border-left: 3px solid #0284C7;
      color: #555555;
      font-style: italic;
      }
    code {
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      background-color: #F3F4F6;
      padding: 2px 4px;
      border-radius: 2px;
      color: #c92a2a;
    }
    pre {
      margin: 20px 0;
      padding: 14px;
      background-color: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 4px;
      overflow-x: auto;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      color: #1F2937;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 12px;
    }
    th, td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid #E5E7EB;
    }
    th {
      font-weight: 600;
      background-color: #F9FAFB;
      border-top: 1px solid #E5E7EB;
      color: #1F2937;
    }
    a {
      color: #0284C7;
      text-decoration: underline;
    }
    .report-chart-container {
      border: 1px solid #E5E7EB;
      border-radius: 4px;
      padding: 20px;
      margin: 20px 0;
      text-align: center;
      page-break-inside: avoid;
    }
    .chart-title {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .chart-svg {
      max-width: 400px;
      height: auto;
    }
    .chart-legend {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 12px;
      font-size: 10px;
    }
    .legend-color {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      display: inline-block;
      margin-right: 4px;
    }
  </style>
</head>
<body>
  ${processedHtml}
</body>
</html>`;

      const defaultFilename = `knovant-report-${Date.now()}.pdf`;
      const result = await window.api.exportPdf(fullHtml, defaultFilename);
      if (result.success) {
        console.log('[report] PDF exported successfully:', result.filePath);
      } else if (result.error) {
        alert(`Failed to export PDF: ${result.error}`);
      }
    } catch (e) {
      console.error('[report] PDF generation error:', e);
      alert('Error occurred during PDF generation.');
    }
  }

  setupActions() {
    // Copy Markdown
    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => {
        if (!state.currentReportBuffer) {
          alert('No report available to copy.');
          return;
        }
        navigator.clipboard.writeText(state.currentReportBuffer)
          .then(() => {
            const textNode = Array.from(this.copyBtn.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
            if (textNode) {
              const original = textNode.nodeValue;
              textNode.nodeValue = ' Copied!';
              setTimeout(() => {
                textNode.nodeValue = original;
              }, 1500);
            }
          })
          .catch(err => {
            console.error('Failed to copy report:', err);
          });
      });
    }

    // Export HTML
    if (this.exportHtmlBtn) {
      this.exportHtmlBtn.addEventListener('click', () => {
        if (!state.currentReportBuffer) {
          alert('No report available to export.');
          return;
        }

        try {
          const parsedHtml = window.marked.parse(state.currentReportBuffer);
          const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knovant Deep Research Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      line-height: 1.7;
      color: #111111;
      background-color: #FFFFFF;
      max-width: 760px;
      margin: 64px auto;
      padding: 0 32px;
      font-size: 15px;
    }
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 24px;
      border-bottom: 1px solid #EBEBEB;
      padding-bottom: 8px;
    }
    h2 {
      font-size: 20px;
      font-weight: 600;
      margin-top: 36px;
      margin-bottom: 16px;
    }
    h3 {
      font-size: 16px;
      font-weight: 600;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    p {
      margin-bottom: 16px;
    }
    ul, ol {
      margin-bottom: 16px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
    blockquote {
      margin: 24px 0;
      padding-left: 16px;
      border-left: 2px solid #111111;
      color: #555555;
      font-style: italic;
    }
    code {
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      background-color: #F0F0F0;
      padding: 2px 4px;
      border-radius: 2px;
      color: #c92a2a;
    }
    pre {
      margin: 24px 0;
      padding: 16px;
      background-color: #FCFCFC;
      border: 1px solid #EBEBEB;
      border-radius: 4px;
      overflow-x: auto;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      color: #111111;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
      font-size: 13px;
    }
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid #EBEBEB;
    }
    th {
      font-weight: 600;
      background-color: #FCFCFC;
      border-top: 1px solid #EBEBEB;
    }
    a {
      color: #333333;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  ${parsedHtml}
</body>
</html>`;

          const blob = new Blob([fullHtml], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `knovant-report-${Date.now()}.html`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          console.error('Export HTML failed:', e);
        }
      });
    }

    // Export Markdown
    if (this.exportMdBtn) {
      this.exportMdBtn.addEventListener('click', () => {
        this.exportMarkdown();
      });
    }

    // Export PDF
    if (this.exportPdfBtn) {
      this.exportPdfBtn.addEventListener('click', () => {
        this.exportPdf();
      });
    }

    // Switch between report draft versions dynamically
    if (this.versionSelect) {
      this.versionSelect.addEventListener('change', () => {
        const idx = parseInt(this.versionSelect.value);
        const ver = state.reportVersions[idx];
        if (ver) {
          state.currentReportBuffer = ver.markdown;
          state.sourcesDetailed = ver.sourcesDetailed || [];
          state.sourcesCount = ver.sourcesCount || 0;
          
          // Re-render selected version content
          this.update(ver.markdown);
        }
      });
    }

    // Clear Report
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => {
        if (confirm('Clear the current report preview?')) {
          this.clear();
        }
      });
    }
  }

  updateReadingProgress() {
    const progressBar = document.getElementById('reading-progress-bar');
    const container = document.getElementById('reading-progress-container');
    if (!progressBar || !this.scrollContainer) return;

    const scrollTop = this.scrollContainer.scrollTop;
    const scrollHeight = this.scrollContainer.scrollHeight - this.scrollContainer.clientHeight;

    if (scrollHeight > 0) {
      if (container) container.style.display = 'block';
      const percentage = (scrollTop / scrollHeight) * 100;
      progressBar.style.width = `${percentage}%`;
    } else {
      if (container) container.style.display = 'none';
    }
  }
}

export const report = new ReportController();
