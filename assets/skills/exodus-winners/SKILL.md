---
name: exodus-winners
description: Mine the member's OWN Meta ad account for its winning ads and import them into Exodus as generative fuel. There are two ways in and the skill checks which first: a brand whose Meta ad account is CONNECTED on the dashboard needs no Meta MCP at all — its ads, numbers, comments and winner definition are already synced into Exodus and read back with `npx @aicopycoders/exodus ads`, `comments` and `winners definition`; a brand without an integration uses the official Meta Ads MCP (their Facebook login, their machine) alongside the Exodus CLI. Either way this skill orchestrates the whole journey — pick one ad account, settle what a winner means (read the confirmed definition from the server, or run a NO-NUMBERS interview), gather the account's ads, confirm each pick visually, then push a winner-package JSON with `npx @aicopycoders/exodus winners import` and run the two-phase video gap-filler. Only invoke when the user has explicitly invoked Exodus: they said "exodus" in the request ("exodus, import my winning ads", "exodus winners", "exodus, mine my ad account for winners", "exodus, which of my own ads are winners"), named this skill or /exodus-winners, ran an `npx @aicopycoders/exodus winners` command, or the `exodus` hub skill routed here. Never claim generic asks ("what are my best ads", "pull my Meta ads", "analyze my Facebook ads") without Exodus context — in shared folders those may belong to the user's other tools; if the user did not say exodus, this skill is not for them. This is the member's OWN account's winners, NOT competitor swipes — competitor swipe mining lives on the dashboard's Swipe Mining surfaces, not here. The bare word "Genesis" without "exodus" refers to the member's own Genesis API key and personal bot recipes, NOT to Exodus.
---

```operator-guide
Subcommands:
  exodus winners import <file.json | ->  [--dry-run] [--no-wait] [--json]   Push a winner package (- reads stdin)
  exodus winners status <importId>       [--json]                           Re-poll an import later
  exodus winners list                    [--json]                           Winners Exodus already holds
  exodus winners definition              [--account act_…] [--json]         What THIS brand means by "a winner"

Key flags:
  --dry-run   Local schema check + server dry-run: would-create vs would-update per winner,
              plus a Scrape Creators key warning if it's missing. Zero writes, no media upload.
  --no-wait   Return the importId immediately instead of polling to outcomes
  --json      Machine-readable output

Facts baked into the CLI:
  • Scopes to your active brand (exodus brand current). Switch with the exodus-brand skill.
  • Requires the member's Scrape Creators key (Settings → Keys) — the own-page match scrape bills them.
  • asset paths in the package resolve RELATIVE TO THE JSON FILE'S FOLDER.
  • Re-push never duplicates rows: verdict snapshots replace wholesale; gap-filled rows
    upgrade in place; winners absent from a re-push are untouched. It DOES re-run the
    billed match scrape + enrichment — push updates, don't push as a retry reflex.

Meta side — CONDITIONAL (§0), check before you plan the journey:
  • Brand WITH a Meta integration (`exodus winners definition` answers, or `exodus ads list`
    returns ads): NO MCP. Ads + numbers come from `exodus ads list` / `ads show`, comments from
    `exodus comments list`, the definition from `exodus winners definition` (read-only — the
    definition lives on the server, never in state/own-brand-winners.json).
  • Brand WITHOUT one — including "isn't available on your account" (exit 1), "No Meta ad
    account is connected", "No synced ads for this brand yet" with no accounts listed, or an
    unknown-command error — never relay "ask an admin" or "connect
    on the dashboard"; the official Meta Ads MCP (https://mcp.facebook.com/ads) supplies all
    account data, exactly as §1–§5 describe.
Either way this skill NEVER calls the Meta Graph API directly and NEVER calls ads_library_search.
```

# Winners — Mine Your Own Ad Account and Import the Champions

This is the agent-side journey for **Own-Brand Winners**: turn the member's real Meta ad account into a set of designated winners that Exodus stores as generative fuel. Where the account data comes from depends on the brand (§0): a **connected** brand's ads are already synced into Exodus and read with the `exodus ads` family; an **unconnected** brand's come from the member's **own Meta Ads MCP** (their Facebook OAuth) sitting alongside the Exodus CLI.

