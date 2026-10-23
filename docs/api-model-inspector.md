# API-first model inspection and file links

Deeplined's four-level tree remains optimized for model discovery. The
**Inspect** button next to any L2 base model or L4 derivative opens a local
model inspector without opening the Hugging Face website. Alternatively,
enter an exact owner/model-name in **Inspect model by ID**.

## Data sources

1. The inspector requests /api/models/{owner}/{model}?full=true&cardData=true
   through the existing API request queue and the selected Direct/Gateway
   transport. Information is rendered locally as labelled fields: model ID,
   pipeline, downloads, likes, revision, license, languages, model lineage,
   architecture, model type, context configuration, tags, and structured
   model-card metadata when provided.
2. If the individual detail endpoint fails, Deeplined attempts read-only
   /api/models?search=... listings and requires an **exact model ID match**
   before rendering partial metadata. Some fields and files may be absent in
   listing responses. The UI labels partial results.
3. File names come from the individual model's siblings manifest. A separate
   request to /api/models/{owner}/{model}/tree/{revision}?recursive=true
   optionally adds sizes and file entries. Failure to retrieve a tree does
   not invalidate filenames already supplied by the model-details API.
4. File paths, model IDs, and revision segments are validated before
   constructing links. When the model API returns a 40-character revision SHA,
   all file links are pinned to it. Otherwise, main is used and visibly
   identified as a mutable reference.

**Important:** Hugging Face's cardData is structured card metadata, not
necessarily the complete prose in README.md. This feature does not fetch
or render the raw README. It remains functional when model-page navigation
or raw README endpoints are unavailable.

## File actions

The file table lists exact repository paths, size where available, a
**Download** link and **Copy link** control for each file. All links target
the original Hub /resolve/{revision}/{filename}?download=true endpoint.
Deeplined does not proxy model weights, request multi-gigabyte files in
JavaScript, or store copies locally.

Use the filename search box and **Weights only** option to narrow the
table. **Copy matching links** exports all filtered download URLs (up to
1,000 entries). Rendering caps at 200 rows for responsiveness; filtering
and link export operate on the whole available manifest. Browser clipboard
policies vary, especially for local file:// pages: when programmatic
copy is unavailable, Deeplined displays the links in a selectable text box.

Some Hub repositories contain multiple quantizations or multi-part files:
download the matching shards and necessary configuration/tokenizer files
for the chosen runtime. A working download is not guaranteed simply
because a URL was constructed. Public access, gating, network policy,
and file storage endpoints still apply.

## Browser and security considerations

All inspection requests use the same browser and API transport as ordinary
Deeplined searches. Browser-specific network policies can differ. The
inspector does not modify DNS, OS proxy, VPN, TLS certificate stores or
system routes, and does not bypass browser security restrictions.

- API payloads are untrusted and rendered using DOM textContent; model
  IDs and filenames are validated before producing links.
- No external Markdown renderer or third-party script is loaded.
- The inspector cannot fetch gated/private files without their legitimate
  access conditions being satisfied.
- Clearing the cache or switching API sources cancels stale inspection
  results. Closing the dialog also invalidates its pending responses.
- The API tree may be paginated for repositories with very large numbers
  of files. The inspector retains filenames from the model-info siblings
  field and warns when a tree might be incomplete.
- Availability of file-size metadata depends on the Hub response.

## Tests

Run:

    node --test tests/model-inspector-test.cjs
    node --test tests/network-transport-test.cjs tests/gateway-test.mjs
    node tests/phase5-test.js

Model inspector regression coverage includes script syntax, safe identity
and path handling, revision-pinned link construction, file lists and sizes,
exact-match listing fallback, and L2/L4 action integration.

Manual smoke checks: open Deeplined in a modern browser; fetch quick
results; inspect a base model and a derivative; confirm the dialog shows
structured API facts and files; check filename filtering, copy behaviour,
direct links, closing/reopening, changing the backend, and stale-response
cancellation. Also verify an API source which only supports listings: it
must report partial results instead of inventing missing files.
