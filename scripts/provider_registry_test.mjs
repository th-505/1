import assert from 'node:assert/strict';
import { createProviderRegistry, PROVIDER_SPECIALTIES } from '../server/provider-registry.mjs';
import { createThreeSheeqProvider } from '../server/providers/3sheeq.mjs';

const calls = [];
const fixtures = new Map([
  ['https://source.test/?s=test', '<a href="/series/demo"><img alt="مسلسل 2025" data-src="/poster.jpg"></a>'],
  ['https://source.test/series/demo', '<h1>مسلسل</h1><meta content="/poster.jpg" property="og:image"><a href="/episode/3">الحلقة ٣</a><a href="/episode/1">الحلقة 1</a><a href="/episode/3">الحلقة 3</a><a href="https://evil.test/episode/2">الحلقة 2</a>'],
  ['https://source.test/watch', '<iframe src="https://player.test/embed"></iframe>'],
  ['https://player.test/embed', '<source src="https://cdn.test/video.m3u8"><script>file: "https:\\/\\/cdn.test/video.mp4?token=x&amp;y=1"</script><source src="https://evil.test/video.mp4">'],
]);
const provider = createThreeSheeqProvider({ origin: 'https://source.test', playerHosts: ['player.test'],
  mediaHosts: ['cdn.test'], fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://source.test/redirect') return new Response('', { status: 302, headers: { location: 'https://evil.test/' } });
    if (!fixtures.has(url)) return new Response('', { status: 404 });
    return new Response(fixtures.get(url), { headers: { 'content-type': 'text/html' } });
  } });

const cards = await provider.directSearch('test');
assert.deepEqual(cards, [{ title: 'مسلسل 2025', img: 'https://source.test/poster.jpg', is_series: true,
  href: 'https://source.test/series/demo', year: '2025', provider_id: '3sheeq', category_tag: 'turkish' }]);
assert.equal((await provider.directSearch('')).length, 0);
const details = await provider.directDetails(cards[0].href);
assert.deepEqual(details.episodes.map(ep => ep.num), [1, 3]);
assert.equal(details.poster, 'https://source.test/poster.jpg');
assert.deepEqual(Object.keys(details.episodes[0]), ['num', 'link', 'episode_id']);
const watch = await provider.directWatch('/watch');
assert.equal(watch.media_type, 'mp4');
assert.equal(watch.media_src, 'https://cdn.test/video.mp4?token=x&y=1');
assert.equal(watch.candidates.length, 2);
assert.equal(calls.find(call => call.url === 'https://player.test/embed').options.headers.Referer, 'https://source.test/watch');
for (const url of ['https://evil.test/', 'https://source.test.evil.test/', 'http://source.test/', 'https://user@source.test/', 'https://source.test:8443/']) {
  assert.throws(() => provider.assertSourceUrl(url), /UNSAFE/);
}
await assert.rejects(provider.directDetails('/redirect'), /UNSAFE/);
assert.ok(!calls.some(call => call.url.startsWith('https://evil.test')));
await assert.rejects(provider.directCategory('/', 0), /INVALID_CATEGORY_PAGE/);
await assert.rejects(provider.directDetails('/missing'), /HTTP_404/);
assert.equal(provider.parseWatch('<source src="javascript:alert(1)">', 'https://source.test/').status, 'error');

const adapter = { ...provider, directSearch: async () => [...cards, ...cards] };
const registry = createProviderRegistry({ '3sheeq': adapter });
assert.deepEqual(PROVIDER_SPECIALTIES.general, ['akwam', 'arabseed', 'faselhd']);
assert.equal((await registry.searchByCategory('turkish', 'test')).cards.length, 1);
const all = await registry.searchAll('test');
assert.equal(all.status, 'degraded');
assert.equal(all.errors.length, 5);
assert.equal(all.cards[0].provider_id, '3sheeq');
assert.equal((await registry.searchByCategory('asian', 'test')).status, 'error');
assert.throws(() => registry.searchByCategory('invalid', ''), /UNKNOWN_SPECIALTY/);
assert.throws(() => registry.registerProvider('arabseed', {}), /INVALID_PROVIDER_INTERFACE/);
registry.registerProvider('arabseed', adapter);
assert.equal((await registry.getProvider('arabseed').directSearch('test'))[0].category_tag, 'general');
console.log('Provider registry and 3sheeq fixture tests passed');
