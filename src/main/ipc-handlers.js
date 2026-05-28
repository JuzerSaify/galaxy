const { ipcMain, BrowserWindow, shell, dialog, app } = require('electron');
const store = require('./store');
const scraper = require('./scraper');
const ollama = require('./ollama');
const supabase = require('./supabase-client');

// Restore Supabase session securely from electron-store on startup
try {
  const savedSession = store.getSession();
  if (savedSession) {
    supabase.auth.setSession({
      access_token: savedSession.access_token,
      refresh_token: savedSession.refresh_token
    }).then(({ data, error }) => {
      if (error) {
        console.warn('[supabase] Session restoration failed:', error.message);
        store.setSession(null);
      } else {
        console.log('[supabase] Session successfully restored for:', data.user.email);
        store.setSession(data.session);
      }
    });
  }
} catch (e) {
  console.error('[supabase] Session boot-restore error:', e.message);
}

function setupIpcHandlers() {
  // --- Supabase Auth IPC Handlers ---
  ipcMain.handle('auth:sign-up', async (event, { email, password }) => {
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      return { success: true, user: data.user };
    } catch (e) {
      console.error('[auth] signup error:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('auth:sign-in', async (event, { email, password }) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      store.setSession(data.session);
      return { success: true, user: data.user };
    } catch (e) {
      console.error('[auth] signin error:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('auth:sign-out', async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      store.setSession(null);
      return { success: true };
    } catch (e) {
      console.error('[auth] signout error:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('auth:get-user', async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return { isAuthenticated: false };
      return { isAuthenticated: true, user };
    } catch (e) {
      return { isAuthenticated: false };
    }
  });

  ipcMain.handle('auth:sign-in-google', async () => {
    try {
      // Open the Google Sign-in flow on the website landing page
      const loginUrl = 'https://galaxy-website-ivory.vercel.app/?desktop=true';
      await shell.openExternal(loginUrl);
      return { success: true };
    } catch (e) {
      console.error('[auth] Google sign-in trigger error:', e.message);
      return { success: false, error: e.message };
    }
  });

  // --- Bug Reporting IPC Handler ---
  ipcMain.handle('bug:submit', async (event, { title, description, email }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user ? user.id : null;

      const { error } = await supabase
        .from('bug_reports')
        .insert([
          {
            title,
            description,
            user_email: email || (user ? user.email : null),
            user_id: userId
          }
        ]);

      if (error) throw error;
      return { success: true };
    } catch (e) {
      console.error('[bug] Submit bug error:', e.message);
      return { success: false, error: e.message };
    }
  });

  // --- Usage Logging IPC Handler ---
  ipcMain.handle('usage:log', async (event, { query, model, tokens, sources }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { success: false, error: 'User not authenticated' };

      const { error } = await supabase
        .from('model_usage')
        .insert([
          {
            user_id: user.id,
            client_type: 'desktop',
            query,
            selected_model: model,
            tokens_estimated: tokens,
            sources_count: sources
          }
        ]);

      if (error) throw error;
      return { success: true };
    } catch (e) {
      console.error('[usage] Log usage error:', e.message);
      return { success: false, error: e.message };
    }
  });

  // --- Manual Update Check Handler ---
  ipcMain.handle('app:check-update', async () => {
    if (!app.isPackaged) {
      return { updateAvailable: false, info: 'Run in development mode. Update check skipped.' };
    }
    try {
      const { autoUpdater } = require('electron-updater');
      const result = await autoUpdater.checkForUpdates();
      const updateAvailable = result && result.updateInfo && result.updateInfo.version !== app.getVersion();
      return { success: true, updateAvailable, version: result ? result.updateInfo.version : null };
    } catch (e) {
      console.error('[updater] Manual check error:', e.message);
      return { success: false, error: e.message };
    }
  });

  // Window management
  ipcMain.handle('app:minimize', (event) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    if (win) win.minimize();
  });

  ipcMain.handle('app:maximize', (event) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('app:close', (event) => {
    const webContents = event.sender;
    const win = BrowserWindow.fromWebContents(webContents);
    if (win) win.close();
  });

  ipcMain.handle('app:open-url', async (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      try {
        await shell.openExternal(url);
        return true;
      } catch (e) {
        console.error('[ipc] app:open-url error:', e.message);
      }
    }
    return false;
  });

  // Settings
  ipcMain.handle('settings:get', (event, key) => {
    return store.get(key);
  });

  ipcMain.handle('settings:set', (event, key, val) => {
    const ALLOWED_KEYS = [
      'ollamaHost',
      'selectedModel',
      'searchDepth',
      'temperature',
      'systemPrompt',
      'autoGenerateReport',
      'reportFontSize',
      'keepAlive',
      'researchMode',
      'enableMultiQuery',
      'enableFollowups',
      'enableSourceScoring',
      'maxSubQueries',
      'researchHistory',
      'appTheme',
      'contextLength'
    ];
    if (!ALLOWED_KEYS.includes(key)) {
      console.warn(`[settings] Blocked unauthorized attempt to set key: ${key}`);
      return false;
    }
    store.set(key, val);
    return true;
  });

  ipcMain.handle('settings:getAll', () => {
    return store.store;
  });

  ipcMain.handle('settings:reset', () => {
    store.clear();
    return true;
  });

  ipcMain.handle('report:export-pdf', async (event, { htmlContent, defaultFilename }) => {
    const webContents = event.sender;
    const parentWin = BrowserWindow.fromWebContents(webContents);

    const { filePath, canceled } = await dialog.showSaveDialog(parentWin, {
      title: 'Export Report as PDF',
      defaultPath: defaultFilename || 'knovant-report.pdf',
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }]
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

      const pdfBuffer = await win.webContents.printToPDF({
        marginsType: 1, // no margins
        printBackground: true,
        pageSize: 'A4',
        landscape: false
      });

      const fs = require('fs');
      await fs.promises.writeFile(filePath, pdfBuffer);
      return { success: true, filePath };
    } catch (e) {
      console.error('[ipc] report:export-pdf failed:', e);
      return { success: false, error: e.message };
    } finally {
      win.destroy();
    }
  });

  // Ollama API
  ipcMain.handle('ollama:list-models', async () => {
    return await ollama.listModels();
  });

  ipcMain.handle('ollama:check-health', async () => {
    return await ollama.checkHealth();
  });

  ipcMain.handle('ollama:abort', () => {
    ollama.abort();
    return true;
  });

  // Research History
  ipcMain.handle('research:save-history', (event, { query, timestamp, reportMarkdown }) => {
    try {
      let history = store.get('researchHistory');
      if (typeof history === 'string') {
        try {
          history = JSON.parse(history);
        } catch (e) {
          history = [];
        }
      }
      if (!Array.isArray(history)) {
        history = [];
      }
      history.push({ query, timestamp, reportMarkdown });
      // Prune history to at most 50 entries to prevent unbounded configuration bloat
      if (history.length > 50) {
        history = history.slice(-50);
      }
      store.set('researchHistory', history);
      return { success: true };
    } catch (e) {
      console.error('[ipc] research:save-history error:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('research:get-history', () => {
    try {
      let history = store.get('researchHistory');
      if (typeof history === 'string') {
        try {
          history = JSON.parse(history);
        } catch (e) {
          history = [];
        }
      }
      return Array.isArray(history) ? history : [];
    } catch (e) {
      console.error('[ipc] research:get-history parse error:', e.message);
      return [];
    }
  });

  ipcMain.handle('research:clear-history', () => {
    store.set('researchHistory', []);
    return { success: true };
  });

  // Helper for estimating tokens (4 chars ≈ 1 token)
  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  // Token-aware truncation of messages history to keep context within limits
  function truncateHistory(history, contextLimit) {
    // Leave 50% of context limit for system prompts, web scrapings, and assistant output
    const historyLimit = Math.floor(contextLimit * 0.4);
    const truncated = [];
    let currentTokens = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const tokens = estimateTokens(msg.content);
      if (currentTokens + tokens > historyLimit) {
        break;
      }
      truncated.unshift(msg);
      currentTokens += tokens;
    }
    return truncated;
  }

  // Helper to distribute available character budget and truncate scraped sources proportionally
  function budgetAndTruncateSources(pages, maxCharLength) {
    if (pages.length === 0) return [];

    // Filter out completely failed pages from budget allocation
    const validPages = pages.filter(p => p && p.content && !p.content.startsWith('Failed to retrieve') && p.content.length > 100);

    if (validPages.length === 0) return pages;

    // Distribute maxCharLength evenly among valid pages
    let perPageBudget = Math.floor(maxCharLength / validPages.length);

    // First pass: identify pages that are shorter than perPageBudget
    let unusedBudget = 0;
    const processed = validPages.map(page => {
      const len = page.content.length;
      if (len <= perPageBudget) {
        unusedBudget += (perPageBudget - len);
        return { ...page, allocatedContent: page.content, exceeded: false };
      } else {
        return { ...page, originalContent: page.content, exceeded: true };
      }
    });

    // Second pass: distribute unused budget to pages that exceed their budget
    const exceededCount = processed.filter(p => p.exceeded).length;
    if (exceededCount > 0 && unusedBudget > 0) {
      const extraBudget = Math.floor(unusedBudget / exceededCount);
      perPageBudget += extraBudget;
    }

    // Final truncation
    const finalValid = processed.map(p => {
      if (p.exceeded) {
        return {
          ...p,
          content: p.originalContent.substring(0, perPageBudget) + '\n... [TRUNCATED TO FIT CONTEXT WINDOW] ...'
        };
      } else {
        return {
          ...p,
          content: p.allocatedContent
        };
      }
    });

    // Combine back with failed pages in order
    const finalPages = [];
    let validCursor = 0;
    pages.forEach(p => {
      if (p && p.content && !p.content.startsWith('Failed to retrieve') && p.content.length > 100) {
        finalPages.push(finalValid[validCursor++]);
      } else {
        finalPages.push(p);
      }
    });

    return finalPages;
  }

  // Helper to deduplicate redundant paragraphs in scraped content
  function deduplicateContent(content) {
    if (!content) return '';
    const paragraphs = content.split('\n\n');
    const uniqueParagraphs = [];
    const seenLeadingText = new Set();

    for (const p of paragraphs) {
      const cleanP = p.trim().replace(/\s+/g, ' ');
      if (cleanP.length < 30) continue;

      // Check first 80 characters for near-duplicate detection
      const leadingText = cleanP.substring(0, 80).toLowerCase();
      if (!seenLeadingText.has(leadingText)) {
        seenLeadingText.add(leadingText);
        uniqueParagraphs.push(p);
      }
    }
    return uniqueParagraphs.join('\n\n');
  }

  // Deep Research Pipeline — Multi-Phase
  ipcMain.handle('research:query', async (event, { query, userModel, history = [], activeReport = '', forceFollowUp = false }) => {
    try {
      const researchMode = store.get('researchMode') || 'deep';
      const searchDepth = store.get('searchDepth') || 5;
      const enableMultiQuery = store.get('enableMultiQuery');
      const enableSourceScoring = store.get('enableSourceScoring');
      const contextLength = store.get('contextLength') || 16384;
      const maxSubQueriesSetting = store.get('maxSubQueries') || 3;

      // Determine parameters based on researchMode setting
      let performDecompose = enableMultiQuery;
      let maxSubQueries = maxSubQueriesSetting;
      let maxSources = searchDepth;
      let scrapeConcurrency = 4;

      if (researchMode === 'quick') {
        performDecompose = false;
        maxSources = Math.min(5, searchDepth);
        scrapeConcurrency = 2;
      } else if (researchMode === 'standard') {
        performDecompose = true;
        maxSources = Math.min(10, searchDepth);
        scrapeConcurrency = 3;
      } else if (researchMode === 'deep') {
        performDecompose = true;
        maxSources = Math.min(15, searchDepth);
        scrapeConcurrency = 4;
      } else if (researchMode === 'exhaustive') {
        performDecompose = true;
        maxSources = Math.min(25, searchDepth);
        scrapeConcurrency = 6;
      }

      let subQueries = [];

      // ── CHECK IF QUERY IS A REPORT FOLLOW-UP ──
      const isReportFollowUp = activeReport && forceFollowUp;

      if (isReportFollowUp) {
        console.log('[research] Context-aware Q&A detected. Skipping search/scrape phases.');
        
        event.sender.send('research:phase', { phase: 'analyze', detail: 'Analyzing query from existing report context...' });
        event.sender.send('research:status', 'Analyzing report contents...');

        const context = `ACTIVE GENERATED REPORT CONTEXT:
The user is asking a question directly referring to the active report draft they generated previously. Do NOT search the web. Use the report draft content below to answer their question comprehensively:

${activeReport}
-------------------------------------------\n\n`;

        event.sender.send('research:phase', { phase: 'synthesize', detail: 'Synthesizing response...' });
        event.sender.send('research:status', 'Synthesizing response...');

        const systemPrompt = store.get('systemPrompt');
        const formatInstruction = `Remember: Your response MUST be split into sections:
---CHAT---
[conversational, natural response explaining findings or answering the user's question directly. You MUST strictly and exclusively use the provided "ACTIVE GENERATED REPORT CONTEXT" text to compile this answer. Under no circumstances should you reference external facts, details, or pre-trained knowledge not explicitly mentioned within that context. If the report context does not contain the answer, you must state: "This detail is not mentioned within the generated report."]

---REPORT---
[the EXACT previous report draft content. Do NOT wipe, edit, truncate, remove, or leave this blank! Re-output the full previous report here verbatim so it remains fully visible to the user in the preview pane!]

---FOLLOWUPS---
[Exactly 3 follow-up research questions the user might want to explore next, one per line, prefixed with numbers 1. 2. 3.]`;

        const mergedSystemPrompt = `${systemPrompt}\n\n${context}\n\n${formatInstruction}`;
        const messages = [
          { role: 'system', content: mergedSystemPrompt }
        ];

        // Token-aware truncation of prior history
        const truncatedHistory = truncateHistory(history, contextLength);
        truncatedHistory.forEach(msg => {
          messages.push({ role: msg.role, content: msg.content });
        });

        messages.push({ role: 'user', content: query });

        let qaStartTime = Date.now();
        let qaCharCount = 0;

        await ollama.chat({
          model: userModel || store.get('selectedModel'),
          messages: messages,
          onChunk: (chunk) => {
            qaCharCount += chunk.length;
            const elapsed = (Date.now() - qaStartTime) / 1000 || 0.001;
            const tokenCount = Math.ceil(qaCharCount / 4);
            const speed = (tokenCount / elapsed).toFixed(1);

            event.sender.send('research:chunk', chunk);
            event.sender.send('research:metrics', { speed, tokenCount });
          }
        });

        event.sender.send('research:done');
        return { success: true };
      }

      // ── Phase 1: DECOMPOSE ──
      if (performDecompose) {
        event.sender.send('research:phase', { phase: 'decompose', detail: 'Breaking down your query...' });
        event.sender.send('research:status', 'Decomposing query into sub-queries...');

        const rawSubQueries = await ollama.decompose(query, userModel);
        subQueries = rawSubQueries.slice(0, maxSubQueries);

        if (subQueries.length > 0) {
          event.sender.send('research:sub-queries', subQueries);
          console.log(`[research] Phase 1: decomposed into ${subQueries.length} sub-queries`);
        }
      }

      // ── Phase 2: SEARCH ──
      const allQueries = performDecompose && subQueries.length > 0
        ? [query, ...subQueries]
        : [query];

      event.sender.send('research:phase', { phase: 'search', detail: `Searching across ${allQueries.length} queries...` });
      event.sender.send('research:status', `Searching across ${allQueries.length} queries...`);

      let searchResults;
      if (allQueries.length > 1) {
        searchResults = await scraper.searchMultiQuery(allQueries);
      } else {
        searchResults = await scraper.searchWeb(query);
      }

      // Slice search results according to research mode maxSources
      if (searchResults && searchResults.length > 0) {
        searchResults = searchResults.slice(0, maxSources);
      }

      event.sender.send('research:sources-count', searchResults.length);
      console.log(`[research] Phase 2: found ${searchResults.length} search results`);

      if (searchResults.length === 0) {
        event.sender.send('research:status', 'No search results found. Synthesizing response from model knowledge...');
      }

      // ── Phase 3: SCRAPE ──
      const sourcesToScrape = searchResults;

      event.sender.send('research:phase', { phase: 'scrape', detail: `Extracting content from ${sourcesToScrape.length} sources...` });
      event.sender.send('research:status', `Extracting content from ${sourcesToScrape.length} sources...`);

      const scrapedPages = [];
      const sourcesDetailed = [];
      
      // Thread-safe / race-condition-free index worker pattern
      let nextScrapeIndex = 0;
      const getNextScrapeIndex = () => {
        if (nextScrapeIndex >= sourcesToScrape.length) return -1;
        return nextScrapeIndex++;
      };

      const scrapeWorker = async () => {
        let idx;
        while ((idx = getNextScrapeIndex()) !== -1) {
          const source = sourcesToScrape[idx];
          try {
            const fetched = await scraper.fetchPage(source.link, researchMode);
            const isFailed = fetched.quality === 'error' || fetched.content.startsWith('Failed to retrieve') || fetched.content.length < 150;
            let reliability = enableSourceScoring
              ? ollama.scoreSource(source.title, source.link, source.snippet)
              : 'LOW';

            if (fetched.quality === 'paywall' || fetched.quality === 'cookie-wall') {
              reliability = 'LOW';
            }

            scrapedPages[idx] = {
              title: source.title,
              url: source.link,
              snippet: source.snippet,
              content: deduplicateContent(fetched.content),
              metaDescription: fetched.metaDescription || '',
              quality: fetched.quality
            };

            const detailedObj = {
              title: source.title,
              url: source.link,
              status: isFailed ? 'Failed' : 'Success',
              score: reliability,
              size: fetched.content.length
            };
            sourcesDetailed[idx] = detailedObj;

            // Stream live scraping log details to renderer immediately
            event.sender.send('research:source-scraped', detailedObj);
            event.sender.send('research:status', `Scraped: ${source.title}`);
            console.log(`[research] Scraped: ${source.title} [${reliability}]`);
          } catch (e) {
            console.error('[research] worker error:', e.message);
          }
        }
      };

      const workers = [];
      const concurrency = Math.min(scrapeConcurrency, sourcesToScrape.length);
      for (let i = 0; i < concurrency; i++) {
        workers.push(scrapeWorker());
      }
      await Promise.all(workers);

      // Clean up array slots in case of errors
      const finalScrapedPages = scrapedPages.filter(Boolean);
      const finalSourcesDetailed = sourcesDetailed.filter(Boolean);

      // ── Phase 3.5: ITERATIVE RESEARCH GAP REFINEMENT PASS (Deep / Exhaustive Modes Only) ──
      if ((researchMode === 'deep' || researchMode === 'exhaustive') && finalScrapedPages.length > 0) {
        console.log('[research] Initiating Iterative Research refinement pass...');
        event.sender.send('research:phase', { phase: 'analyze', detail: 'Identifying information gaps for second-pass search...' });
        event.sender.send('research:status', 'Analyzing research gaps...');

        let sourcesSummary = '';
        finalScrapedPages.slice(0, 5).forEach((p, idx) => {
          sourcesSummary += `[Source #${idx+1}]: ${p.title}\nSnippet: ${p.snippet}\n\n`;
        });

        const gapPrompt = `You are a research director. The user wants to research: "${query}".
We have already searched and retrieved the following sources:
${sourcesSummary}

Identify 1 or 2 specific gaps or missing details in this research. Generate exactly 1 or 2 search queries to find the missing details.
Return ONLY the search queries, one per line, no explanation, no numbering.`;

        try {
          const gapText = await ollama.generateText({
            model: userModel || store.get('selectedModel'),
            messages: [
              { role: 'system', content: 'You are a research query planner. Return ONLY raw search queries, one per line.' },
              { role: 'user', content: gapPrompt }
            ],
            temperature: 0.2
          });

          const refinementQueries = gapText
            .split('\n')
            .map(line => line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•*]\s*/, '').trim())
            .filter(line => line.length > 5)
            .slice(0, 2);

          if (refinementQueries.length > 0) {
            console.log('[research] Refinement queries found:', refinementQueries);
            event.sender.send('research:status', `Refining search: "${refinementQueries.join('", "')}"`);

            let newSearchResults = await scraper.searchMultiQuery(refinementQueries);
            if (newSearchResults && newSearchResults.length > 0) {
              const existingLinks = new Set(sourcesToScrape.map(s => s.link));
              newSearchResults = newSearchResults.filter(item => !existingLinks.has(item.link)).slice(0, 4);

              if (newSearchResults.length > 0) {
                console.log(`[research] Scraping ${newSearchResults.length} gap-filling refinement pages`);
                for (const source of newSearchResults) {
                  try {
                    const fetched = await scraper.fetchPage(source.link, researchMode);
                    const isFailed = fetched.quality === 'error' || fetched.content.startsWith('Failed to retrieve') || fetched.content.length < 150;
                    let reliability = enableSourceScoring
                      ? ollama.scoreSource(source.title, source.link, source.snippet)
                      : 'LOW';

                    if (fetched.quality === 'paywall' || fetched.quality === 'cookie-wall') {
                      reliability = 'LOW';
                    }

                    finalScrapedPages.push({
                      title: source.title,
                      url: source.link,
                      snippet: source.snippet,
                      content: deduplicateContent(fetched.content),
                      metaDescription: fetched.metaDescription || '',
                      quality: fetched.quality
                    });

                    const detailedObj = {
                      title: source.title,
                      url: source.link,
                      status: isFailed ? 'Failed' : 'Success',
                      score: reliability,
                      size: fetched.content.length
                    };
                    finalSourcesDetailed.push(detailedObj);

                    event.sender.send('research:source-scraped', detailedObj);
                    event.sender.send('research:status', `Scraped refinement: ${source.title}`);
                  } catch (err) {
                    console.error('[research] Refinement scrape error:', err.message);
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('[research] Gap analysis failed, skipping refinement pass:', e.message);
        }
      }

      event.sender.send('research:sources-detailed', finalSourcesDetailed);
      console.log(`[research] Phase 3: scraped ${finalScrapedPages.length} pages`);

      // ── Phase 4: ANALYZE ──
      event.sender.send('research:phase', { phase: 'analyze', detail: 'Cross-referencing and scoring sources...' });
      event.sender.send('research:status', 'Analyzing and scoring sources...');

      const currentDate = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const currentTime = new Date().toLocaleTimeString('en-US');

      let context = `CURRENT TEMPORAL CONTEXT:
Today's Date: ${currentDate}
Current Time: ${currentTime}

`;

      if (finalScrapedPages.length === 0) {
        context += `[CRITICAL DIRECTIVE: NO SEARCH RESULTS FOUND / ALL SOURCES FAILED TO SCRAPE]
To ensure 100% factual accuracy and avoid hallucination, you are STRICTLY FORBIDDEN from using your pre-trained knowledge or memory weights to answer this query or construct the research report.
Since all search engine operations and web scraping yielded 0 valid source data, you must NOT write a standard report.
Instead, you MUST strictly output the following response format exactly:

---CHAT---
I was unable to retrieve any real-time web research data for your query. Since I am strictly restricted from relying on my own pre-trained knowledge for deep research, I cannot generate the requested report. Please verify your query or search settings.

---REPORT---
# Deep Research Report: [User Query]

## Generation Status: Refused (No Sources Available)
All real-time web search operations or scrape attempts failed to return valid content. To prevent hallucination and maintain absolute precision, no report has been generated.

---FOLLOWUPS---
1. Try rephrasing your search query.
2. Check if your internet connection is active.
3. Verify that your local search capabilities are not blocked.
`;
      } else {
        context += `[CRITICAL DIRECTIVE: STRICT SOURCE-ONLY GENERATION]
You must build your entire response and report using ONLY the facts, dates, prices, numbers, and statements explicitly found in the "PROVIDED RESEARCH SOURCES" section below.
- You are FORBIDDEN from using any internal or pre-trained knowledge to supplement, extrapolate, or invent facts, statistics, historical dates, version numbers, or details that are not directly present in the source text below.
- If a fact or statistic is not mentioned in the provided sources, you must explicitly write: "Not available in retrieved search results." Do not attempt to guess or answer from your training data.
- For every key claim or statistic, you MUST cite the specific URL from the source where it was found in the format [Source Title](URL).
- Include confidence indicators: HIGH (3+ sources agree), MEDIUM (2 sources), LOW (1 source only).

Below is the real-time scraped web research data relevant to the user's query:

`;

        // Calculate available character budget for scraped source content to fit within model context length
        const reservedChars = 20000;
        const totalCharLimit = contextLength * 4;
        const sourceCharLimit = Math.max(12000, totalCharLimit - reservedChars);
        const budgetedPages = budgetAndTruncateSources(finalScrapedPages, sourceCharLimit);

        budgetedPages.forEach((page, idx) => {
          const hasFailed = page.content.startsWith('Failed to retrieve') || page.content.length < 100;
          const reliability = enableSourceScoring
            ? ollama.scoreSource(page.title, page.url, page.snippet)
            : 'N/A';

          context += `SOURCE #${idx + 1} [Reliability: ${reliability}]
Title: ${page.title}
URL: ${page.url}
Search Snippet: ${page.snippet}
${page.metaDescription ? `Meta Description: ${page.metaDescription}\n` : ''}Scraped Full Content:
${hasFailed ? 'Page block/timeout. Rely strictly on Search Snippet above for facts.' : page.content}
-------------------------------------------\n\n`;
        });
      }

      console.log(`[research] Phase 4: analysis complete`);

      // ── Phase 5: SYNTHESIZE ──
      event.sender.send('research:phase', { phase: 'synthesize', detail: 'Generating comprehensive report...' });
      event.sender.send('research:status', 'Generating comprehensive report...');

      const systemPrompt = store.get('systemPrompt');
      const formatInstruction = `Remember: Your streaming response MUST be split into sections using these exact markers:

---CHAT---
[conversational, highly professional, direct natural answer to the user's question. No emojis, no markdown cards, no bullet summaries here, just clear narrative paragraphs.]

---REPORT---
[comprehensive, data-driven markdown report with sections, detailed analyses, a list of cited sources with URLs, data tables where applicable, confidence indicators for each key finding, and a Methodology Note at the end. No emojis, minimal styling, professional layout.]

---FOLLOWUPS---
[Exactly 3 follow-up research questions the user might want to explore next, one per line, prefixed with numbers 1. 2. 3.]`;

      const mergedSystemPrompt = `${systemPrompt}\n\n${context}\n\n${formatInstruction}`;
      const messages = [
        { role: 'system', content: mergedSystemPrompt }
      ];

      // Token-aware truncation of prior history
      const truncatedHistory = truncateHistory(history, contextLength);
      truncatedHistory.forEach(msg => {
        messages.push({ role: msg.role, content: msg.content });
      });

      // Append latest query
      messages.push({ role: 'user', content: query });

      let synthStartTime = Date.now();
      let synthCharCount = 0;

      // Stream response from Ollama
      await ollama.chat({
        model: userModel || store.get('selectedModel'),
        messages: messages,
        onChunk: (chunk) => {
          synthCharCount += chunk.length;
          const elapsed = (Date.now() - synthStartTime) / 1000 || 0.001;
          const tokenCount = Math.ceil(synthCharCount / 4);
          const speed = (tokenCount / elapsed).toFixed(1);

          event.sender.send('research:chunk', chunk);
          event.sender.send('research:metrics', { speed, tokenCount });
        }
      });

      event.sender.send('research:done');
      console.log(`[research] Phase 5: synthesis complete`);

      // Auto log usage to Supabase if user is logged in
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const tokenCount = Math.ceil(synthCharCount / 4);
          await supabase.from('model_usage').insert([
            {
              user_id: user.id,
              client_type: 'desktop',
              query: query,
              selected_model: userModel || store.get('selectedModel') || 'unknown',
              tokens_estimated: tokenCount,
              sources_count: finalScrapedPages.length
            }
          ]);
          console.log('[usage] Automatically logged research token usage to Supabase');
        }
      } catch (logErr) {
        console.warn('[usage] Automatic usage logging skipped/failed:', logErr.message);
      }

      return { success: true };

    } catch (error) {
      console.error('[research] Pipeline execution error:', error);
      event.sender.send('research:error', error.message);
      return { success: false, error: error.message };
    }
  });
}

module.exports = setupIpcHandlers;
