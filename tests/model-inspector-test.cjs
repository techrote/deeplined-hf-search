const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "streamlined-hf-model-search.html"), "utf8");
const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
if (!script) throw new Error("Missing standalone application script");
const start = "// ── Model Inspector (API-only) ──";
const end = "// ── RenderCoordinator Method Wiring ──";
const section = html.split(start)[1]?.split(end)[0];
if (!section) throw new Error("Missing model inspector section");

function makeInspector(fetchJson) {
  const context = { URL, fetchJson: fetchJson || (async () => []), navigator: {} };
  const exportNames = [
    "normalizeInspectorModelId", "inspectorApiUrl", "validInspectorFilePath",
    "inspectorDownloadUrl", "inspectorIsWeight", "buildInspectorManifest",
    "inspectorFileSizeLabel", "inspectorFetchModelInfo"
  ];
  vm.runInNewContext(section + "\nglobalThis.inspectorFunctions = {" +
    exportNames.join(",") + "};", context);
  return context.inspectorFunctions;
}

test("the complete HTML app still parses as a standalone script", () => {
  assert.doesNotThrow(() => new vm.Script(script[1]));
  assert.match(html, /const APP_VERSION = '261023\.03'/);
});

test("model identity validation is strict and case-preserving", () => {
  const h = makeInspector();
  assert.equal(h.normalizeInspectorModelId(" Qwen/Qwen2.5-7B-Instruct "), "Qwen/Qwen2.5-7B-Instruct");
  assert.equal(h.inspectorApiUrl("Qwen/Qwen3"), "https://huggingface.co/api/models/Qwen/Qwen3");
  for (const name of ["", "Qwen", "/model", "owner/", "a/b/c", "../repo", "o/..", "o/%2fadmin", "https://example.com/a/b"]) {
    assert.throws(() => h.normalizeInspectorModelId(name), name);
  }
});

test("download links are direct, encoded, and pinned to the repository SHA", () => {
  const h = makeInspector();
  const revision = "a".repeat(40);
  assert.equal(
    h.inspectorDownloadUrl("Qwen/Qwen3", revision, "weights/model (q4).gguf"),
    "https://huggingface.co/Qwen/Qwen3/resolve/" + revision +
      "/weights/model%20(q4).gguf?download=true"
  );
  assert.equal(
    h.inspectorDownloadUrl("Owner/Model", "main", "config.json"),
    "https://huggingface.co/Owner/Model/resolve/main/config.json?download=true"
  );
});

test("unsafe repository paths and arbitrary revisions never become download links", () => {
  const h = makeInspector();
  for (const pathName of ["", "../private", "weights/../../other", "/weights", "models//test.bin", "a\\b", "file\nname"]) {
    assert.equal(h.validInspectorFilePath(pathName), false, pathName);
    assert.throws(() => h.inspectorDownloadUrl("a/b", "main", pathName));
  }
  for (const revision of ["", "../../main", "refs/pr/1", "v1", "https://evil.example"]) {
    assert.throws(() => h.inspectorDownloadUrl("a/b", revision, "weights.gguf"), revision);
  }
});

test("merges API siblings with optional tree sizes and does not manufacture file entries", () => {
  const h = makeInspector();
  const files = h.buildInspectorManifest([
    { rfilename: "config.json" },
    { rfilename: "shards/model-00001.safetensors" },
    { rfilename: "model.gguf", size: 0 },
    { rfilename: "bad/../file.bin" }
  ], [
    { type: "file", path: "shards/model-00001.safetensors", size: 123456789 },
    { type: "file", path: "model.gguf", size: 3500 },
    { type: "directory", path: "ignore" },
    { type: "file", path: "tokenizer.json", size: 1000 }
  ]);
  const sorted = JSON.parse(JSON.stringify(files));
  assert.deepEqual(sorted.map(x => x.path), [
    "model.gguf", "shards/model-00001.safetensors", "config.json", "tokenizer.json"
  ]);
  assert.equal(sorted.find(x => x.path === "model.gguf").size, 3500);
  assert.equal(sorted.find(x => x.path === "shards/model-00001.safetensors").size, 123456789);
  assert.equal(sorted.find(x => x.path === "config.json").size, null);
});

test("file-size labels and weight classification are reliable", () => {
  const h = makeInspector();
  assert.equal(h.inspectorFileSizeLabel(null), "—");
  assert.equal(h.inspectorFileSizeLabel(0), "0 B");
  assert.equal(h.inspectorFileSizeLabel(1073741824), "1.00 GiB");
  assert.equal(h.inspectorIsWeight("weights/model.Q4_K_M.gguf"), true);
  assert.equal(h.inspectorIsWeight("model-00001-of-00002.safetensors"), true);
  assert.equal(h.inspectorIsWeight("README.md"), false);
  assert.equal(h.inspectorIsWeight("tokenizer.json"), false);
});