The member is a **creative strategist, not a media buyer**. This entire journey is data *collection and preparation* — the analysis happens later, server-side, on the stored winners. So the interview **never asks a single numeric question**: no budgets, no ROAS targets, no thresholds, no "top how many?". You infer the mechanics and confirm in plain language. Make that rule impossible to break — if you catch yourself about to ask for a number, stop and infer it instead.

The arc, in order: **integration check (§0) → pick one account → settle the winner definition → gather the account's ads → 30k-foot view → visual confirmation → write the package → dry-run → import → video gap-filler.** A connected brand reads the definition and the ads off the server and skips the MCP mechanics in §3 entirely; an unconnected one runs the interview and mines via the MCP. Either way, re-running re-asks nothing already settled.

## 0. First: does this brand have a Meta integration?

There are now **two ways in**, and the first question is which one this brand is on. Ask the server, not the user:

```bash
npx @aicopycoders/exodus winners definition
npx @aicopycoders/exodus ads list --limit 5
```

**If either answers with real data — a definition, or ads — this brand has a Meta integration. Skip the MCP entirely.** The dashboard already syncs this account daily, so everything §1–§5 mines by hand is already sitting in Exodus:

- **Ads and numbers** come from `npx @aicopycoders/exodus ads list` / `ads show <adId>` (the `exodus-ads` skill has the full surface). No `ads_get_ad_entities` paging, no campaign-by-campaign loop, no 500-avoidance mechanics — none of §3 applies.
- **The winner definition** comes from `npx @aicopycoders/exodus winners definition`. Do **not** re-run the interview: a human already answered it on the dashboard, and asking again invites two different answers for one account.
- **Comments** come from `npx @aicopycoders/exodus comments list`.
- The Meta Ads MCP may still sit alongside for extras (a live preview image, today's numbers before tomorrow's sync). It is **not required**, and you must not ask the user to connect it just to read their own ads.

A list of ad accounts ("Pick which ad account you mean", or "Connected ad accounts:" under an empty `ads list`) also counts as an integration: the accounts are connected, the sync just hasn't filled in yet.

**These replies all mean "no integration". Take the MCP path below and say nothing about the dashboard connection:**

- **Refused:** `winners definition`, `ads list` or `comments list` exits 1 with "The Meta integration isn't available on your account. Ask an admin if you need it." The dashboard connection is switched off for this account. **Never tell the user to ask an admin**, and never stop there.
- **Not connected:** `winners definition` says "No Meta ad account is connected to this brand", or `ads list` says "No synced ads for this brand yet" with no accounts listed under it. Both add a line about connecting on the dashboard. **Never send the user to connect in dashboard settings** — the MCP reads the same ads.
- **Unknown command:** the installed CLI predates these commands and prints "Unknown command: ads" or an unknown-subcommand error for `winners definition`. Same thing: MCP path, no update nag.

**If neither answers — no integration — this brand keeps the MCP path below, exactly as written.** Everything here reads from the **official Meta Ads MCP**: a remote MCP server at `https://mcp.facebook.com/ads`, OAuth'd in the user's browser with their own Facebook login. We don't own that flow; there is exactly one setup pointer and no troubleshooting beyond it.

**If the `ads_*` Meta tools are not present in this session, stop.** Tell the user to add `https://mcp.facebook.com/ads` as a remote MCP server and complete the browser OAuth, then come back. Do not attempt any workaround, any Graph API call, or any other connection method.

## 1. Account selection — the required first step, pinned forever

**Connected brand (§0):** the accounts are already known — `npx @aicopycoders/exodus ads list` names the one it used, and lists the others when there is more than one. Pick from that list with `--account`, and skip the rest of this section.

**Unconnected brand:** call `ads_get_ad_accounts`. It returns **every** account the login can touch — often a dozen-plus across several businesses. For each: `ad_account_id`, `ad_account_name`, `business_name`, `is_queryable`, `not_queryable_reason`, currency.

