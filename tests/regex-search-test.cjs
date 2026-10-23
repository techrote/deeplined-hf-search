const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker: Thread } = require('node:worker_threads');

const html = fs.readFileSync(path.join(__dirname, '..', 'streamlined-hf-model-search.html'), 'utf8');
const source = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
    dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {} },
    addEventListener() {},
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    querySelector() { return element('tbody'); }
  });
  return elements.get(id);
}
const blobs = new Map();
let blobId = 0;
class TestWorker {
  constructor(url) {
    this.thread = new Thread(`
      const { parentPort } = require('node:worker_threads');
      global.self = { postMessage: data => parentPort.postMessage(data) };
      ${blobs.get(url)}
      parentPort.on('message', data => self.onmessage({data}));
    `, { eval: true });
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
  }
  postMessage(data) { this.thread.postMessage(data); }
  terminate() { this.thread.terminate(); }
}
let handler;
const calls = [];
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));
const context = vm.createContext({
  console, setTimeout, clearTimeout, TextEncoder, AbortController, URLSearchParams,
  document: {
    readyState: 'loading',
    addEventListener() {},
    getElementById: element,
    querySelector: selector => element(selector === '#regex-results tbody' ? 'tbody' : selector),
    querySelectorAll: () => [],
    createElement: () => element(`row-${Math.random()}`)
  },
  window: {},
  Blob: class { constructor(parts) { this.source = parts.join(''); } },
  URL: { createObjectURL(blob) { const url = String(++blobId); blobs.set(url, blob.source); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
  Worker: TestWorker,
  fetch: async url => { calls.push(url); return handler(url); }
});
const expose = `globalThis.testApi = { runRegexSearch, stopRegexSearch, fetchJson, fetchText, resetAppState,
  cache: _regexCardCache, CONFIG, bump: () => { _fetchGeneration++; } };`;
vm.runInContext(source.replace(/\}\)\(\);\s*$/, expose + '\n})();'), context);
const api = context.testApi;
api.CONFIG.RATE_WINDOW = 1;
api.CONFIG.MAX_RETRIES = 0;
const formIds = ['regex-candidates', 'regex-name', 'regex-card', 'regex-flags', 'regex-sort', 'regex-limit', 'regex-run', 'regex-stop'];
element('regex-search-form').elements = formIds.map(element);
function setup(values = {}) {
  calls.length = 0;
  api.cache.clear();
  for (const id of formIds) element(id).value = '';
  element('regex-flags').value = 'i';
  element('regex-sort').value = 'downloads';
  element('regex-limit').value = '50';
  for (const [id, value] of Object.entries(values)) element(`regex-${id}`).value = value;
}
function response(data, status = 200) {
  return { ok: status === 200, status, headers: { get() { return null; } }, text: async () => typeof data === 'string' ? data : JSON.stringify(data) };
}
const run = () => api.runRegexSearch({ preventDefault() {} });
const status = () => element('regex-search-status').textContent;
const rows = () => element('tbody').children;
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Condition timed out');
}

(async () => {
  setup({ name: '[' });
  await run();
  assert.match(status(), /Invalid regex/);
  assert.equal(calls.length, 0);
  for (const flags of ['ii', 'g', 'y', 'z']) {
    setup({ name: 'Qwen', flags });
    await run();
    assert.match(status(), /supported flag/);
    assert.equal(calls.length, 0);
  }
  setup();
  await run();
  assert.match(status(), /Enter a model name regex/);
  assert.equal(calls.length, 0);
  console.log('PASS: invalid patterns, missing patterns, and flags issue no requests');

  setup({ candidates: 'Qwen & coder', name: '^Qwen/.*(7B|8B).*GGUF$', sort: 'likes', limit: '3' });
  handler = () => response([
    { id: 'Qwen/Test-7B-GGUF', downloads: 100, likes: 5 },
    { id: 'Other/Test-7B-GGUF' }, { id: 'Qwen/Test-32B' }
  ]);
  await run();
  assert.match(status(), /Complete\. 1 matches · 3\/3/);
  assert.equal(rows().length, 1);
  assert.equal(calls.length, 1);
  const params = new URL(calls[0]).searchParams;
  assert.equal(params.get('search'), 'Qwen & coder');
  assert.equal(params.get('sort'), 'likes');
  assert.equal(params.get('limit'), '3');
  console.log('PASS: anchored name regex, candidate encoding, limit and sort');

  setup({ name: '7B', card: '^license: mit$.*tool[ -]?calling', flags: 'ims' });
  handler = url => url.includes('/api/models?') ? response([
    { id: 'Org/Model-7B', sha: 'abc123' },
    { id: 'Org/Model-8B', sha: 'abc123' },
    { id: 'Org/Other-7B', sha: 'abc123' }
  ]) : response(url.includes('/Other-7B/') ? 'license: apache\ntool calling' : '---\nlicense: mit\n---\n<script>alert(1)</script>\nTool-Calling');
  await run();
  assert.match(status(), /Complete\. 1 matches · 3\/3/);
  assert.equal(calls.length, 3);
  assert(calls.some(url => url.endsWith('/resolve/abc123/README.md')));
  assert(rows()[0].innerHTML.includes('&lt;script&gt;'));
  assert(!rows()[0].innerHTML.includes('<script>'));
  const count = calls.length;
  await run();
  assert.equal(calls.length, count + 1);
  console.log('PASS: AND semantics, multiline/dotAll, escaped previews, SHA and card caching');

  setup({ card: 'test' });
  handler = url => url.includes('/api/models?') ? response([{ id: 'Org/Missing' }, { id: 'Org/Huge' }]) :
    url.includes('/Missing/') ? response('Not found', 404) : response('é'.repeat(500001));
  await run();
  assert.match(status(), /0 matches · 2\/2 candidates checked · 1 cards unavailable · 1 cards over/);
  assert.equal(rows().length, 0);
  console.log('PASS: card-only matching and unavailable/oversized card reporting');

  setup({ card: 'test' });
  let release;
  handler = url => url.includes('/api/models?') ? response([{ id: 'Org/One' }, { id: 'Org/Two' }]) :
    new Promise(resolve => { release = () => resolve(response('test')); });
  const running = run();
  await until(() => !!release);
  api.stopRegexSearch();
  release();
  await running;
  assert.match(status(), /^Stopped\./);
  assert.equal(rows().length, 0);
  assert.equal(calls.length, 2);
  assert.equal(api.cache.size, 0);
  assert.equal(element('regex-run').disabled, false);
  console.log('PASS: stop prevents stale results/cache writes and further card requests');

  setup({ name: 'test' });
  release = null;
  handler = () => new Promise(resolve => { release = () => resolve(response([{ id: 'Org/test' }])); });
  const stale = run();
  await until(() => !!release);
  api.bump();
  release();
  await stale;
  assert.equal(rows().length, 0);
  assert.match(status(), /explorer data changed/);
  console.log('PASS: explorer generation changes invalidate in-flight scans');

  setup({ name: '(a+)+$' });
  handler = () => response([{ id: 'Org/' + 'a'.repeat(60000) + '!' }]);
  await run();
  assert.match(status(), /Regex took too long/);
  assert.equal(element('regex-run').disabled, false);
  console.log('PASS: pathological regex is terminated in a real worker');

  setup({ name: 'test' });
  handler = () => response('denied', 403);
  await run();
  assert.match(status(), /HTTP 403/);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(unhandled, []);
  console.log('PASS: HTTP failures do not leak unhandled queue rejections');
  console.log('All regex-search tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
