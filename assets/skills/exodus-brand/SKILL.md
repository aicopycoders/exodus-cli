---
name: exodus-brand
description: List, switch, inspect, or troubleshoot the brand workspaces the Exodus CLI has access to — "brands" here means the Exodus dashboard's brand workspaces, nothing else. Admins use a single API key with a local active-brand pointer; switching is one `npx @aicopycoders/exodus brand use <slug>` call, no .env editing. **This is the only way to verify which brands the CLI sees — `whoami` only shows the active brand, NOT the list.** Pick the right subcommand from intent — don't ask the user "list, switch, or inspect?". Only invoke when the user has explicitly invoked Exodus — they said "exodus" in the request ("exodus brand list", "switch my exodus brand", "which exodus brand am I on"), named this skill or /exodus-brand, ran an `npx exodus` command, referenced the Exodus CLI or dashboard ("the CLI doesn't see my new brand", "I just created a brand on the dashboard"), or the exodus hub skill routed here. Never claim generic brand questions ("what's our brand strategy", "update the brand colors") — in shared folders those may belong to the user's other tools.
---

```operator-guide
Subcommands:
  list             Show all brands available to your key
  use <slug>       Set the active brand for this CLI
  current          Print the active brand
  inspect <slug>   Show the brand's full config (foundation, primer, account)
  clear            Stop overriding — fall back to the key's default brand
Returns:
  Plain text summary (no JSON). The starred row is the active brand.
```

# Brand — Move the CLI Between Brands

## Strategic Context

One API key, many brands. **Any user can create and own unlimited brands** — via `npx @aicopycoders/exodus brand create "<name>"` or the dashboard. This is NOT admin-only, and brand names are scoped per user (two different users can each have an "Evergreen Fitness"). The key works for every brand the user OWNS (admin keys see everything); the CLI attaches `X-Active-Brand: <slug>` on every request. The ONLY "pinned to one brand" case is a brand someone ELSE invited the user into: they don't own it, so the header is ignored for it and it's the single brand their key sees. Never tell a user they can't create brands or are "locked to one brand" because their key shows `role: member` — a member who owns brands sees and creates as many as they want.

The active brand resolves **folder > pointer > key default**: on a multi-brand install each brand has a subfolder (marked by `.exodus-brand.json`), and running from inside one targets that brand automatically — it wins over the `{ activeBrand: "<slug>" }` pointer in `.exodus/state.json` that `brand use` writes. `brand current` tells you which one applied.

The dashboard's brand-switcher in the top-right is independent — your CLI active brand and your dashboard active brand can differ. That's a feature: read reports on Brand A while the CLI generates ads for Brand B.

## Read the Intent, Pick the Subcommand

Don't surface a "list, switch, or inspect?" menu to the user — figure it out from what they said:

| User says... | Run |
|---|---|
| "What brand am I on?" / "Which brand right now?" | `current` (then `inspect` if they want detail) |
| "List my brands" / "What brands do I have?" | `list` |
| "Create a new brand" / "Add a brand called X" / "Set up brand Y" | `create "<name>"` (no admin needed; switches you in) |
| "Switch to dlc" / "Change to brand X" | `use <slug>` |
| "Show me the foundation for brand X" / "What's brand Y configured with?" | `inspect <slug>` |
| "What kind of business is this brand?" / "Change the business type" / "It sells an app, not a product" | `show`, then `set --sells ... --promise ...` |
| "The new brand isn't showing up" | `list` first — if visible, suggest `use`; if not, the dashboard create didn't propagate |

## Common Commands

### List brands

```bash
npx @aicopycoders/exodus brand list
```

Shows role, the active brand (marked `★`), and the full accessible list. Flags it if the local active brand points at something you no longer have access to.

### Create a new brand

```bash
npx @aicopycoders/exodus brand create "Evergreen Fitness"
```

Creates a brand the user owns (any user can — no admin role required), then switches the CLI into it and, on multi-brand installs, sets up its subfolder. Brand names are scoped per user, so this succeeds even if another account already has a brand by that name (the slug is auto-disambiguated under the hood). Tell the user the next step is the primer (`exodus, set up my brand primer`). If the dashboard ever reports a name conflict for a brand the user is *sure* they've never made, that's a separate bug — not a sign the name is taken for them.

### Switch the active brand

```bash
npx @aicopycoders/exodus brand use new-brand-slug
```

Validates the slug, writes it to local state, and (multi-brand installs) creates the brand's subfolder + pulls its `state/brand-profile.md` if missing. Every subsequent CLI call (genesis, creative, template, foundation, etc.) targets the new brand — unless you run from inside a different brand's subfolder, which wins.

### Print the active brand

```bash
npx @aicopycoders/exodus brand current
```

Cheap pre-flight check before kicking off a long pipeline.

### Inspect a brand's config

```bash
npx @aicopycoders/exodus brand inspect <slug>
```

Surfaces foundation completeness, primer status, connected ad account, and writing-mode defaults. Use this when the user asks "is brand X ready to run?" — don't guess.

### Business type (the two tags B-roll follows)

```bash
npx @aicopycoders/exodus brand show
npx @aicopycoders/exodus brand set --sells product --promise body
```

Every brand has two tags: what it sells (`product`, `service`, `app`, `expertise`, `finance`, `other`) and what its ads promise (`body`, `money`, `neither`). The video uses them to pick its extra shots (B-roll). `show` prints both in plain words and who set them; when AI picked them with little to go on, it asks you to check. `set` takes either flag alone once both are set; a brand with no tags yet needs both. The same two dropdowns are on the dashboard's Brand info page.

### Clear the override

```bash
npx @aicopycoders/exodus brand clear
```

Falls back to the brand the API key was originally minted for.

## Anticipate the Next Move

Brand operations are almost never the goal. Read what's next and offer it:

- After `use <slug>` — "Want me to confirm foundation completeness with `inspect`, or jump straight to a Genesis run?"
- After `list` shows a new brand — "Switching to it now and walking through `exodus-foundation` if you want."
- After `inspect` reveals missing primers — "Foundation isn't ready. Want me to walk through it from a source doc?"
- After `current` — "Ready to run `exodus-genesis` on this brand?"

## After Creating a New Brand on the Dashboard

```bash
# 1. Confirm the new brand is visible
npx @aicopycoders/exodus brand list

# 2. Switch into it (creates its subfolder + pulls its profile on multi-brand installs)
npx @aicopycoders/exodus brand use my-new-brand

# 3. Walk through foundation
npx @aicopycoders/exodus foundation
```

`npx @aicopycoders/exodus@latest init` does the folder syncing in bulk — it creates a subfolder for EVERY brand the user owns and refreshes all their profiles, and prints the brand summary at the end. Either path works; `brand use` is the targeted one.

## Not the Right Skill For

- Creating, editing, or deleting brands themselves — those happen on the dashboard at Settings → Brands.
- Editing a brand's foundation content — use the `exodus-foundation` skill.
