---
name: exodus-top-ads
description: Read Exodus's Top ads, Top brands and Ad templates — the weekly chart of the best-performing ads from top brands, the brands behind them, and Luke's proven ad templates with real example ads and their scripts — through the read-only `npx @aicopycoders/exodus top-ads`, `top-brands` and `ad-templates` commands. Use it whenever an Exodus member wants ideas or proof from what's working for other brands right now, "exodus, show me top ads", "exodus, what's working in top ads this week", "exodus, find me a top ad about joint pain", "exodus, which brands are running the most ads", "exodus, find a template for a before-and-after ad", "exodus, show me template 3's scripts", or wants a Top ad to swipe into a video. Only invoke when the user has explicitly invoked Exodus: they said "exodus" in the request, named this skill or /exodus-top-ads, ran an `npx @aicopycoders/exodus top-ads`, `top-brands` or `ad-templates` command, or the `exodus` hub skill routed here. Never claim generic "top ads" or "ad library" asks without Exodus context; in shared folders those belong to the user's other tools. The member's OWN live Meta ads are `exodus-ads`; their tracked competitors' ads are the Mining page's swipe list, not this.
---

```operator-guide
Read-only. Nothing here changes anything or spends the member's money.

  npx @aicopycoders/exodus top-ads list [--list top500|new|trending] [--sort top|newest|longest]
                                        [--brand "<name>"] [--filter "<value>"]... [--limit n] [--json]
  npx @aicopycoders/exodus top-ads search "<words>" [--list top500|new|trending] [--limit n] [--json]
  npx @aicopycoders/exodus top-ads show <id> [--json]
  npx @aicopycoders/exodus top-ads filters [--json]
  npx @aicopycoders/exodus top-brands list [--limit n] [--json]
  npx @aicopycoders/exodus ad-templates list [--json]
  npx @aicopycoders/exodus ad-templates show <number, name or id> [--json]
  npx @aicopycoders/exodus ad-templates search "<words>" [--json]

Swipe a Top ad (or a template's example ad) into a video:
  npx @aicopycoders/exodus top-ads show <id>                  → prints its Meta Ad Library link
  npx @aicopycoders/exodus video swipe --url "<that link>"    → see exodus-video

Facts baked into the CLI:
  • One shared chart for every member, updated once a week. No brand needs to be picked.
  • Same lists, sorts, filters and search as the Top ads page on the dashboard.
  • --limit: 1–500, default 40. Ids to type back are in the list's "id" column.
  • Top brands' live-ad counts are estimates and print approximately ("~7.4K").
  • A 403 means Top ads isn't turned on for this member's account (see below).
```

# Top ads, Top brands and Ad templates

## What these are, and why a member reaches for them

**Top ads** is a weekly chart of the ads top brands are spending behind hardest right now: the Top 500, what's new this week, and what's trending. It's the same chart as Sources → Mining → Top ads on the dashboard. The point of it is proof: an ad that a big brand keeps paying to run is working, so its hook, its shape and its angle are worth learning from before writing something new.

**Top brands** is the brands behind that chart, ranked by how many ads they have live, with each brand's pages: its main page, and any persona pages (pages under a person's name, like a founder or a doctor, that the brand runs ads from).

**Ad templates** are Luke's proven ad shapes. Each one says what stays fixed in it (its structure, how it's dressed up, its style; the CLI prints these under "Locked in"), its beats (the steps of the ad, in order), and real example ads that follow it, each with its script written as fill-in-the-blanks. A template is how you turn "that ad works" into "here's how to make one like it for this product".

All three are read-only here. Following or hiding brands and making your own copy of a template are done on the dashboard page; nothing in the CLI does them.

## When to use which command

