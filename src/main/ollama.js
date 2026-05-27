const store = require('./store');

const HIGH_RELIABILITY_DOMAINS = [
  'reuters', 'bbc', 'nytimes', 'nature', 'science',
  'gov', 'edu', 'arxiv', 'wikipedia', 'apnews',
  'washingtonpost', 'theguardian', 'ft.com', 'economist',
  'nih.gov', 'cdc.gov', 'who.int', 'ieee', 'acm.org'
];

const MEDIUM_RELIABILITY_DOMAINS = [
  'medium', 'techcrunch', 'theverge', 'arstechnica',
  'wired', 'engadget', 'zdnet', 'cnet', 'forbes',
  'businessinsider', 'bloomberg', 'cnbc'
];

class OllamaClient {
  constructor() {
    this.abortController = null;
  }

  get baseUrl() {
    return store.get('ollamaHost').replace(/\/$/, '');
  }

  async listModels() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed to list models');
      const data = await response.json();
      return data.models || [];
    } catch (e) {
      console.error('Error fetching Ollama models:', e.message);
      return [];
    }
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Decompose a complex research query into 3-5 focused sub-queries.
   * Uses a non-streaming Ollama call with a dedicated system prompt.
   * Returns an array of trimmed sub-query strings.
   */
  async decompose(query, model) {
    const host = this.baseUrl;
    const selectedModel = model || store.get('selectedModel') || 'llama3';

    const body = {
      model: selectedModel,
      messages: [
        {
          role: 'system',
          content: 'You are a research query decomposer. Given a complex research question, break it into 3-5 specific, focused sub-queries that together would comprehensively answer the original question. Return ONLY the sub-queries, one per line, no numbering, no explanation.'
        },
        {
          role: 'user',
          content: query
        }
      ],
      stream: false,
      keep_alive: store.get('keepAlive') || '5m',
      options: {
        temperature: 0.3,
        num_ctx: 4096
      }
    };

    try {
      const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama decompose error: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      const content = (data.message && data.message.content) || '';

      const subQueries = content
        .split('\n')
        .map(line => line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-•*]\s*/, '').trim())
        .filter(line => line.length > 5);

      console.log(`[ollama] decompose: generated ${subQueries.length} sub-queries`);
      return subQueries;
    } catch (e) {
      console.error('[ollama] decompose failed:', e.message);
      return [];
    }
  }

  /**
   * Score a source's reliability based on its domain.
   * Pure function — no API call. Returns 'HIGH', 'MEDIUM', or 'LOW'.
   */
  scoreSource(title, url, snippet) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();

      for (const domain of HIGH_RELIABILITY_DOMAINS) {
        if (hostname.includes(domain)) {
          return 'HIGH';
        }
      }

      for (const domain of MEDIUM_RELIABILITY_DOMAINS) {
        if (hostname.includes(domain)) {
          return 'MEDIUM';
        }
      }
    } catch (e) {
      // invalid URL, treat as low
    }

    return 'LOW';
  }

  async chat({ model, messages, temperature, contextLength, onChunk }) {
    this.abort();
    this.abortController = new AbortController();

    const host = this.baseUrl;
    const body = {
      model: model || store.get('selectedModel') || 'llama3',
      messages: messages,
      stream: true,
      keep_alive: store.get('keepAlive') || '5m',
      options: {
        temperature: temperature ?? store.get('temperature'),
        num_ctx: contextLength ?? store.get('contextLength')
      }
    };

    try {
      const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Ollama Chat Error: ${response.status} - ${errText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.message && parsed.message.content) {
              onChunk(parsed.message.content);
            }
          } catch (e) {
            console.error('Failed to parse streaming line:', line, e);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.message && parsed.message.content) {
            onChunk(parsed.message.content);
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Ollama stream generation aborted by user');
      } else {
        throw err;
      }
    } finally {
      this.abortController = null;
    }
  }

  async generateText({ model, messages, temperature = 0.2 }) {
    const host = this.baseUrl;
    const body = {
      model: model || store.get('selectedModel') || 'llama3',
      messages: messages,
      stream: false,
      keep_alive: store.get('keepAlive') || '5m',
      options: {
        temperature: temperature,
        num_ctx: 4096
      }
    };

    try {
      const response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });

      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      const data = await response.json();
      return (data.message && data.message.content) || '';
    } catch (e) {
      console.error('[ollama] generateText failed:', e.message);
      return '';
    }
  }
}

module.exports = new OllamaClient();
