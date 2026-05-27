const cheerio = require('cheerio');
const store = require('./store');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0'
];

/**
 * Returns a random User-Agent header from the pool
 */
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Clean URL from DuckDuckGo redirect link
 */
function cleanDDGUrl(url) {
  try {
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    const parsed = new URL(url);
    if (parsed.pathname === '/l/') {
      const uddg = parsed.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch (e) {
    // Ignore URL parse errors
  }
  return url;
}

/**
 * Clean URL from Yahoo redirect link
 */
function cleanYahooUrl(url) {
  try {
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    const parsed = new URL(url);
    if (parsed.hostname.includes('search.yahoo.com')) {
      const ru = parsed.searchParams.get('RU');
      if (ru) {
        // Yahoo redirect URL parameter RU contains the target page
        return decodeURIComponent(ru);
      }
    }
  } catch (e) {
    // Ignore URL parse errors
  }
  return url;
}

/**
 * Perform a DuckDuckGo web search using HTML interface
 */
async function searchWebHTML(query) {
  console.log(`[scraper] searchWebHTML: "${query}"`);
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = [];

  try {
    const $ = cheerio.load(html);
    
    // Primary selectors
    let items = $('.result');
    if (items.length === 0) {
      // Fallback selectors
      items = $('.links_main, .links_deep, .web-result');
    }

    items.each((i, el) => {
      if (results.length >= 12) return;

      const titleEl = $(el).find('.result__a, a.result__url, a');
      const snippetEl = $(el).find('.result__snippet, .result-snippet, p');

      const title = titleEl.first().text().trim();
      const rawLink = titleEl.first().attr('href') || '';
      const link = cleanDDGUrl(rawLink);
      const snippet = snippetEl.first().text().trim();

      if (title && link && !link.includes('duckduckgo.com/y.js')) {
        results.push({ title, link, snippet });
      }
    });
  } catch (e) {
    console.error('[scraper] cheerio parse error in searchWebHTML:', e.message);
  }

  return results;
}

/**
 * Perform a DuckDuckGo web search using Lite interface (Fallback)
 */
async function searchWebLite(query) {
  console.log(`[scraper] searchWebLite: "${query}"`);
  // Try GET request first as it is much more robust than POST
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const html = await response.text();
      const results = parseLiteHTML(html);
      if (results.length > 0) return results;
    }
  } catch (e) {
    console.warn('[scraper] searchWebLite GET failed, attempting POST fallback:', e.message);
  }

  // POST Fallback
  const postUrl = 'https://lite.duckduckgo.com/lite/';
  const body = new URLSearchParams({
    q: query,
    kl: 'us-en'
  });

  const response = await fetch(postUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    body: body.toString(),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Search Lite POST failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseLiteHTML(html);
}

function parseLiteHTML(html) {
  const results = [];
  try {
    const $ = cheerio.load(html);
    $('table').last().find('tr').each((i, el) => {
      const titleLink = $(el).find('a.result-link, a');
      if (titleLink.length > 0 && results.length < 12) {
        const title = titleLink.first().text().trim();
        const rawLink = titleLink.first().attr('href') || '';
        const link = cleanDDGUrl(rawLink);

        const nextRow = $(el).next();
        const snippet = nextRow.find('td.result-snippet, td').text().trim();

        if (title && link && !link.includes('duckduckgo.com/y.js')) {
          results.push({ title, link, snippet });
        }
      }
    });
  } catch (e) {
    console.error('[scraper] cheerio parse error in parseLiteHTML:', e.message);
  }
  return results;
}

/**
 * Perform a Yahoo web search using HTML interface (Highly robust fallback)
 */
async function searchWebYahoo(query) {
  console.log(`[scraper] searchWebYahoo: "${query}"`);
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Yahoo Search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = [];

  try {
    const $ = cheerio.load(html);
    
    let items = $('.algo, .algo-sr, div.dd, .compTitle');
    if (items.length === 0) {
      items = $('div.algo');
    }

    items.each((i, el) => {
      if (results.length >= 10) return;

      const linkEl = $(el).find('h3 a, a');
      const snippetEl = $(el).find('.compText p, .compText, span.fc-color, p');

      const title = linkEl.first().text().trim();
      const rawLink = linkEl.first().attr('href') || '';
      const link = cleanYahooUrl(rawLink);
      const snippet = snippetEl.first().text().trim();

      // Ensure we decoded Yahoo redirect links correctly to avoid getting blocked when fetching
      if (title && link && !link.includes('r.search.yahoo.com/_ylt=') && link.startsWith('http')) {
        results.push({ title, link, snippet });
      }
    });
  } catch (e) {
    console.error('[scraper] cheerio parse error in searchWebYahoo:', e.message);
  }

  return results;
}

/**
 * Perform a Bing web search using HTML interface (High-reliability fallback)
 */
async function searchWebBing(query) {
  console.log(`[scraper] searchWebBing fallback: "${query}"`);
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    throw new Error(`Bing Search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const results = [];

  try {
    const $ = cheerio.load(html);
    $('.b_algo').each((i, el) => {
      if (results.length >= 10) return;

      const titleEl = $(el).find('h2 a, a');
      const snippetEl = $(el).find('.b_caption p, .b_snippet, p');

      const title = titleEl.first().text().trim();
      const rawLink = titleEl.first().attr('href') || '';
      const link = rawLink.startsWith('http') ? rawLink : '';
      const snippet = snippetEl.first().text().trim();

      if (title && link) {
        results.push({ title, link, snippet });
      }
    });
  } catch (e) {
    console.error('[scraper] cheerio parse error in searchWebBing:', e.message);
  }

  return results;
}

/**
 * Perform a Brave Search API web search if subscription token is configured
 */
async function searchBraveAPI(query) {
  const apiKey = store.get('braveSearchApiKey');
  if (!apiKey) return [];

  console.log(`[scraper] searchBraveAPI: "${query}"`);
  try {
    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`Brave Search API failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    const results = [];
    if (data.web && data.web.results) {
      data.web.results.forEach(item => {
        results.push({
          title: item.title,
          link: item.url,
          snippet: item.description || ''
        });
      });
    }
    return results;
  } catch (e) {
    console.error('[scraper] Brave Search API error:', e.message);
    return [];
  }
}

/**
 * Perform a Google Scholar search for academic/science queries
 */
async function searchGoogleScholar(query) {
  console.log(`[scraper] searchGoogleScholar: "${query}"`);
  const url = `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) return [];
    const html = await response.text();
    const results = [];
    const $ = cheerio.load(html);

    $('.gs_r.gs_or.gs_scl').each((i, el) => {
      if (results.length >= 8) return;
      const titleEl = $(el).find('.gs_rt a');
      const snippetEl = $(el).find('.gs_rs');
      const title = titleEl.text().trim();
      const link = titleEl.attr('href');
      const snippet = snippetEl.text().trim();

      if (title && link) {
        results.push({ title, link, snippet: snippet || 'Academic study reference.' });
      }
    });
    return results;
  } catch (e) {
    console.error('[scraper] Google Scholar search failed:', e.message);
    return [];
  }
}

/**
 * Audio paywalls, cookie walls and general low quality pages
 */
function checkContentQuality(html, text) {
  const lowerHtml = html.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerText.length < 200) return 'low-content';
  if (lowerHtml.includes('paywall') || lowerHtml.includes('subscribe to read') || lowerHtml.includes('membership required') || lowerHtml.includes('purchase subscription')) {
    return 'paywall';
  }
  if (lowerHtml.includes('cookie consent') || lowerHtml.includes('accept cookies') || lowerHtml.includes('enable cookies') || lowerHtml.includes('privacy settings')) {
    if (lowerText.length < 600) {
      return 'cookie-wall';
    }
  }
  return 'ok';
}

/**
 * Perform a highly robust web search with quadruple fallbacks
 */
async function searchWeb(query) {
  console.log(`[scraper] searchWeb: "${query}"`);

  // 1. Try Brave Search API if configured
  const braveApiKey = store.get('braveSearchApiKey');
  if (braveApiKey) {
    try {
      const results = await searchBraveAPI(query);
      if (results && results.length > 0) {
        console.log(`[scraper] Brave Search API returned ${results.length} results`);
        return results;
      }
    } catch (e) {
      console.warn('[scraper] Brave Search API failed, falling back...', e.message);
    }
  }

  // 2. Try Google Scholar for academic keywords
  const ACADEMIC_KEYWORDS = ['scholar', 'academic', 'study', 'research paper', 'arxiv', 'journal', 'theory', 'experiment', 'clinical trial', 'physics', 'biology', 'chemistry', 'mathematics'];
  const isAcademic = ACADEMIC_KEYWORDS.some(kw => query.toLowerCase().includes(kw));
  if (isAcademic) {
    try {
      const results = await searchGoogleScholar(query);
      if (results && results.length > 0) {
        console.log(`[scraper] Google Scholar returned ${results.length} academic results`);
        return results;
      }
    } catch (e) {
      console.warn('[scraper] Google Scholar search failed, falling back...', e.message);
    }
  }

  // 3. Quadruple HTML engine fallback
  try {
    const results = await searchWebHTML(query);
    if (results && results.length > 0) {
      console.log(`[scraper] DuckDuckGo HTML returned ${results.length} results`);
      return results;
    }
  } catch (e) {
    console.warn('[scraper] DuckDuckGo HTML search failed, attempting Lite engine...', e.message);
  }

  try {
    const results = await searchWebLite(query);
    if (results && results.length > 0) {
      console.log(`[scraper] DuckDuckGo Lite returned ${results.length} results`);
      return results;
    }
  } catch (e) {
    console.warn('[scraper] DuckDuckGo Lite search also failed, attempting Yahoo engine...', e.message);
  }

  try {
    const results = await searchWebYahoo(query);
    if (results && results.length > 0) {
      console.log(`[scraper] Yahoo Search returned ${results.length} results`);
      return results;
    }
  } catch (e) {
    console.warn('[scraper] Yahoo Search fallback also failed, attempting Bing engine...', e.message);
  }

  try {
    const results = await searchWebBing(query);
    if (results && results.length > 0) {
      console.log(`[scraper] Bing Search returned ${results.length} results`);
      return results;
    }
  } catch (e) {
    console.error('[scraper] Bing Search fallback also failed:', e.message);
  }

  return [];
}

/**
 * Fetch and extract clean text from a web page with retry logic
 */
async function fetchPage(url, mode = 'standard') {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[scraper] fetchPage attempt ${attempt}: ${url} (mode: ${mode})`);
      const userAgent = getRandomUserAgent();
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal: AbortSignal.timeout(12000)
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: HTTP ${response.status}`);
      }

      const html = await response.text();
      let title = 'Untitled Page';
      let metaDescription = '';
      const contentBlocks = [];

      try {
        const $ = cheerio.load(html);

        // Remove heavy/useless elements
        $('script, style, nav, footer, header, noscript, iframe, svg, head, .comments, #comments, .ads, #ads, .cookie-banner, #cookie-consent').remove();

        title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled Page';

        // Extract meta description
        metaDescription = $('meta[name="description"]').attr('content') || '';
        if (metaDescription) {
          contentBlocks.push(`[META DESCRIPTION]: ${metaDescription.trim()}`);
        }

        // Deep Content Extraction: Prioritize Article/Main blocks first for cleaner reading
        let articleBodyText = '';
        const articleEl = $('article, main, [role="main"], #content, .post, .article-content, .entry-content').first();
        if (articleEl.length > 0) {
          const blocks = [];
          articleEl.find('h1, h2, h3, h4, p, li').each((i, el) => {
            const text = $(el).clone().children('script, style, nav, footer').remove().end().text().replace(/\s+/g, ' ').trim();
            if (text.length > 35) {
              blocks.push(text);
            }
          });
          articleBodyText = [...new Set(blocks)].join('\n\n');
        }

        if (articleBodyText.length > 600) {
          contentBlocks.push(articleBodyText);
          console.log(`[scraper] Clean article layout parsed successfully: ${articleBodyText.length} chars`);
        } else {
          // Fallback to global body tag parsing
          $('h1, h2, h3, h4, p, li, article, section').each((i, el) => {
            const text = $(el).clone().children('script, style, nav, footer').remove().end().text().replace(/\s+/g, ' ').trim();
            if (text.length > 30) {
              contentBlocks.push(text);
            }
          });
        }
      } catch (e) {
        console.error(`[scraper] cheerio parse error for ${url}:`, e.message);
      }

      const uniqueBlocks = [...new Set(contentBlocks)];
      const charLimit = (mode === 'exhaustive') ? 32000 : 16000;
      const cleanText = uniqueBlocks.join('\n\n').substring(0, charLimit);
      const quality = checkContentQuality(html, cleanText);

      return {
        title,
        url,
        metaDescription,
        content: cleanText || 'No readable text content extracted from this URL.',
        quality: quality
      };
    } catch (error) {
      console.error(`[scraper] fetchPage attempt ${attempt} failed for ${url}:`, error.message);
      if (attempt < maxAttempts) {
        console.log(`[scraper] Retrying in 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        return {
          title: 'Error',
          url,
          metaDescription: '',
          content: `Failed to retrieve content: ${error.message}`,
          quality: 'error'
        };
      }
    }
  }
}

