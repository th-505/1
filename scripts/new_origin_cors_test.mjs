import assert from 'node:assert/strict';
import { createServer } from '../server/app.mjs';
import { createProductionServer } from '../server/index.mjs';
import { createAlQahtaniRuntimeServer } from '../server/index-runtime.mjs';

for (const factory of [createServer, createProductionServer, createAlQahtaniRuntimeServer]) {
  const server = factory();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/health', '/api/v1/matches', '/api/v1/category', '/api/v1/tmdb/status', '/api/v1/fallback/status']) {
      for (const origin of ['https://th-505.github.io', 'https://th-505.github.io.evil.example', 'https://evil.example']) {
        const response = await fetch(base + path, { method: 'OPTIONS', headers: { Origin: origin } });
        await response.text();
        assert.equal(response.headers.get('access-control-allow-origin'), origin === 'https://th-505.github.io' ? origin : null);
      }
    }
    for (const url of ['https://koooracity.news.evil.example/wp-content/uploads/a.png', 'https://user@koooracity.news/wp-content/uploads/a.png']) {
      const response = await fetch(base + '/api/matches/logo?url=' + encodeURIComponent(url));
      await response.text();
      if (factory !== createServer) assert.equal(response.status, 400);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
}
console.log('New Pages origin accepted across server layers; lookalikes rejected');

const realFetch = globalThis.fetch;
const logoServer = createProductionServer();
await new Promise(resolve => logoServer.listen(0, '127.0.0.1', resolve));
const logoBase = `http://127.0.0.1:${logoServer.address().port}`;
let upstreamCalls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(new URL(url).hostname, 'koooracity.news');
  assert.equal(options.redirect, 'error');
  upstreamCalls++;
  const response = new Response(new Uint8Array(100), { headers: { 'Content-Type': 'image/png' } });
  Object.defineProperty(response, 'url', { value: String(url) });
  return response;
};
try {
  const source = 'https://koooracity.news/wp-content/uploads/team.png';
  const response = await realFetch(logoBase + '/api/matches/logo?url=' + encodeURIComponent(source), {
    headers: { Origin: 'https://th-505.github.io' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://th-505.github.io');
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal(upstreamCalls, 1);
} finally {
  globalThis.fetch = realFetch;
  await new Promise(resolve => logoServer.close(resolve));
}
console.log('New match logo domain passes through the image proxy');
