# API-first model inspection, README and file links

Deeplined is a standalone model explorer. Select **Inspect** next to a base
model or quantization, or enter an exact owner/model-name in the manual field.
The inspector operates in the existing Direct or optional Gateway API mode.

## Model metadata

The viewer fetches full structured details with the Hub's model information
API, including pipeline, downloads, likes, license, tags, architecture, model
card fields and a revision SHA when supplied. If a detail request fails, an
exact-match model-search result can provide **partial** metadata. Missing
fields are never inferred.

## README panel

README.md is fetched on demand in the inspector from the model's revision.
The reader tries the raw text path, then the resolve text path. It shares
Deeplined's request queue and transport settings, applies a shorter timeout
and caps text at 1 MiB. The content is rendered locally using safe DOM
construction (headings, paragraphs, links, lists, code, quotes and tables),
not as executable HTML. A Raw Markdown view preserves the original fetched
text. Embedded HTML remains literal text and image links are not auto-loaded.

Some environments permit the model API but block raw or resolve file paths.
In those circumstances the README panel reports a failure; the structured
metadata and file lists still work. Neither the browser nor a gateway can
guarantee that every Hub route is accessible.

## Repository files

The file list uses API siblings and optionally a revision-specific tree
request to supplement file sizes and paths. Download paths are validated.
URLs are constructed from the original Hub's documented /resolve endpoint,
and pinned to a 40-character SHA when one is available. Otherwise the
viewer uses main and labels it as mutable.

Actions for each file:

- **Open URL**: opens the standard Hub file URL; navigation may be filtered.
- **Copy link**: copies the stable Hub URL for use in another downloader.
- **Save (stream)**: where supported, requests a destination via the browser
  File System Access API and streams file bytes directly from Fetch to disk.
  It avoids buffering large weights in memory, supports cancellation, and
  leaves no complete file if a transfer fails before commit. This is a
  user-initiated GET; whether it succeeds depends on endpoint availability
  and cross-origin rules. No gateway or third-party server is used.
- **Resolve delivery URL**: makes a HEAD request and follows redirects without
  fetching the model body. On success, an Open delivery URL link and a copy
  option appear. A signed CDN address can expire; it is not persisted.

Filename and weights-only filters apply to the complete available file
manifest. Only the first 200 matching files are rendered for responsiveness;
Copy matching links can export up to 1,000 selected URLs. Browser clipboard
policies may require copying from a displayed text box.

For multi-part models, select all relevant shards and their accompanying
configuration files. A generated link does not certify file accessibility,
gated permissions, completeness or license suitability.

## Author result sorting

The top-level author results retain total-download, total-like, base-model
count and author-name sorts. A new dropdown adds newest/oldest update,
visible derivative count and average downloads/likes per visible canonical
base model, with ascending/descending choices. Two additional table columns
show matching derivatives and latest update; headers remain sortable.
Metrics reflect active filters, not a global exhaustive Hub inventory.

## Security and limitations

No changes to OS networking, proxies, routing, VPN configuration or installed
software are required. No auth headers or private tokens are introduced.
File saves use direct browser requests; browser-specific CORS/security policy
may prevent saving or CDN resolution even if API discovery succeeds.
The optional gateway remains metadata-only and does not forward weights.

The README renderer does not implement all of GitHub Flavored Markdown;
unsupported syntax appears as text. Unsafe schemes in Markdown links are
rejected. README rendering is bounded to 1,800 lines (full bounded response
retained in the Raw Markdown panel).

## Validation

    node --test tests/model-inspector-test.cjs
    node --test tests/network-transport-test.cjs tests/gateway-test.mjs
    node tests/phase5-test.js

Manual smoke test the README on a public model, the file table links, copy
actions, streamed download of a small config file, cancellation, HEAD URL
resolution, browser CORS failure reporting, all author-sort options, filter
changes and the expanded-row preservation lifecycle.
