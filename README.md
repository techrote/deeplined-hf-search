# A Streamlined Hugging Face Model Search

## Deeplined advanced search

## Benchmarks and colour themes

Use **Colour theme** at the top to choose Dark, Light, Midnight blue, or Forest. The choice is saved in local browser storage; if storage is unavailable, themes still work for the current page session.

Structured evaluation scores appear in search results and in the base-model and individual quantization tables. Load models, select a dataset/metric in **Benchmark metric**, then click **Benchmark score** to sort high-to-low or low-to-high. Search sorting applies to the fetched sample, not a global Hub ranking. Expand any score to inspect all reported evaluations and their context/source links. Without a selected metric, each cell shows its count of reported scores.

The app reads numeric scores from `model-index` metadata and `eval_results` metadata when present in API responses. Model cards without these fields display a dash; arbitrary benchmark tables in README prose and external leaderboards are not scraped. For a model with structured metadata, try `distilbert-base-uncased-finetuned-sst-2-english` in the name search.

Only the selected evaluation context is sorted. Missing or conflicting values stay last in both directions. Dataset split/config/revision, metric configuration/arguments, task, and reported source are kept separate. Raw values retain their original scale; scores are not averaged, converted into an overall ranking, or inherited by derivatives. Publisher-supplied scores have not been independently verified, and even similarly labelled evaluations may use different setups. Use ascending order for metrics such as error rate or loss, where lower is better.

Use **Load Open LLM Leaderboard scores** to import the official historical v2 table from `open-llm-leaderboard/contents`. The dataset currently has 4,576 rows and its published snapshot is from March 2025, so newer models may not appear. Import is optional, uses the shared rate-limited queue, reports progress, and can be stopped. The table is cached for this page session, including for models loaded later; Clear Cache removes it.

The import adds published Average, IFEval, BBH, MATH Lvl 5, GPQA, MUSR, and MMLU-PRO scores, plus separate raw metric variants. Select an **Open LLM v2** metric in the same benchmark dropdown to sort. Card and leaderboard sources remain separate; raw and normalized scales are not mixed. Precision, weight type, and chat-template settings remain distinct. Conflicting runs for the same context stay unavailable rather than selecting the highest score.

Only exact, case-sensitive repository IDs match; a quantization or fine-tune does not receive its parent's score. Flagged or invalid rows are excluded. Expanded scores include the evaluated model SHA, submission/run details, and dataset revision; a historical evaluated revision may differ from the model's current revision. All pages must have the same browser-visible dataset revision header before any imported scores are published. Partial, changed, or failed imports apply no new scores and can be retried. No model weights are downloaded.

Run `node tests/benchmarks-themes-test.cjs` and `node tests/leaderboard-test.cjs` for score, theme, and import regression checks. The optional `LIVE_LEADERBOARD=1 node tests/leaderboard-test.cjs` performs the full network import and checks a known published score.

## Search usage

Open `streamlined-hf-model-search.html` in a modern browser. The **Advanced search** panel searches full `author/model` IDs and raw `README.md` model cards (including YAML metadata). Standard advanced syntax is the default; enable **Use regular expressions** for regex inputs and flags.

1. Enter a name query, a card query, or both. When both are provided, a model must match both. For example, name `+Qwen +7B -GPTQ *GGUF` and card `+"tool calling" -experimental`.
2. Click **Search**. Required literal text in a standard name query automatically retrieves relevant Hub candidates: `npc` and `*npc*` both retrieve NPC candidates first, then apply the complete query. Results appear in candidate order with plain-text match previews. **Stop search** retains partial results and stops scheduling new requests.
3. If needed, expand **Advanced options** to override the automatic name hint, change candidate sort, or adjust the 1–500 candidate limit. These controls are collapsed by default.

Standard search matches case-insensitively anywhere in the text. All terms are ANDed, whether or not they have a `+` prefix. This is Google-style syntax, not Google's ranking or query-expansion behavior:

| Syntax | Meaning |
| --- | --- |
| `qwen gguf` or `+qwen +gguf` | Require both terms, in any order |
| `-gptq` or `-"experimental model"` | Exclude a term or phrase |
| `"tool calling"` | Match the adjacent phrase, including its literal spacing |
| `Qwen*GGUF` | Match zero or more characters between Qwen and GGUF, including spaces/newlines |
| `Qwen?` | Match Qwen followed by exactly one character |
| `a*{2,5}b` | Match a, then 2–5 characters, then b |
| `a*{3}b` / `a*{2,}b` | Match exactly 3 / at least 2 intervening characters |
| `\*`, `\?`, `\"`, `\\` | Match literal operators, quotes, or backslashes |