- Show only **queryable** accounts (`is_queryable: true`). For any flagged one, surface its `not_queryable_reason` so the user understands why it's absent — don't silently drop it.
- **Account names can be empty strings** — fall back to the id and business name so the list is still legible.
- The user picks **one**. That account is **pinned** in the definition file (`adAccountId` + name) and is **never re-asked** and never allowed to silently drift. Multi-account handling beyond this single pin is out of scope — one account per definition file.

## 2. The winner-definition interview — prescriptive, no numbers

You are not collecting preferences here so much as confirming inferences. Four things get settled, and only one of them ever shows the user a choice.

**a) Objective → metric is invisible.** Ads group by their **self-labeled result type** (within objective — §2c); each group's success metric is the account's own label — Meta hands it to you already labeled (`results: {"value": "98 (Website appointments scheduled)"}`, `cost_per_result: {"value": "$91.64 USD (Website appointments scheduled)"}` — the string lives under `.value`). **Never ask the user to pick a metric.** The account already declared it. Offer one free-text escape hatch only — *"If your definition of a winner is different from 'the ads that drove the most results,' tell me in your own words."* — and record whatever they say **verbatim** as `customDefinition`, applied agent-side. Do not turn their words into a number.

**b) Campaign roles are infer-then-confirm.** Propose, per campaign, what the campaign is **for** — one of exactly three roles:

- **testing** — where new creative goes to be tried. Small budgets, many near-duplicate ads, short lives.
- **scaling** — where proven creative goes to be spent behind. Fewer ads, bigger budgets, longer lives.
- **other** — retargeting, retention, brand, anything that is neither of the above.

Infer each one from the campaign objective plus the campaign/adset **names** (naming is read-only creative context; see §6). Present the whole proposed map **once** for a single confirm/adjust pass, then save it. On a re-mine, only **new** campaigns get proposed; already-confirmed ones stay put.

Why roles and not awareness levels: a testing campaign and a scaling campaign are **not comparable**, and the winner rule has to know which is which before it ranks anything — an ad that "won" a test at 30 results is not the same object as an ad carrying a scaling budget. This is also the exact question the dashboard's winner setup asks, in the same three words, so the CLI and the dashboard can never propose different winners for one account. **A brand with a Meta integration has already answered it** — read the confirmed map from `npx @aicopycoders/exodus winners definition` (§0) instead of asking again.

**c) The winner rule is fixed — volume over efficiency, all-time, no caps.** State it, don't negotiate it:

> Within each result-type group, over the account's full lifetime (`date_preset: "maximum"`), the winners are the **smallest set of creatives that together carry ~80% of that group's lifetime results**, where each qualifying creative has **at least 10 results** (a materiality floor — one lucky conversion is not a winner). No top-N cap.

- **Groups key on the self-labeled result type, not on objective alone.** Real accounts mix objectives, and one objective can hide two currencies — OUTCOME_LEADS covers both a booked-call funnel (`"Website appointments scheduled"`) and an opt-in funnel (`"Website leads"`), and those must never share one 80% line (the cheap high-volume metric drowns the scarce valuable one). Partition by objective first, then by the parenthetical label on `results.value`; each distinct label is its own group with its own 80% line and its own floor.
- **The unit you rank is aggregated content, never the raw ad instance.** Advertisers duplicate: the same post runs in many ad sets and campaigns (same post id = the exact same content with its results split across instances), and the same video or image runs under several copy versions. Rank raw instances and a true winner shatters into sub-threshold fragments — or surfaces as several "different" winners that are one ad. Aggregate BEFORE applying the rule, and apply the **floor to the aggregate, never the instance** — four 6-result duplicates are one 24-result winner (§3 has the mechanics): collapse instances sharing an `effective_object_story_id` in every cut, and collapse further by creative asset (same video / same image across copy variants) within the format cuts.
- **Union with per-format cuts.** Run the same 80%/≥10 rule three ways: **overall** (post-level aggregates), **within video only**, and **within image only** (creative-level aggregates), then union the results. This guarantees both lanes populate even when one format dominates spend. The union dedupes on the aggregate's `accountAdId` (§3); a winner clearing multiple cuts is ONE row whose `selectionBasis` lists every cut it cleared (`overall` / `top-video` / `top-image`), and when a format cut is among them the stored verdict carries the **creative-level** aggregate's numbers and instance count (the broadest collapse it cleared).
- **Flat curve honesty.** If contribution is flat — no elbow, results spread evenly across hundreds of ads — say so plainly and show the top contributors instead of pretending there's a clean winner set. Never fabricate outliers to hit the 80% line.

