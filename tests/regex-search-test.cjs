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
    id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, checked: false,
    dataset: {}, style: {}, children: [],
    classList: { add() {}, remove() {} },
    addEventListener() {},
    setAttribute(name, value) { this[name] = value; },
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
  console, setTimeout, clearTimeout, TextEncoder, TextDecoder, AbortController, URLSearchParams,
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
const expose = `globalThis.testApi = { runRegexSearch, stopRegexSearch, fetchJson, fetchText, resetAppState, updateSearchMode, createRegexMatcher,
  cache: _regexCardCache, CONFIG, bump: () => { _fetchGeneration++; } };`;
vm.runInContext(source.replace(/\}\)\(\);\s*$/, expose + '\n})();'), context);
const api = context.testApi;
api.CONFIG.RATE_WINDOW = 1;
api.CONFIG.MAX_RETRIES = 0;
const formIds = ['regex-mode', 'regex-candidates', 'regex-name', 'regex-card', 'regex-flags', 'regex-sort', 'regex-limit', 'regex-run', 'regex-stop'];
element('regex-search-form').elements = formIds.map(element);
function setup(values = {}) {
  calls.length = 0;
  api.cache.clear();
  for (const id of formIds) element(id).value = '';
  element('regex-mode').checked = true;
  element('regex-flags').value = 'i';
  element('regex-sort').value = 'downloads';
  element('regex-limit').value = '50';
  for (const [id, value] of Object.entries(values)) element(`regex-${id}`).value = value;
}
function response(data, status = 200) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return { ok: status === 200, status, headers: { get() { return null; } }, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
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
  assert.match(status(), /Invalid search/);
  assert.equal(calls.length, 0);
  for (const flags of ['ii', 'g', 'y', 'z']) {
    setup({ name: 'Qwen', flags });
    await run();
    assert.match(status(), /supported flag/);
    assert.equal(calls.length, 0);
  }
  setup();
  await run();
  assert.match(status(), /Enter a model name search/);
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
  assert.match(status(), /Matching took too long/);
  assert.equal(element('regex-run').disabled, false);
  console.log('PASS: pathological regex is terminated in a real worker');

  setup({ name: 'test' });
  handler = () => response('denied', 403);
  await run();
  assert.match(status(), /HTTP 403/);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(unhandled, []);
  console.log('PASS: HTTP failures do not leak unhandled queue rejections');

  assert(!html.match(/<input[^>]*id="regex-mode"[^>]*>/)[0].includes('checked'));
  element('regex-mode').checked = false;
  api.updateSearchMode();
  assert.equal(element('regex-flags-label').hidden, true);
  assert.equal(element('regex-flags').disabled, true);
  assert.equal(element('standard-search-help').hidden, false);
  assert.equal(element('regex-run').textContent, 'Search');
  element('regex-mode').checked = true;
  api.updateSearchMode();
  assert.equal(element('regex-flags-label').hidden, false);
  assert.equal(element('regex-flags').disabled, false);
  assert.equal(element('standard-search-help').hidden, true);
  assert.equal(element('regex-run').textContent, 'Search with regex');
  console.log('PASS: advanced mode is default and regex toggle changes labels, help and flag controls');

  const matcher = api.createRegexMatcher();
  try {
    const examples = [
      ['+qwen -gptq', 'QWEN/Test-GGUF', true],
      ['+qwen -gptq', 'Qwen/Test-GPTQ', false],
      ['qwen gguf', 'Qwen/Test', false],
      ['"tool calling"', 'Supports tool calling today', true],
      ['"tool calling"', 'tool advanced calling', false],
      ['-"tool calling"', 'No function support', true],
      ['-"tool calling"', 'supports TOOL CALLING', false],
      ['Qwen*GGUF', 'Qwen-Long\nModel-GGUF', true],
      ['a?b', 'a😀b', true],
      ['a?b', 'axyb', false],
      ['a*{2,4}b', 'a12b', true],
      ['a*{2,4}b', 'a12345b', false],
      ['a*{3}b', 'a123b', true],
      ['a*{3}b', 'a12b', false],
      ['a*{2,}b', 'a123456789b', true],
      ['a*{0,0}b', 'ab', true],
      ['\\* \\? \\+ \\- \\" \\\\', '* ? + - " \\', true],
      ['Qwen[7B].(it)|x', 'Qwen[7B].(it)|x', true],
      ['Qwen[7B]', 'Qwen7', false],
      ['+"tool * calling"', 'tool advanced function calling', true],
      ['-gptq', 'GGUF model', true]
    ];
    for (const [query, text, expected] of examples) {
      await matcher.request({ type: 'init', mode: 'advanced', name: query, card: '', flags: '' }, 3000);
      const result = await matcher.request({ field: 'name', text });
      assert.equal(result.matched, expected, `Query ${query} against ${text}`);
    }
    for (const query of ['"unfinished', '+', '-', '""', 'foo\\', 'a*{4,2}b', 'a*{10001}b', 'a*{1,no}b']) {
      await assert.rejects(matcher.request({ type: 'init', mode: 'advanced', name: query, card: '', flags: '' }, 3000), /Invalid search/);
    }
  } finally { matcher.close(); }
  console.log('PASS: required/excluded terms, phrases, wildcard ranges, Unicode, literals and malformed syntax');

  setup({ name: '+Qwen +7B -GPTQ *GGUF', card: '+"tool calling" -experimental', flags: 'invalid' });
  element('regex-mode').checked = false;
  handler = url => url.includes('/api/models?') ? response([
    { id: 'Qwen/Good-7B-GGUF' }, { id: 'Qwen/Bad-7B-GPTQ-GGUF' },
    { id: 'Qwen/Experimental-7B-GGUF' }, { id: 'Qwen/Good-8B-GGUF' }
  ]) : response(url.includes('/Experimental-') ? 'experimental tool calling' : 'supports tool calling');
  await run();
  assert.match(status(), /Complete\. 1 matches · 4\/4/);
  assert.equal(rows().length, 1);
  assert.equal(calls.length, 3);
  assert.equal(element('regex-flags').disabled, true);
  console.log('PASS: standard search name/card integration and hidden regex flags do not affect standard mode');

  setup({ name: '"unfinished' });
  element('regex-mode').checked = false;
  await run();
  assert.match(status(), /Close the quoted phrase/);
  assert.equal(calls.length, 0);
  assert.equal(element('regex-run').disabled, false);
  console.log('PASS: invalid advanced syntax is rejected before network requests');

  assert.match(html, /<details id="search-advanced">/);
  const advancedOptions = html.match(/<details id="search-advanced">([\s\S]*?)<\/details>/)[1];
  for (const id of ['regex-candidates', 'regex-sort', 'regex-limit']) assert(advancedOptions.includes(`id="${id}"`));
  for (const query of ['npc', '*npc*', '+npc -gptq', '"npc model"', 'n?pc*model']) {
    setup({ name: query });
    element('regex-mode').checked = false;
    handler = url => {
      const seed = new URL(url).searchParams.get('search');
      assert.equal(seed, query.includes('model') ? 'model' : 'npc');
      return response([{ id: query.startsWith('"') ? 'Org/npc model' : query.includes('?') ? 'Org/nxpc-model' : 'Org/npc-model' }]);
    };
    await run();
    assert.match(status(), /1 matches/);
    assert.match(status(), /automatic/);
  }
  console.log('PASS: npc and wildcard/phrase/required name queries fetch relevant Hub candidates automatically');

  setup({ name: '*npc*', candidates: 'Roleplay' });
  element('regex-mode').checked = false;
  handler = url => { assert.equal(new URL(url).searchParams.get('search'), 'Roleplay'); return response([]); };
  await run();
  assert.match(status(), /manual hint/);
  assert.match(status(), /No matches in this sample/);
  console.log('PASS: explicit candidate hint overrides automatic discovery and empty results explain sample limits');

  for (const options of [{ name: '-npc' }, { name: '*?*' }, { card: 'npc' }]) {
    setup(options);
    element('regex-mode').checked = false;
    handler = url => { assert.equal(new URL(url).searchParams.has('search'), false); return response([]); };
    await run();
    assert.match(status(), /Broad sample/);
  }
  setup({ name: 'npc|roleplay' });
  handler = url => { assert.equal(new URL(url).searchParams.has('search'), false); return response([]); };
  await run();
  assert.match(status(), /Broad sample/);
  console.log('PASS: card terms, exclusions, wildcard-only queries and regex never become unsafe name hints');
  console.log('All regex-search tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
