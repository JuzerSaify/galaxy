const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.invoke('app:minimize'),
  maximize: () => ipcRenderer.invoke('app:maximize'),
  close: () => ipcRenderer.invoke('app:close'),
  openExternal: (url) => ipcRenderer.invoke('app:open-url', url),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, val) => ipcRenderer.invoke('settings:set', key, val),
  getAllSettings: () => ipcRenderer.invoke('settings:getAll'),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  exportPdf: (htmlContent, defaultFilename) => ipcRenderer.invoke('report:export-pdf', { htmlContent, defaultFilename }),

  // Ollama
  listModels: () => ipcRenderer.invoke('ollama:list-models'),
  checkOllamaHealth: () => ipcRenderer.invoke('ollama:check-health'),
  abortChat: () => ipcRenderer.invoke('ollama:abort'),

  // Deep Research Pipeline
  startResearch: (query, userModel, history, activeReport, forceFollowUp) => ipcRenderer.invoke('research:query', { query, userModel, history, activeReport, forceFollowUp }),

  // Research History
  saveResearchHistory: (data) => ipcRenderer.invoke('research:save-history', data),
  getResearchHistory: () => ipcRenderer.invoke('research:get-history'),
  clearResearchHistory: () => ipcRenderer.invoke('research:clear-history'),

  // Subscriptions for streaming events
  onResearchStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('research:status', listener);
    return () => ipcRenderer.removeListener('research:status', listener);
  },
  onResearchChunk: (callback) => {
    const listener = (event, chunk) => callback(chunk);
    ipcRenderer.on('research:chunk', listener);
    return () => ipcRenderer.removeListener('research:chunk', listener);
  },
  onResearchDone: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('research:done', listener);
    return () => ipcRenderer.removeListener('research:done', listener);
  },
  onResearchError: (callback) => {
    const listener = (event, error) => callback(error);
    ipcRenderer.on('research:error', listener);
    return () => ipcRenderer.removeListener('research:error', listener);
  },
  onResearchPhase: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('research:phase', listener);
    return () => ipcRenderer.removeListener('research:phase', listener);
  },
  onResearchSubQueries: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('research:sub-queries', listener);
    return () => ipcRenderer.removeListener('research:sub-queries', listener);
  },
  onResearchSourcesCount: (callback) => {
    const listener = (event, count) => callback(count);
    ipcRenderer.on('research:sources-count', listener);
    return () => ipcRenderer.removeListener('research:sources-count', listener);
  },
  onResearchSourceScraped: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('research:source-scraped', listener);
    return () => ipcRenderer.removeListener('research:source-scraped', listener);
  },
  onResearchSourcesDetailed: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('research:sources-detailed', listener);
    return () => ipcRenderer.removeListener('research:sources-detailed', listener);
  },
  onResearchMetrics: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('research:metrics', listener);
    return () => ipcRenderer.removeListener('research:metrics', listener);
  },

  // Supabase Auth APIs
  signUp: (email, password) => ipcRenderer.invoke('auth:sign-up', { email, password }),
  signIn: (email, password) => ipcRenderer.invoke('auth:sign-in', { email, password }),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  getUser: () => ipcRenderer.invoke('auth:get-user'),
  signInWithGoogle: () => ipcRenderer.invoke('auth:sign-in-google'),
  onAuthStatusChanged: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('auth:status-changed', listener);
    return () => ipcRenderer.removeListener('auth:status-changed', listener);
  },

  // Bug Report API
  submitBugReport: (title, description, email) => ipcRenderer.invoke('bug:submit', { title, description, email }),

  // Usage Log API
  logModelUsage: (query, model, tokens, sources) => ipcRenderer.invoke('usage:log', { query, model, tokens, sources }),

  // Manual update check API
  checkAppUpdate: () => ipcRenderer.invoke('app:check-update')
});

// Clean up all IPC listeners on unload to prevent hot-reload memory leaks
window.addEventListener('unload', () => {
  ipcRenderer.removeAllListeners('research:status');
  ipcRenderer.removeAllListeners('research:chunk');
  ipcRenderer.removeAllListeners('research:done');
  ipcRenderer.removeAllListeners('research:error');
  ipcRenderer.removeAllListeners('research:phase');
  ipcRenderer.removeAllListeners('research:sub-queries');
  ipcRenderer.removeAllListeners('research:sources-count');
  ipcRenderer.removeAllListeners('research:source-scraped');
  ipcRenderer.removeAllListeners('research:sources-detailed');
  ipcRenderer.removeAllListeners('research:metrics');
  ipcRenderer.removeAllListeners('auth:status-changed');
});