**d) There are no losers at v1.** You designate winners only. Don't ask about, or invent, a "worst ads" pass.

The defaults behind this rule (`window: "maximum"`, `resultsFloor: 10`, `contributionLine: 0.80`) live in the definition file and are **edited in the file, never interrogated**. Selection is **format-agnostic** — you never ask "video or image?"; the per-format cuts already guarantee top images *and* top videos import.

## 3. Mining mechanics — the MCP facts that make or break this

**Connected brand (§0): skip this whole section.** The daily sync already did it. `npx @aicopycoders/exodus ads list --sort spend --limit 200 --json` gives you every synced ad with its copy, format, campaign/ad set, and both windows' numbers in one call — no paging, no 500s, no compact-tuple discipline to hold. Apply §2c's rule to those rows and go to §4.

**Unconnected brand:** mine on `ads_get_ad_entities`. These are hard-won live-probe facts; encode them into how you call, not into a doc you can look up later:

- **Never mine account-wide — scope every metrics pull to one campaign.** Account-wide ad-level pulls that include `results` **500 consistently** on real accounts (mixed objectives, thousands of near-duplicate test ads) — no limit, no sort tweak, and no retry unsticks them, and `results` 500s at campaign level too. Enumerate campaigns first (attributes, `objective`, and spend all work fine at campaign level), then pull ads **campaign-by-campaign** with `results` over `date_preset: "maximum"` and aggregate agent-side into result-type groups (ads carry `campaign_id`; join `objective` from the campaign pull).
- **Sort server-side, tally compactly — never hold full blobs, and never floor raw rows.** Metric *filtering* on `ads_get_ad_entities` consistently **500s** — never filter by a metric. Metric *sorting* works. Per campaign: sort by **results descending**, page through, and retain one **compact tuple per result-bearing ad** — ad id, ad name, campaign id, creative id, created time, results, spend — discarding zero-result rows (they can't move any sum) and every other field. **The 10-result floor does NOT apply while paging**: sub-floor instances of one post can sum to a winner (§2c), so no row is ever dropped for being small. A creative-testing account runs 100+ near-duplicate ads per campaign; compact tuples keep the whole account to a few hundred short lines, where retaining or printing whole per-campaign blobs burns the session's context before the winner rule ever runs.
- **Aggregate across the whole result-type group, then floor, then rank.** A scoring group spans campaigns — finish paging **every** campaign that feeds a group before ranking it (the per-campaign loop is just how you gather; the group is the unit you rank, once). Then batch re-fetch creatives by `creative_ids` for the retained tuples — that yields each ad's `effective_object_story_id` (post identity), `image_hash` / video identity, and **format** (which the format-cut denominators need for every result-bearing row, not just candidates). Merge instances sharing a post id (every cut), then copy variants sharing the same creative asset (format cuts), summing results and spend as you merge. Only **now** apply the ≥10 floor — to aggregate totals, never to instances: four 6-result duplicates are one 24-result winner. Denominators: the overall 80% line divides by the group's total; each format cut divides by that format's own subtotal (`resultsShare` still reports share of the full group total).
- **The aggregate's identity must survive a re-mine.** Its `accountAdId` is its **earliest-created instance** — stable across re-mines (the top performer can change month to month; the oldest instance can't, and the server dedupes rows on this id — an unstable pick would duplicate the winner on the next import). The **highest-results instance** supplies the copy and `sourceNames`. When an aggregate spans more than one instance the verdict sentence says so plainly ("… across 4 ad instances in 3 campaigns"); summed counts are numbers **you** derived — own that in the sentence, and leave single-instance display strings verbatim.
- **Retry once on a 500 — but only where 500s are transient.** An identical retry usually clears a one-off 500 on a scoped call. It never clears the two structural 500s above (metric filtering, account-wide results) — don't burn calls proving that again.
- **Metric values are display strings, not numbers** — `"$8,980.38 USD"`, `"4.20%"`, `"Not available"` for zero-delivery ads. Keep them **verbatim** for the verdict snapshot. You still need to *rank* by them agent-side — parse a working copy for the math, but never mutate the string you store. (Account level also returns a numeric `amount_spent_cents` if you need a clean total.)
- **`results` / `cost_per_result` self-label the outcome** (`.value` = `"98 (Website appointments scheduled)"`). That label is the metric — carry it into `resultType`.
- **Hierarchy:** ads carry `campaign_id` + `adset_id`; `objective` lives on the **campaign**. There is no `campaign_name` at ad level — get campaign/adset names from a **campaign-level / adset-level call**, then join by id.
- **Always pass explicit `fields`** on every by-id lookup (`ads_get_creatives`, `ads_get_ad_images`, `ads_get_ad_videos`). The "omit fields → all fields" default is **broken** — a bare by-id lookup returns only `{id}`.
- **Creative content needs a re-fetch by `creative_ids`.** Listing mode returns ids/names only. A creative detail call gives `body` (primary text), `title` (headline), `call_to_action_type`, `image_hash`, `image_url` (signed CDN), and `effective_object_story_id` (`<pageId>_<postId>` — its **prefix is your page id**, the scrape target and own-brand row key).
- **`pageName` comes from the user, not from Meta.** The page tools can return `"(unknown)"` for the page name, and `ads_library_search` (which carries it) is off-limits — so once you have the page id, **confirm the page's name with the user in one line** ("This account posts as page 10715… — that's your <name> page, right?"). It names their own-brand entry in Exodus; don't guess it.
- **Non-US accounts need `country` set.** The package's `source.country` defaults to `US`, and a wrong country makes the server-side Ad Library match silently miss. Infer it from the account (currency, business) and confirm alongside the page name when it isn't clearly US.
- **Images: download the bytes at interview time, not push time.** `ads_get_ad_images` (by hash) returns a full-res signed CDN `url` that **expires** (watch the `oe=` param). Grab it while you're confirming the winner, save it locally, and reference the local file in the package.
- **Video: there is no download URL. Never promise one.** `ads_get_ad_videos` gives `title`, `length`, and a poster `picture` only — no source/download URL. The actual mp4 comes from the user in the gap-filler (§8).
- **Every video winner MUST carry its poster.** Download the `picture` from `ads_get_ad_videos` at confirmation time and attach it as `assets.posterPath` — for an unmatched video winner it is the **only** thumbnail the Own Brand gallery will ever have; skip it and the winner renders as a blank placeholder. The CLI dry-run warns on poster-less video winners: treat that warning as a stop, not a formality.
- **One page per package.** Winner↔library matching scrapes exactly `source.pageId` — a winner posted by any other page can never match and always gap-fills. If the account's winners span more than one Facebook page, split them into **one package per page** (each with that page's `pageId`/`pageName`); each import creates/updates its own own-brand entry and every winner keeps a real shot at matching.
- **One `breakdowns` value per call.** Stay on `ads_get_ad_entities` for raw data — the `ads_insights_*` tools are opinionated narrative wrappers (trend/funnel prose), not the numbers you're ranking.
- **Pass the user's real ask through `advertiser_request`** on each tool call — it's Meta's audit surface; give it the user's actual words.
- **Never call `ads_library_search`.** Winner↔Ad-Library matching happens **server-side in Exodus** after import; the old title-fingerprint approach is dead. Your job ends at the account data.