test("model lookup uses the details endpoint first", async () => {
  const calls = [];
  const h = makeInspector(async (url) => {
    calls.push(url);
    return { id: "Qwen/Qwen3", sha: "f".repeat(40) };
  });
  const res = await h.inspectorFetchModelInfo("Qwen/Qwen3");
  assert.equal(res.partial, false);
  assert.equal(res.info.id, "Qwen/Qwen3");
  assert.deepEqual(calls, ["https://huggingface.co/api/models/Qwen/Qwen3?full=true&cardData=true"]);
});

test("if detail lookup fails, exact model metadata falls back to listing API", async () => {
  const calls = [];
  const h = makeInspector(async (url) => {
    calls.push(url);
    if (url.includes("/api/models/")) throw new Error("detail unavailable");
    return [
      { id: "Another/Model" },
      { id: "Qwen/Qwen3", downloads: 55, cardData: { license: "apache-2.0" } }
    ];
  });
  const result = await h.inspectorFetchModelInfo("Qwen/Qwen3");
  assert.equal(result.partial, true);
  assert.equal(result.info.id, "Qwen/Qwen3");
  assert.match(calls[1], /\/api\/models\?search=Qwen%2FQwen3/);
});

test("listing fallback refuses unrelated models", async () => {
  const h = makeInspector(async url => {
    if (url.includes("/api/models/")) throw new Error("detail unavailable");
    return [{ id: "Different/Model" }];
  });
  await assert.rejects(h.inspectorFetchModelInfo("Qwen/Qwen3"), /detail unavailable/);
});