/**
 * Run searchWeb for multiple queries sequentially with staggering to prevent rate-limiting and CAPTCHAs,
 * and deduplicate results by URL
 */
async function searchMultiQuery(queries) {
  console.log(`[scraper] searchMultiQuery: ${queries.length} queries sequentially with staggering`);

  const seenUrls = new Set();
  const combined = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if (i > 0) {
      // Stagger queries by 1000ms to avoid search engine block/CAPTCHA
      console.log(`[scraper] Staggering search: waiting 1000ms before querying "${q}"...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    try {
      const results = await searchWeb(q);
      if (Array.isArray(results)) {
        for (const item of results) {
          if (!seenUrls.has(item.link)) {
            seenUrls.add(item.link);
            combined.push(item);
          }
        }
      }
    } catch (e) {
      console.error(`[scraper] Multi-query sub-search failed for "${q}":`, e.message);
    }
  }

  console.log(`[scraper] searchMultiQuery: ${combined.length} unique results from ${queries.length} queries`);
  return combined;
}

/**
 * Fetch multiple pages with limited concurrency using a semaphore pattern
 */
async function fetchPages(urls, maxConcurrency = 4) {
  console.log(`[scraper] fetchPages: ${urls.length} URLs, concurrency=${maxConcurrency}`);

  const results = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      results[index] = await fetchPage(urls[index]);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(maxConcurrency, urls.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  console.log(`[scraper] fetchPages: completed ${results.length} pages`);
  return results;
}

module.exports = {
  searchWeb,
  fetchPage,
  searchMultiQuery,
  fetchPages
};
