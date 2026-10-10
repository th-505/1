import { rankMediaCandidates, mediaKindFromUrl } from '../basri-source.mjs';

// Domains change frequently. Set an audited origin and explicit player/CDN hosts.
export function createThreeSheeqProvider({
  origin = 'https://3seq.com',
  playerHosts = [],
  mediaHosts = [],
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  const root = new URL(origin);
  if (root.protocol !== 'https:' || root.username || root.password || root.port) {
    throw new Error('INVALID_PROVIDER_ORIGIN');
  }
  const sourceHosts = new Set([root.hostname]);
  const players = new Set(playerHosts.map(host => String(host).toLowerCase()));
  const media = new Set(mediaHosts.map(host => String(host).toLowerCase()));

  function decode(value = '') {
    return String(value).replace(/&#(x[\da-f]+|\d+);/gi, (entity, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }).replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&');
  }

  function text(value = '') {
    return decode(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function attr(tag, name) {
    const match = String(tag).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
    return decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
  }

  function absoluteUrl(value, base = root.href) {
    if (!String(value).trim()) return '';
    try {
      const url = new URL(decode(value).replace(/\\\//g, '/'), base);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function assertSourceUrl(value, { allowPlayer = false, allowMedia = false } = {}) {
    const url = new URL(value, root);
    const allowed = sourceHosts.has(url.hostname)
      || (allowPlayer && players.has(url.hostname))
      || (allowMedia && media.has(url.hostname));
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed) {
      throw new Error('UNSAFE_3SHEEQ_SOURCE_URL');
    }
    return url;
  }

  function safeSource(value, base) {
    const href = absoluteUrl(value, base);
    if (!href) return '';
    try { return assertSourceUrl(href).href; } catch { return ''; }
  }

  async function fetchSourceHtml(value, { referer = root.href, allowPlayer = false } = {}) {
    let url = assertSourceUrl(value, { allowPlayer });
    const safeReferer = assertSourceUrl(referer, { allowPlayer: true }).href;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const response = await fetchImpl(url.href, {
          redirect: 'manual', signal: controller.signal,
          headers: { Accept: 'text/html,application/xhtml+xml', Referer: safeReferer },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 5) throw new Error('INVALID_SOURCE_REDIRECT');
          // Validate before making the next request, preventing off-domain redirects.
          url = assertSourceUrl(new URL(location, url).href, { allowPlayer });
          continue;
        }
        if (!response.ok) throw new Error(`3SHEEQ_HTTP_${response.status}`);
        if (response.url) assertSourceUrl(response.url, { allowPlayer });
        const type = response.headers.get('content-type') || '';
        if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) {
          await response.body?.cancel();
          throw new Error('INVALID_SOURCE_CONTENT_TYPE');
        }
        return { html: await response.text(), url: url.href };
      }
      throw new Error('TOO_MANY_SOURCE_REDIRECTS');
    } finally { clearTimeout(timer); }
  }

  function anchors(html) {
    return [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
      .map(match => ({ attrs: match[1], body: match[2], href: attr(match[1], 'href') }));
  }

  function parseCatalog(html, pageUrl = root.href) {
    const seen = new Set();
    const cards = [];
    for (const anchor of anchors(html)) {
      const image = anchor.body.match(/<img\b([^>]*)>/i);
      if (!image) continue;
      const href = safeSource(anchor.href, pageUrl);
      if (!href || seen.has(href) || new URL(href).pathname === '/') continue;
      const title = attr(anchor.attrs, 'title') || attr(image[1], 'alt') || text(anchor.body);
      if (!title) continue;
      seen.add(href);
      const img = absoluteUrl(attr(image[1], 'data-src') || attr(image[1], 'data-lazy-src') || attr(image[1], 'src'), pageUrl);
      let path = new URL(href).pathname;
      try { path = decodeURIComponent(path); } catch {}
      cards.push({ title, img, is_series: !/(?:فيلم|movie)/i.test(title + ' ' + path),
        href, year: title.match(/\b(?:19|20)\d{2}\b/)?.[0] || null,
        provider_id: '3sheeq', category_tag: 'turkish' });
    }
    return cards;
  }

  function normalizeEpisodes(entries, pageUrl = root.href) {
    const seen = new Set();
    const out = [];
    for (const entry of entries) {
      const link = safeSource(entry.link, pageUrl);
      if (!link || seen.has(link)) continue;
      const n = Number(entry.num);
      if (!Number.isSafeInteger(n) || n < 1) continue;
      seen.add(link);
      // Preserve real numbering, including gaps; never renumber missing episodes.
      out.push({ num: n, link, episode_id: String(entry.episode_id || new URL(link).pathname) });
    }
    return out.sort((a, b) => a.num - b.num);
  }

  function episodeNumber(value) {
    const label = text(value).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
    return Number(label.match(/(?:الحلقة|حلقه|episode)[\s_:/.\-]*(\d+)/i)?.[1] || 0);
  }

  function pageTitle(html) {
    return text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  }

  function parseDetails(html, pageUrl) {
    const entries = [];
    for (const anchor of anchors(html)) {
      let path = anchor.href;
      try { path = decodeURIComponent(path); } catch {}
      const num = episodeNumber(`${attr(anchor.attrs, 'title')} ${text(anchor.body)}`) || episodeNumber(path);
      if (num) entries.push({ num, link: anchor.href, episode_id: attr(anchor.attrs, 'data-episode-id') });
    }
    const metas = [...html.matchAll(/<meta\b([^>]*)>/gi)];
    const posterMeta = metas.find(match => attr(match[1], 'property') === 'og:image');
    const image = html.match(/<img\b([^>]*)>/i);
    return { status: 'success', source: '3sheeq', movie_title: pageTitle(html),
      poster: absoluteUrl(posterMeta ? attr(posterMeta[1], 'content') : attr(image?.[1] || '', 'src'), pageUrl),
      episodes: normalizeEpisodes(entries, pageUrl), page_url: pageUrl };
  }

  function parseWatch(html, pageUrl) {
    const candidates = new Set();
    const add = value => {
      const href = absoluteUrl(value, pageUrl);
      if (!href || !['mp4', 'hls'].includes(mediaKindFromUrl(href))) return;
      try { candidates.add(assertSourceUrl(href, { allowMedia: true }).href); } catch {}
    };
    for (const match of html.matchAll(/<(?:video|source)\b([^>]*)>/gi)) add(attr(match[1], 'src'));
    for (const match of html.matchAll(/(?:["']?(?:file|src|url)["']?)\s*[:=]\s*["']([^"']+)["']/gi)) add(match[1]);
    const ranked = rankMediaCandidates([...candidates]);
    return { status: ranked.length ? 'success' : 'error', source: '3sheeq', media_src: ranked[0] || '',
      media_type: mediaKindFromUrl(ranked[0] || ''), candidates: ranked,
      movie_title: pageTitle(html), page_url: pageUrl };
  }

  async function directSearch(query) {
    const term = String(query || '').trim();
    if (!term) return [];
    const url = new URL('/', root);
    url.searchParams.set('s', term);
    const page = await fetchSourceHtml(url.href);
    return parseCatalog(page.html, page.url);
  }

  async function directCategory(categoryUrl, page = 1) {
    if (!Number.isSafeInteger(Number(page)) || Number(page) < 1) throw new Error('INVALID_CATEGORY_PAGE');
    const url = assertSourceUrl(categoryUrl);
    if (Number(page) > 1) url.searchParams.set('paged', String(Number(page)));
    const result = await fetchSourceHtml(url.href);
    return parseCatalog(result.html, result.url);
  }

  async function directDetails(targetUrl) {
    const result = await fetchSourceHtml(assertSourceUrl(targetUrl).href);
    return parseDetails(result.html, result.url);
  }

  async function directWatch(targetUrl, referer = root.href) {
    const first = await fetchSourceHtml(assertSourceUrl(targetUrl).href, { referer });
    const queue = [first];
    const visited = new Set([first.url]);
    const candidates = new Set();
    // Bounded traversal of explicit watch links and approved embedded players.
    for (let index = 0; index < queue.length && index < 6; index++) {
      const current = queue[index];
      for (const candidate of parseWatch(current.html, current.url).candidates) candidates.add(candidate);
      const links = [...current.html.matchAll(/<iframe\b([^>]*)>/gi)].map(match => attr(match[1], 'src'));
      for (const anchor of anchors(current.html)) {
        if (/(?:مشاهدة|watch|play)/i.test(text(anchor.body) + ' ' + anchor.href)) links.push(anchor.href);
      }
      for (const link of links) {
        if (queue.length >= 6) break;
        const href = absoluteUrl(link, current.url);
        if (!href || visited.has(href)) continue;
        try { assertSourceUrl(href, { allowPlayer: true }); } catch { continue; }
        visited.add(href);
        try { queue.push(await fetchSourceHtml(href, { referer: current.url, allowPlayer: true })); }
        catch (error) { if (error.name === 'AbortError') throw error; }
      }
    }
    const ranked = rankMediaCandidates([...candidates]);
    return { ...parseWatch(first.html, first.url), status: ranked.length ? 'success' : 'error',
      media_src: ranked[0] || '', media_type: mediaKindFromUrl(ranked[0] || ''), candidates: ranked };
  }

  return Object.freeze({ directSearch, directCategory, directDetails, directWatch,
    assertSourceUrl, normalizeEpisodes, parseCatalog, parseDetails, parseWatch, fetchSourceHtml });
}

const provider = createThreeSheeqProvider({
  origin: process.env.THREESHEEQ_ORIGIN || 'https://3seq.com',
  playerHosts: (process.env.THREESHEEQ_PLAYER_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  mediaHosts: (process.env.THREESHEEQ_MEDIA_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
});
export const { directSearch, directCategory, directDetails, directWatch, assertSourceUrl, normalizeEpisodes } = provider;