Wildcard bounds must be ordered nonnegative integers up to 10,000. Quotes may contain wildcards. Other regex punctuation is literal in standard mode; unmatched quotes, incomplete escapes, and malformed ranges produce errors before fetching candidates. A query consisting only of exclusions is supported.

For regex mode, toggle **Use regular expressions** and enter patterns without `/delimiters/`, e.g. name `Qwen.*(7B|8B).*GGUF$` and card `tool[ -]?calling|function calling`. Choose `i`, `m`, `s`, and/or `u` flags. Flags are hidden and ignored in standard mode. Toggling modes preserves the input text; it does not translate between query languages.

This scans a bounded candidate sample, **not all cards on the Hub**. Automatic discovery picks the longest alphanumeric/name fragment of at least two characters from required name terms; wildcard gaps and excluded terms cannot become hints. The complete query still filters the returned candidates, including any fuzzy Hub results. The status reports whether discovery was automatic, manually overridden, or a broad sample.

Card-only, negative-only, wildcard-only, and regex searches without a manual name hint scan top models in the selected sort order and explicitly report that broad scope. Card text is never inferred as a name hint: doing so would exclude models that mention a term only in their cards. A manual hint overrides automatic discovery and searches names only. The explorer's date, parameter, and quantization filters below are independent of this search panel.

Card scans use one additional request per name-matching candidate, through the existing shared rate limiter. Successful cards are cached by revision (up to 200); **Clear Cache** clears them. Missing, gated, or otherwise unreadable cards and cards over 1 MB are counted as skipped, not searched. Readme content is never rendered as HTML. Both search modes run in a disposable Web Worker with a 300 ms matching timeout so expensive expressions cannot freeze the UI.

Run regression checks with `node tests/regex-search-test.cjs`.

A dark-color themed, browser-based, 4-level hierarchical explorer for HuggingFace base models and their quantizations.

**Key Features:**
- No server. No install steps. Just open the `streamlined-hf-model-search.html` file in your browser.
- Uses the public HuggingFace Hub API (`https://huggingface.co/api/models`).
- No API key required.
- All API calls are rate-limited to be gentle on the Hugging Face server via a queue-based request manager (max 5 concurrent, ≤4 req/s).


## Example Output

![Hugging Face Search](./search.png "Example Search")


## Feature specifics

### Tiered Output Structure

Select your search criteria and click **Get Quick Results** or **Get Deep Results**.  A four tier model navigation tree is presented:

**Get Quick Results** - fetches top models per pipeline tag; skips cross-author base model injection for speed.

**Get Deep Results** - same as Quick, plus resolves cross-author base models referenced by quantizations via individual API calls.
Using Get Deep Results is slower but surfaces more quantizations.

| Level | Role | What You See | Sortable By |
|-------|------|-------|-------------|
| **1** | **Base Model Authors** | Organizations with base models matching all active filters | Model Author, Base Models, Total Downloads, Total Likes |
| **2** | **Base Author Models** | Individual base models by that author | Model ID, Params, Updated, Downloads, Likes |
| **3** | **Derivative Authors** | Who made derivative models, grouped by author | Author, Models, Downloads |
| **4** | **Derivative Models** | Derivative quantized/finetuned models with method badges | Model ID, Quant, Downloads, Likes, Updated |


### Dual-Range Sliders

Two sliders let you filter by **date** and **parameter size**.  Live tool-tips show what has been selected.

Selection knobs have a minimum gap with bi-directional pushing.

**Date:**
- Left Most Position = *Anytime*
- Middle Positions are in 14-day increments prior to *Now*
- Right-most position = *Now*

**Parameter size:**
- Select from 0B to >1T parameters via piecewise linear mapping across 7 zoom segments.


### Filter Bars

Three *Type* filter bars control which pipeline tags are active.
**From PipeLine Classes**, **To PipeLine Classes**, and **Untagged PipeLines** are used to quickly activate broad categories of pipeline tags.
The user may then selectively activate/deactivate individual tags in the **Activated Pipeline Tags** bar to refine their choices.
Tags not yet activated appear in the **Available Pipeline Tags** bar below for quick selection.

It should be noted that *Any* refers to the specific modality with the name *any* and is not intended to activate all modalities.
The *All* activation chip is used for quickly activating all modalities.

- **From PipeLine Classes:** input modality (text, image, audio, video, any, all)
- **To PipeLine Classes:** output modality (text, speech, audio, image, video, 3d, any, all)
- **Untagged PipeLines:** toggles like "include untagged" (models with no pipeline tag)

Below the filter bars is a scope notice explaining coverage limits and linking to HF Search for full model discovery.


### Quantization Filter Selection

