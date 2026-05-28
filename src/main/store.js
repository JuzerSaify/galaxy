const Store = require('electron-store');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Pre-init config cleanup migration to prevent electron-store schema crashes
try {
  const userDataPath = app ? app.getPath('userData') : path.join(process.env.APPDATA || '', 'knovant-deep-research');
  const configPath = path.join(userDataPath, 'config.json');

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    let changed = false;

    if (parsed && typeof parsed.researchHistory === 'string') {
      try {
        parsed.researchHistory = JSON.parse(parsed.researchHistory);
      } catch (e) {
        parsed.researchHistory = [];
      }
      changed = true;
    }

    if (parsed && parsed.researchHistory && !Array.isArray(parsed.researchHistory)) {
      parsed.researchHistory = [];
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf8');
      console.log('[store] Successfully migrated researchHistory on boot');
    }
  }
} catch (e) {
  console.warn('[store] Startup config migration warning:', e.message);
}


const schema = {
  ollamaHost: {
    type: 'string',
    default: 'http://localhost:11434'
  },
  selectedModel: {
    type: 'string',
    default: ''
  },
  searchDepth: {
    type: 'number',
    default: 5
  },
  temperature: {
    type: 'number',
    default: 0.2
  },
  systemPrompt: {
    type: 'string',
    default: `You are Knovant, an elite AI deep research agent. You produce the highest quality intelligence reports in the industry.

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
- Radar chart: {"type": "radar", "title": "Technology comparison", "labels": ["Security", "Cost", "Speed", "Scale", "UX"], "datasets": [{"label": "Solution A", "data": [90, 60, 85, 70, 95]}]}
- Timeline chart: {"type": "timeline", "title": "Development Roadmap", "datasets": [{"data": [{"date": "2024", "event": "Beta Release"}, {"date": "2025", "event": "Global Scaling"}]}]}
Note: Provide ONLY ONE dataset per chart. Keep labels short and descriptive. Do not put comments or markdown inside the JSON code block.

OUTPUT FORMAT:
Your response MUST contain exactly two sections separated by markers:

---CHAT---
[Natural, professional, conversational summary of findings. No emoji. No markdown. Just clear paragraphs.]

---REPORT---
[Comprehensive markdown report with: Executive Summary, Key Findings, Detailed Analysis sections, Dynamic SVG Charts where applicable, Data Tables, Source Citations with URLs, and a Methodology Note at the end.]

---FOLLOWUPS---
[Exactly 3 follow-up research questions the user might want to explore next, one per line, prefixed with numbers 1. 2. 3.]`
  },
  autoGenerateReport: {
    type: 'boolean',
    default: true
  },
  reportFontSize: {
    type: 'number',
    default: 15
  },
  keepAlive: {
    type: 'string',
    default: '5m'
  },
  researchMode: {
    type: 'string',
    default: 'deep'
  },
  enableMultiQuery: {
    type: 'boolean',
    default: true
  },
  enableFollowups: {
    type: 'boolean',
    default: true
  },
  enableSourceScoring: {
    type: 'boolean',
    default: true
  },
  maxSubQueries: {
    type: 'number',
    default: 3
  },
  researchHistory: {
    type: 'array',
    default: [],
    items: {
      type: 'object'
    }
  },
  promptSchemaVersion: {
    type: 'number',
    default: 4
  },
  appTheme: {
    type: 'string',
    default: 'system'
  },
  contextLength: {
    type: 'number',
    default: 16384
  },
  supabaseSession: {
    default: null
  }
};

const store = new Store({ schema, clearInvalidConfig: true });

// Encrypted session helpers using Electron safeStorage
store.setSession = function(session) {
  if (!session) {
    store.set('supabaseSession', null);
    return;
  }
  const { safeStorage } = require('electron');
  const sessionStr = JSON.stringify(session);
  if (safeStorage && safeStorage.isEncryptionAvailable()) {
    try {
      const encryptedBuffer = safeStorage.encryptString(sessionStr);
      store.set('supabaseSession', {
        encrypted: true,
        data: encryptedBuffer.toString('base64')
      });
      return;
    } catch (e) {
      console.error('[store] Encryption failed, falling back to plaintext:', e.message);
    }
  }
  store.set('supabaseSession', {
    encrypted: false,
    data: sessionStr
  });
};

store.getSession = function() {
  const sessionVal = store.get('supabaseSession');
  if (!sessionVal) return null;
  
  // If it's the old schema format (direct session object)
  if (sessionVal.access_token && sessionVal.refresh_token) {
    // Migrated/fallback path: encrypt it right away and return
    store.setSession(sessionVal);
    return sessionVal;
  }

  if (sessionVal.encrypted && sessionVal.data) {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      try {
        const encryptedBuffer = Buffer.from(sessionVal.data, 'base64');
        const decryptedStr = safeStorage.decryptString(encryptedBuffer);
        return JSON.parse(decryptedStr);
      } catch (e) {
        console.error('[store] Decryption failed, resetting session:', e.message);
        store.set('supabaseSession', null);
        return null;
      }
    } else {
      console.warn('[store] Encryption unavailable on this machine, could not decrypt session');
      return null;
    }
  } else if (sessionVal.data) {
    try {
      return JSON.parse(sessionVal.data);
    } catch (e) {
      return null;
    }
  }
  return null;
};

module.exports = store;
