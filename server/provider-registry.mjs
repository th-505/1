import * as akwam from './basri-source.mjs';
import * as threeSheeq from './providers/3sheeq.mjs';

export const PROVIDER_SPECIALTIES = Object.freeze({
  general: Object.freeze(['akwam', 'arabseed', 'faselhd']),
  turkish: Object.freeze(['3sheeq']),
  asian: Object.freeze(['asia2tv']),
  anime: Object.freeze(['animelek']),
  // No Arabic-only provider was specified; general is not implicitly duplicated.
  arabic: Object.freeze([]),
});
const methods = ['directSearch', 'directCategory', 'directDetails', 'directWatch'];

function unavailable(id) {
  const fail = async () => { throw new Error(`PROVIDER_NOT_CONFIGURED:${id}`); };
  return Object.fromEntries(methods.map(method => [method, fail]));
}

export function createProviderRegistry(adapters = {}) {
  const registered = new Map();

  function registerProvider(id, adapter) {
    const category = Object.keys(PROVIDER_SPECIALTIES).find(key => PROVIDER_SPECIALTIES[key].includes(id));
    if (!category) throw new Error(`UNKNOWN_PROVIDER:${id}`);
    if (!methods.every(method => typeof adapter?.[method] === 'function')) throw new Error(`INVALID_PROVIDER_INTERFACE:${id}`);
    const cards = async (method, args) => {
      const result = await adapter[method](...args);
      if (!Array.isArray(result)) throw new Error(`INVALID_PROVIDER_CATALOG:${id}`);
      return result.map(card => ({ title: String(card.title || ''), img: String(card.img || ''),
        is_series: Boolean(card.is_series), href: String(card.href || ''), year: card.year ?? null,
        provider_id: id, category_tag: category }));
    };
    const provider = Object.freeze({
      id, category, configured: adapter.configured !== false,
      directSearch: query => cards('directSearch', [query]),
      directCategory: (url, page = 1) => cards('directCategory', [url, page]),
      async directDetails(url) {
        const result = await adapter.directDetails(url);
        return { status: result.status, source: id, movie_title: result.movie_title || '',
          poster: result.poster || '', episodes: (result.episodes || []).map(ep => ({
            num: ep.num, link: ep.link, episode_id: ep.episode_id ?? null,
          })), page_url: result.page_url || url };
      },
      async directWatch(url, referer) {
        const result = await adapter.directWatch(url, referer);
        const candidates = akwam.rankMediaCandidates([...new Set([result.media_src, ...(result.candidates || [])].filter(Boolean))]);
        return { status: candidates.length ? 'success' : 'error', source: id,
          media_src: candidates[0] || '', media_type: akwam.mediaKindFromUrl(candidates[0] || ''),
          candidates, movie_title: result.movie_title || '', page_url: result.page_url || url };
      },
    });
    registered.set(id, provider);
    return provider;
  }

  for (const ids of Object.values(PROVIDER_SPECIALTIES)) {
    for (const id of ids) registerProvider(id, adapters[id] || { ...unavailable(id), configured: false });
  }

  function getProvider(id) {
    if (!registered.has(id)) throw new Error(`UNKNOWN_PROVIDER:${id}`);
    return registered.get(id);
  }

  async function search(ids, query) {
    const results = await Promise.allSettled(ids.map(id => getProvider(id).directSearch(query)));
    const cards = [];
    const errors = [];
    const seen = new Set();
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        errors.push({ provider_id: ids[index], code: String(result.reason?.message || 'PROVIDER_SEARCH_FAILED') });
        return;
      }
      for (const card of result.value) {
        const key = `${card.provider_id}:${card.href}`;
        if (!seen.has(key)) { seen.add(key); cards.push(card); }
      }
    });
    return { status: !errors.length ? 'success' : errors.length === ids.length ? 'error' : 'degraded', cards, errors };
  }

  function searchByCategory(category, query) {
    if (!Object.hasOwn(PROVIDER_SPECIALTIES, category)) throw new Error(`UNKNOWN_SPECIALTY:${category}`);
    return search(PROVIDER_SPECIALTIES[category], query);
  }

  return Object.freeze({ registerProvider, getProvider, searchByCategory,
    searchAll: query => search([...registered.keys()], query),
    listProviders: () => [...registered.values()].map(({ id, category, configured }) => ({ id, category, configured })),
  });
}

const registry = createProviderRegistry({ akwam, '3sheeq': threeSheeq });
export const { registerProvider, getProvider, listProviders, searchByCategory, searchAll } = registry;
