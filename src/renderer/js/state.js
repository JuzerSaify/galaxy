const PHASE_ORDER = ['decompose', 'search', 'scrape', 'analyze', 'synthesize'];

class AppState {
  constructor() {
    this.settings = {
      ollamaHost: 'http://localhost:11434',
      selectedModel: '',
      searchDepth: 3,
      temperature: 0.2,
      systemPrompt: '',
      autoGenerateReport: true,
      reportFontSize: 15,
      keepAlive: '5m',
      researchMode: 'standard',
      enableMultiQuery: true,
      maxSubQueries: 3,
      enableFollowups: true,
      enableSourceScoring: true,
      appTheme: 'system',
      contextLength: 16384
    };

    this.chatHistory = [];
    this.activeSettingsTab = 'general';
    this.isGenerating = false;
    this.ollamaConnected = false;
    this.availableModels = [];

    // Stream states
    this.currentChatBuffer = '';
    this.currentReportBuffer = '';
    this.streamMode = 'none';

    // Research phase tracking
    this.researchPhases = PHASE_ORDER.map(name => ({
      name,
      status: 'pending' // 'pending' | 'active' | 'completed'
    }));

    // Sub-queries from decomposition
    this.subQueries = [];

    // Sources count from scraper
    this.sourcesCount = 0;

    // Detailed scraping records and logs
    this.sourcesDetailed = [];
    this.scrapeLogs = [];

    // Draft versions generated in active session
    this.reportVersions = [];

    // Follow-up suggestions extracted after generation
    this.followups = [];

    // Followup toggle checkbox state
    this.followUpModeEnabled = false;
  }

  async loadSettings() {
    try {
      const allSettings = await window.api.getAllSettings();
      this.settings = { ...this.settings, ...allSettings };
    } catch (e) {
      console.error('Failed to load settings in state:', e);
    }
  }

  async saveSetting(key, val) {
    this.settings[key] = val;
    await window.api.setSetting(key, val);
  }

  resetStream() {
    this.currentChatBuffer = '';
    this.currentReportBuffer = '';
    this.streamMode = 'none';
  }

  resetPhases() {
    this.researchPhases = PHASE_ORDER.map(name => ({
      name,
      status: 'pending'
    }));
    this.subQueries = [];
    this.sourcesCount = 0;
    this.followups = [];
    this.sourcesDetailed = [];
    this.scrapeLogs = [];
  }

  setPhaseActive(phaseName) {
    let found = false;
    for (let i = 0; i < this.researchPhases.length; i++) {
      const phase = this.researchPhases[i];
      if (phase.name === phaseName) {
        phase.status = 'active';
        found = true;
      } else if (!found) {
        phase.status = 'completed';
      }
    }
  }

  completeAllPhases() {
    for (const phase of this.researchPhases) {
      phase.status = 'completed';
    }
  }

  getPhaseIndex(phaseName) {
    return PHASE_ORDER.indexOf(phaseName);
  }
}

export { PHASE_ORDER };
export const state = new AppState();