- "What's working right now?" → `top-ads list` (Top 500 in the chart's order)
- "What's new this week?" → `top-ads list --list new`
- "What's trending?" → `top-ads list --list trending`
- "Show me ads about X" / "find a top ad that…" → `top-ads search "X"`. When search by meaning answers, it goes by meaning, not just matching words: "dog owners tired of vet bills" finds ads about that even when they never say "vet bills", and the table's "match" column says **close** or **less close**. When it doesn't answer (busy, or the member's searches for the minute are used up), the CLI says so and shows the ads with the words in them instead. Results come closest first either way. A topic plus "this week" ("what's working this week for pet supplements") is a search too: it searches this week's Top 500.
- "Only Pixar-style ads" / "only UGC" → `top-ads filters` to see the exact values, then `top-ads list --filter "<value>"`. Values in the same row match either one; values in different rows must all match. If two rows share a value name (UGC can be a style and a format), the CLI says so; re-run with `--filter "Style: UGC"`.
- "What is this brand running?" → `top-ads list --brand "<name>"`
- "Show me that ad" → `top-ads show <id>`: its headline, text, button, landing page, what happens in it, its concept, angle, hook and beats, its transcript, its tags, its video file link, and its Meta Ad Library link.
- "Who's running the most ads?" → `top-brands list`
- "Is there a template for this?" → `ad-templates search "<words>"`, then `ad-templates show <#>`
- "Show me all the templates" → `ad-templates list`

When you're going to analyze rather than skim (comparing hooks across 20 ads, grouping angles), add `--json`.

## Swiping a Top ad into a video

There's no separate command for this, and none is needed:

```bash
npx @aicopycoders/exodus top-ads show 120210000000000
# … Meta Ad Library: https://www.facebook.com/ads/library/?id=120210000000000
npx @aicopycoders/exodus video swipe --url "https://www.facebook.com/ads/library/?id=120210000000000"
```

Keep the link in quotes: the `?` in it trips some shells. The second command is the same swipe the dashboard's Swipe a video starts. Hand over to `exodus-video` for it (prices, approvals, what happens next). A template's example ads print their links the same way in `ad-templates show`.

## Reading a template's scripts

In a script, words in `[CAPITALS]` are blanks: `[PRODUCT]`, `[PROBLEM]`, `[PET NAME]`. Under each script, "Blanks" says what each one fills with. `[speaker_0]` and `[speaker_1]` mark who's talking, and lowercase notes in brackets like `[laughs]` are sounds. When you help the member adapt one, fill the blanks with their product's real details; keep the template's structure and beats, since that's what made the example ads work.

## When Top ads isn't turned on for the member

Top ads is switched on account by account, and one switch covers all three: Top ads, Top brands and Ad templates. If it isn't on for this member, every command answers with a 403 and the line:

> Top ads isn't available on your account. Ask an admin if you need it.

Tell the member that plainly, in your own words: Top ads, Top brands and Ad templates aren't turned on for their account yet, and an admin at Copycoders can turn them on. Then stop. There's no flag or other command that gets around it, so don't retry, don't look for the ads somewhere else, and don't guess what the chart says.

## Honesty rules

- **Say which week.** The chart is weekly; `list`, `search` and `show` each print which week it is. "On this week's chart" beats "currently".
- **Quote, don't paraphrase.** A hook or headline that's working is worth its exact words; `show` prints them verbatim.
- **A live-ad count is an estimate.** "~7.4K live ads" is about 7,400; don't present it as exact.
- **Other brands' ads are for learning from, not copying.** When helping write from one, take the shape, the angle and the hook's job, and put the member's own product and claims in it.

## Failure handling

- **"this server does not support top-ads list yet"**: the backend is older than these commands. Run `npx @aicopycoders/exodus@latest update`, then try again.
- **403 with "Top ads isn't available on your account"**: not turned on for this member (above).
- **401**: the CLI prints which backend rejected the key and how to fix it. Follow it, then `npx @aicopycoders/exodus doctor`.
- **400 on `--filter`**: the value's name didn't match one row exactly. The message says what to type; `top-ads filters` lists every value.
- **"No ad … is in this week's Top ads"**: the chart moved on since that id was listed. Run `top-ads list` again for this week's ids.
- **"There is no Top ads chart yet"**: the weekly chart hasn't been written. Nothing to do but try later.
- **"Search by meaning didn't answer just now"**: the results are the ads containing the words. Usable as they are, or try again in a minute.

## Not the right skill for

- **The member's own live Meta ads and their numbers**: `exodus-ads`.
- **Importing the member's own winning ads**: `exodus-winners`.
- **Making the video**: `exodus-video` (`video swipe --url "<link>"`).
- **Static image templates** (`exodus template`) and **video formats** (`exodus video --input-options`): different things that happen to share the word "template".
- **Following, hiding, or copying a template**: done on the dashboard page.