test("both main tables expose Inspect without duplicating lifecycle or external dependencies", () => {
  assert.match(html, /data-inspect-model="\$\{escapeHtml\(m\.id\)\}"/);
  assert.match(html, /data-inspect-model="\$\{escapeHtml\(q\.id\)\}"/);
  assert.match(script[1], /function _initApp\(\)\s*\{\s*setupApiConnectionControls\(\);\s*setupModelInspector\(\)/);
  assert.match(script[1], /"main-table"\)\.addEventListener\("click", event =>[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(html, /id="model-inspector"/);
  assert.match(html, /id="inspector-file-rows"/);
});


test("README URL uses the model and a validated revision", () => {
  const section = script[1].split("// ── Model card README reader ──")[1]
    .split("async function inspectorFetchModelInfo(modelId) {")[0];
  const sandbox = { URL, document: {}, fetchText: async () => "",
    normalizeInspectorModelId: makeInspector().normalizeInspectorModelId };
  vm.runInNewContext(section +
    "\nglobalThis.reader = {inspectorReadmeUrl,inspectorSafeMarkdownUrl,inspectorRenderMarkdown};", sandbox);
  const reader = sandbox.reader;
  assert.equal(reader.inspectorReadmeUrl("Qwen/Qwen3", "a".repeat(40)),
    "https://huggingface.co/Qwen/Qwen3/raw/" + "a".repeat(40) + "/README.md");
  assert.equal(reader.inspectorReadmeUrl("Qwen/Qwen3", "main", "resolve"),
    "https://huggingface.co/Qwen/Qwen3/resolve/main/README.md");
  assert.throws(() => reader.inspectorReadmeUrl("Qwen/Qwen3", "../main"));
  assert.equal(reader.inspectorSafeMarkdownUrl("javascript:alert(1)", "Qwen/Qwen3", "main"), null);
  assert.equal(reader.inspectorSafeMarkdownUrl("data:text/html,hi", "Qwen/Qwen3", "main"), null);
});

function fakeDocument() {
  function element(name) {
    return {
      tagName: name.toUpperCase(), children: [], _textContent: "",
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      set textContent(text) { this._textContent = String(text); this.children = []; },
      get textContent() { return this._textContent + this.children.map(c => c.textContent || "").join(""); }
    };
  }
  return { createElement: element, createTextNode(text) { const node = element("#text"); node.textContent = text; return node; } };
}

test("README rendering creates safe local headings, lists and tables", () => {
  const section = script[1].split("// ── Model card README reader ──")[1]
    .split("async function inspectorFetchModelInfo(modelId) {")[0];
  const doc = fakeDocument();
  const sandbox = { URL, document: doc,
    normalizeInspectorModelId: makeInspector().normalizeInspectorModelId };
  vm.runInNewContext(section + "\nglobalThis.renderDoc = inspectorRenderMarkdown;", sandbox);
  const out = doc.createElement("div");
  const input = ["---","license: apache-2.0","---","# Example Model",
    "A **bold** description and [download](https://example.org).",
    "<script>alert('bad')</script>", "- one", "- two", "",
    "| Name | Value |", "| --- | --- |", "| Size | 128 |", "",
    "[unsafe](javascript:alert)", "", "\x60\x60\x60js", "alert('raw text')", "\x60\x60\x60"].join("\n");
  sandbox.renderDoc(input, out, "Qwen/Qwen3", "main");
  const flatten = node => [node, ...(node.children || []).flatMap(flatten)];
  const all = flatten(out);
  assert.ok(all.some(node => node.tagName === "H1"));
  assert.ok(all.some(node => node.tagName === "UL"));
  assert.ok(all.some(node => node.tagName === "TABLE"));
  assert.ok(all.some(node => node.tagName === "PRE"));
  assert.ok(all.some(node => node.tagName === "STRONG"));
  assert.ok(!all.some(node => node.tagName === "SCRIPT"));
  assert.ok(all.some(node => node.textContent.includes("<script>alert('bad')</script>")));
  const links = all.filter(node => node.tagName === "A");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://example.org/");
});

test("README uses the same queued transport and enforces a byte limit", async () => {
  const all = script[1];
  assert.match(all, /function fetchText\(url\)\s*\{\s*try \{ url = resolveHubApiUrl\(url\); \}/);
  assert.match(all, /readLimitedTextResponse\(res\)/);
  assert.match(all, /item\.responseType === "text" \? 0 : CONFIG\.MAX_RETRIES/);
  const start = all.indexOf("async function readLimitedTextResponse(");
  const end = all.indexOf("function _scheduleDequeue()", start);
  assert.ok(start > -1 && end > start);
  const context = { TextDecoder, Uint8Array, Number };
  vm.runInNewContext(all.slice(start, end) + "\nglobalThis.read = readLimitedTextResponse;", context);
  assert.equal(await context.read(new Response("hello"), 1024), "hello");
  await assert.rejects(context.read(new Response("x".repeat(1025)), 1024), /exceeds/);
});

test("download controls stream chunks and provide cancellable delivery resolution", () => {
  assert.match(html, /id="inspector-download-status"/);
  assert.match(html, /id="inspector-cancel-save"/);
  assert.match(html, /data-save-path/);
  assert.match(html, /data-resolve-path/);
  assert.match(script[1], /await window\.showSaveFilePicker\(/);
  assert.match(script[1], /await writable\.write\(chunk\.value\)/);
  assert.match(script[1], /await writable\.abort\(\)/);
  assert.match(script[1], /method: "HEAD", credentials: "omit", redirect: "follow"/);
  assert.match(script[1], /dialog\.addEventListener\("close", \(\) => \{ _inspectorSession\+\+; inspectorCancelFileTransfer\(\); \}\)/);
});

test("L1 sort has derived model counts and latest update from visible models", () => {
  for (const value of ["derivativeCount|desc", "avgBaseDownloads|desc",
    "avgBaseLikes|desc", "latestUpdate|desc", "author|asc"]) {
    assert.ok(html.includes('value="' + value + '"'));
  }
  assert.match(html, /data-key="derivativeCount"/);
  assert.match(html, /data-key="latestUpdate"/);
  const src = script[1];
  const begin = src.indexOf("function walkFilterL1(node) {");
  const end = src.indexOf("\n/**", begin + 1);
  assert.ok(begin >= 0 && end > begin);
  const sandbox = { Date, walkFilterL2(node) { return node.r; } };
  vm.runInNewContext(src.slice(begin, end) + "\nglobalThis.aggregate = walkFilterL1;", sandbox);
  const l4 = { display: true, modelRef: { lastModified: "2026-10-21T00:00:00Z" } };
  const l3 = { display: true, aggCount: 1, children: new Map([["q", l4]]) };
  const visible = { canonical: true, display: true,
    modelRef: { downloads: 80, likes: 8, lastModified: "2026-10-20T00:00:00Z" },
    children: new Map([["deriv", l3]]), r: { downloads: 100, likes: 10 } };
  const hidden = { canonical: true, display: false,
    modelRef: { downloads: 1000, likes: 100, lastModified: "2026-10-22T00:00:00Z" },
    children: new Map(), r: { downloads: 0, likes: 0 } };
  const parent = { children: new Map([["a", visible],["b",hidden]]) };
  sandbox.aggregate(parent);
  assert.equal(parent.aggCount, 1);
  assert.equal(parent.aggDerivativeCount, 1);
  assert.equal(parent.aggBaseDownloads, 80);
  assert.equal(parent.aggBaseLikes, 8);
  assert.equal(parent.aggLatestUpdate, Date.parse("2026-10-21T00:00:00Z"));
});