The **Quant Types** chip bar lets you toggle popular quant type categories on/off:
- AWQ
- Finetune
- FP4
- FP8 
- GGUF
- MLX
- Safe Tensors
- Others — whatever doesn't match the above (GPTQ, EETQ, AQLM, EXL2, Marlin, BNB, INT8, INT4, Q8, Q4)

Quant method detection checks both model name and tags for known keywords.
When a model ID contains multiple quant keywords, all are displayed in the badge.
Fine-tunes (cross-author models derived from a base) are labeled "finetune" with a green badge.

### Output Display Filters

Above the displayed results are 4 text boxes which may be used to selectively filter the output. Each has a clear button (✕) for quick reset.

The *L1 Author* box pins matching Base Model Authors to the top of the hierarchical tree rather than hiding non-matching authors.

The *L2 Model ID* filter is a global search term that cascades through the hierarchy: typing a model name narrows base models across all authors, which in turn updates the displayed L1 authors to reflect only those with matching models.
The *L3 Author* and *L4 Model ID* filters apply locally at their respective expansion levels within already-expanded sections — they do not cascade up to parent levels.
This intentional behavior lets you quickly find specific models regardless of which author hosts them.

### Hidden Models Preview Popups

When filters (date range, param range, pipeline tags, text search, etc.) hide models, a hidden count link appears below the L2 table (e.g., "+12 hidden by current filters").
At L4, the link only appears when the *L4 Model ID* text filter hides models (e.g., "+2 hidden by text filter").
Hovering over this link opens a **Hidden Models Preview** popup showing all filtered-out models in a scrollable table.

The popup displays:
- **Model ID** - clickable link to the HuggingFace model page
- **Params** - parameter count (resolved from cache; em-dash if unknown)
- **Quant** - detected quant method, or "SAFE TENSOR" when no quant keyword is found in the name
- **Tag** - pipeline tag for the model
- **Updated** - last modification date (YYYY-MM-DD format)

By default the hidden model list is sorted by Updated date descending (most recent first), but the user may sort by any column as desired.

The popup features:
- Sticky header ("Hidden Models Preview"), sticky column headers, and a persistent footer showing total hidden count
- Shows every hidden model at L2 (no sample limit); L4 popup capped at 200 samples — scrollable within a 300px max-height container
- Center-positioned over the trigger link with viewport boundary clamping
- 200ms hover delay to prevent flicker on accidental mouse passes
- Stays visible when hovering into the popup so links are clickable
- Resets scroll position to top each time it opens

### Progressive Rendering

Results appear incrementally as API requests complete. Each independent request (per pipeline tag, sort order, trending, untagged) fires immediately and triggers a re-render on completion. This means you see partial results quickly rather than waiting for all fetches to finish. The status line shows progress as `Fetching models… (completed/total)`.

### Additional Result Table Features

- **Column sorting** - Available at every level by clicking the column headers
- **Expandable rows** - Click on any row (excluding the link) to expand
- **Cached results** - Re-expanding is instant; task fetches are skipped once complete; stale-generation renders are discarded
- **Parameter deepening** - Models with unknown parameter counts are fetched when rows are opened and results are updated in real time (if available)
- **Infer Missing Params chip** - When enabled then models with unknown params search their children to deduce the parent's parameter count via API. Uses name-based Base Model ID regex first, then searches children (2 API calls per model), then fetches individual child cards (up to 10; stops early after 3 agreeing results)
- **Hide Missing Params chip** - When enabled, models without a known parameter count are hidden from L1 and L2 entirely
- **API call counter** - displays total requests made in the session; hover for rate-limit info; flashes amber during active rate limiting (3+ consecutive 429s)
- **Clear Cache button** - resets in-memory state (param cache, inflight fetch state, tree indexes, generation-bound tracking) while preserving filters and sliders. Collapses expanded sections - re-expand to reload from API
- **Quant badges** - color-coded by method (FP4, FP8, AWQ, GGUF, MLX, etc.); all detected methods shown; orphan quants get a yellow badge

## Caveats

By necessity of being kind to the Hugging Face API end-point, author and model results are *NOT* exhaustively complete.
The utility does have generous limits for the number of models it will pull though.

For obscure or old models with minimal visibility or active use, then such models may be left out of the search results.
Additionally many authors don't tag their model metadata properly which can also lead to them not getting pulled down in the results.

In order to expose such authors would require hammering the HuggingFace API quite heavily which is bad practise.

As a result, if you know the name of a specific author/model that you're looking for, then just use the regular Hugging Face Search Page and look them up there.


## Browser Requirements

Modern browser with ES2020+ support (Chrome 90+, Firefox 90+, Safari 14+).


## Future Ideas

- Export results to CSV
- Bookmarkable state (URL params for filters)
- Model architecture tags in L2
- Trending / likes-per-day metrics