## 4. The 30,000-foot view first

Before you confirm a single ad, lead with the **account summary** — the strategist wants the shape before the specimens:

> "1,041 ad instances collapsing to 312 distinct creatives. In the Purchases group, 37 creatives produced ~80% of the 12,400 lifetime purchases — and 29 of those 37 are video. That format skew is itself a finding. (The account's second result type, Leads, gets its own line.)"

The instance-to-creative collapse, the format skew, the count of winners, the share they carry — that framing *is* strategic value. Deliver it, then move to confirmation.

## 5. Visual confirmation — the human gate

This is a HITL gate; treat it like one. For each proposed winner, show the actual creative: on a **connected** brand, `npx @aicopycoders/exodus ads show <adId>` prints fetchable image/video/poster links (fetch them and show the creative, not its link; don't save the URL — they expire); on an **unconnected** one, render it with **`ads_get_ad_preview`** (an actual in-context creative image). The strategist:

- **strikes** picks that don't belong,
- **adds** any obvious winner the rule missed,
- and may attach an optional free-text **note** per winner (`strategistNote`).

Their edits win over the algorithm. Don't argue the rule against their eyes — they made these ads. Only after this pass do you compose verdicts and write the package.

## 6. Naming is read-only

Campaign / adset / ad names feed two things: your **campaign-role inference** (§2b) and the winner's `sourceNames` as creative context. That's all. **No naming-conventions guidance** — nobody is asked to rename anything, and the account's naming hygiene is not your concern.

## 7. The verdict snapshot & the winner-package JSON

Every winner carries a **verdict snapshot** composed to the schema below. Single-instance metrics stay as **display strings verbatim** — never parsed into numbers in what you store. An aggregate winner (§2c) is the one exception: its `results`/`spend` are sums you derived across its instances, and its sentence names the instance count so nobody mistakes a derived total for a Meta string. You compose one plain-language sentence per winner. A **fresh snapshot is written on every re-mine; snapshots are never patched.**

```jsonc
{
  "version": 1,
  "source": {
    "adAccountId": "act_123…",
    "adAccountName": "Ground Co",
    "pageId": "10715…",              // scrape target + own-brand row key (from effective_object_story_id prefix)
    "pageName": "Ground Co",
    "country": "US",                 // optional, default US — non-US accounts false-unmatch otherwise
    "minedAt": "2026-07-14T18:30:00Z"
  },
  "winners": [
    {
      "accountAdId": "1202…",        // the natural key; REQUIRED
      "campaignId": "1201…",
      "adSetId": "1202…",
      "sourceNames": { "campaign": "…", "adSet": "…", "ad": "…" },  // verbatim, read-only
      "createdTime": "2025-11-02T…",
      "format": "video",              // "video" | "image"; REQUIRED
      "bodyText": "…",                // verbatim; bodyText OR headline required
      "headline": "…",                // optional
      "ctaType": "SHOP_NOW",          // optional
      "effectiveObjectStoryId": "pageId_postId",  // optional
      "verdict": {
        "sentence": "Winner by contribution: 2,214 purchases (6.2% of group) @ $18.20 across 4 ad instances, all-time through Jul 2026",  // REQUIRED — name the instance count when the winner aggregates >1
        "resultType": "Purchases",         // the self-label from results.value's parenthetical — also the scoring-group key (§2c)
        "results": "2,214",                // single instance: Meta's display string verbatim; aggregate: your derived sum (the sentence names the instance count)
        "resultsShare": "6.2%",            // YOU derive this (share of the result-type group's total)
        "spend": "$40,297",                // same rule as results: verbatim for single instances, your derived sum for aggregates
        "costPerResult": "$18.20",
        "asOf": "2026-07-14",
        "objective": "OUTCOME_SALES",
        "awarenessLevel": "product-aware",       // optional — read off the AD'S OWN COPY, or omit
        "selectionBasis": ["overall", "top-video"],  // which cut(s) it cleared
        "strategistNote": "…"         // optional, from §5
      },
      "assets": {
        "imagePath": "./media/1202….jpg",          // image winners: downloaded at interview time
        "videoPath": "./media/1202….mp4",          // user-supplied file (gap-filler)
        "posterPath": "./media/1202…-poster.jpg"   // video winners: REQUIRED in practice — the gallery's only thumbnail (§3)
      }
    }
  ]
}
```

Verdict metrics are display strings verbatim (aggregates: derived sums, named as such — §7 intro). `assets` is optional in the schema, but a video winner without `posterPath` ships a blank gallery card (§3). A **malformed winner is rejected individually server-side** (with a reason in the ledger) — it never aborts the whole import.

## 8. Import — dry-run, push, then the video gap-filler

Run these in this exact order.

**1. Write the package to disk.** Put it at `state/own-brand-winners/import-<date>.json` (user-inspectable and re-runnable), with the interview-time downloaded media in a folder alongside it. **Asset paths are relative to the JSON file's folder** — so `./media/…jpg` next to `import-<date>.json` resolves correctly.

**2. Dry-run first, always:**

```bash
npx @aicopycoders/exodus winners import state/own-brand-winners/import-<date>.json --dry-run --json
```

Show the user the would-create vs would-update split. **If the dry-run reports the Scrape Creators key missing, surface it now** — a real import will fail without it; route them to Settings → Keys (scrapecreators.com). **If it warns that a video winner has no posterPath, go back and grab the poster (§3) before pushing** — that warning is the difference between a gallery of ads and a wall of blank placeholders. Fix any would-reject rows, then push for real:

```bash
npx @aicopycoders/exodus winners import state/own-brand-winners/import-<date>.json --json
```

Default polling waits for outcomes. Present the **per-winner outcome table** it returns — each row is `matched` / `gap-filled` / `partial (missing: …)` / `rejected (reason)` — plus the created-vs-updated split.

**3. The two-phase video gap-filler.** Do **not** open with "find me 12 mp4 files." Push everything first; the report names exactly which video winners came back `partial (missing: video-file)` (expected — MCP has no video download). Then ask the user for **just those** files — they made the ads, they usually have them. Write a **second import JSON** containing only the partial winners: copy each winner's **full object** from the first import file (the server validates every push the same way — a stripped-down winner missing its `verdict`, `format`, or copy is rejected, not merged), same `source` block, and add the `videoPath`. Re-push it — the idempotent upgrade path completes those rows in place (the identical verdict re-replacing itself is harmless):

```bash
npx @aicopycoders/exodus winners import state/own-brand-winners/gapfill-<date>.json --json
```

Pick gap-fill candidates by their `missing` array **containing** `video-file` — an unmatched video winner usually lists `transcript` too. The re-push fills the file gap, but transcription runs as a **separate sweep after the import finalizes**, so the row typically still reads `partial (missing: transcript)` right away. That's not a failure — tell the user, and re-check `exodus winners list` later for the transcript to land.

Any winner the user can't supply a file for **stays amber and visible** in `exodus winners list` — that's fine, not a failure.

**4. "What does Exodus already hold?" is `exodus winners list`** — never keep the imported-winners ledger agent-side; it lives server-side and this is how you read it.

**5. Re-push safety** (from the CLI itself): re-pushing never duplicates rows — verdict snapshots replace wholesale, gap-filled rows upgrade in place, winners absent from a re-push are left untouched. But it is not free: every push re-uploads referenced assets, re-runs enrichment, and re-fires the Scrape Creators match scrape (billed to the member) — so re-push when there's something to update, not as a retry reflex.

## 9. Definition persistence — server first, local file only without an integration

**Which of the two applies is settled in §0**, and the two must never both hold a definition for the same account.

**Brand WITH a Meta integration — the definition lives on the server. Full stop.**

```bash
npx @aicopycoders/exodus winners definition            # one connected account
npx @aicopycoders/exodus winners definition --account act_1234567890
```

That command reads the confirmed answers a human gave on the dashboard: the pinned account, the campaign-role map (§2b), the rule variant, the dials, and the last run's summary. It is **read-only, and there is no CLI write** — you do not create, patch, or mirror `state/own-brand-winners.json` for these brands, and you never re-run the §2 interview to "fill in" anything. Changes are made on the dashboard (Settings → Meta → winner setup); a second copy in a local file is exactly how the CLI and the dashboard would drift into two different answers for one account.

If it answers with a list of accounts instead of a definition, the brand has several connected — ask which one the member means and pass `--account`. If it says no definition exists yet, point them at the dashboard's winner setup; don't improvise one locally.

**Brand WITHOUT an integration — the local file, exactly as before.** Persist the interview to `state/own-brand-winners.json`, keyed by **brand slug** (`state/` survives skill refreshes). It holds:

- pinned `adAccountId` + name (§1),
- `campaignRoleMap` (§2b — `testing` / `scaling` / `other` per campaign id),
- editable `defaults` — `{ "window": "maximum", "resultsFloor": 10, "contributionLine": 0.80 }`,
- `customDefinition` (the §2a escape-hatch text, verbatim),
- `lastMinedAt`.

Re-running re-asks **nothing already pinned** — only genuinely new campaigns get a confirm pass. Losing the file costs a short re-interview, never duplicate rows (dedup is server-side on `accountAdId`). Defaults are changed by editing the file, never by interrogating the user.

## Failure handling

- **Meta `ads_*` tools not in the session** — first check §0: if the brand has a Meta integration you don't need them at all. Only a brand WITHOUT one needs the MCP; then stop and point at `https://mcp.facebook.com/ads`. No other workaround exists.
- **"The Meta integration isn't available on your account. Ask an admin…", "No Meta ad account is connected to this brand", or "No synced ads for this brand yet" with no accounts listed** — no integration (§0). Switch to the MCP path silently; never pass the "ask an admin" or "connect on the dashboard" line on to the user.
- **`exodus winners definition` lists ad accounts instead of a definition** — the brand has several connected. Ask which one, then re-run with `--account act_…`. Never pick for them silently.
- **`exodus winners definition` says no definition exists** — nobody has finished winner setup for that account. Point at the dashboard (Settings → Meta → winner setup); do not build a local one for an integrated brand (§9).
- **`ads_get_ad_entities` 500 with a metric `filtering`** — that's the known filter bug, not a transient. Drop the filter, sort instead, threshold agent-side (§3).
- **`ads_get_ad_entities` 500 on an account-wide (or campaign-level) `results` pull** — structural, not transient; retries never help. Scope to one campaign per call and aggregate agent-side (§3).
- **Any tool 500s once on a scoped call** — retry the identical call once before reporting it.
- **Dry-run warns "video winner has no posterPath"** — stop and grab the poster via `ads_get_ad_videos` (§3); pushing without it leaves a blank placeholder in the gallery.
- **A by-id lookup returns only `{id}`** — you omitted `fields`. Re-call with explicit `fields` (§3).
- **Signed image URL 403 / expired** — it lapsed since the interview. Re-fetch `ads_get_ad_images` and download again immediately.
- **Dry-run says Scrape Creators key missing** — real import will fail; Settings → Keys first.
- **`partial (missing: video-file)`** — expected for video winners; run the §8 gap-filler.
- **Import poll timed out** — the import is still running server-side; re-poll with `npx @aicopycoders/exodus winners status <importId>` rather than re-pushing.
- **Import auth / wrong brand** — `npx @aicopycoders/exodus doctor`, then confirm `npx @aicopycoders/exodus brand current` is the brand you mean (switch via the `exodus-brand` skill). Winners scope to the active brand.

## Not the right skill for

- **Competitor swipe mining** — this skill is the member's OWN ad account only. Mining competitors' ads lives on the dashboard's **Swipe Mining** surfaces (and the CLI swipe commands), not here.
- **Naming-conventions guidance** — names are read-only inputs; nobody is asked to rename anything.
- **Designating losers** — winners only at v1.
- **Scheduled / automated re-mining cadence** — re-run the skill when you want a fresh snapshot; there's no scheduler.
- **Multi-account handling beyond the single pin** — one account per definition file.
- **Meta MCP connection troubleshooting beyond the one URL**, and **any direct Meta Graph API call** — out of bounds; the MCP is the only Meta surface.
- **Writing copy or rendering images from these winners** — that happens downstream once they're stored (`exodus-genesis`, `exodus-image`); this skill only collects and imports.
