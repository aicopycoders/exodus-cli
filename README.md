# @aicopycoders/exodus

The Exodus CLI + Claude Code skills for the Copycoders ad pipeline. It drives the
Genesis creative bots, workflows, banks, and image/meme pipelines against your
brand — from your terminal and from Claude Code.

You don't install it globally. Run it with `npx` from your workspace folder.

## Quickstart

```bash
# 1. Scaffold (or refresh) the workspace in the current folder
npx -y @aicopycoders/exodus@beta init
```

`init` creates the workspace (the `.claude/` skills, docs, and your brand
subfolder) and prints the next steps. The `@beta` tag is the dev/preview channel;
drop it (`@aicopycoders/exodus`) for the stable release channel.

### Connect your account

1. Open the Exodus dashboard → **Settings → Claude Code**.
2. Copy the `.env` snippet it shows you (your `EXODUS_API_KEY` + dashboard URL)
   and paste it into a `.env` file in your workspace folder.
3. Pull your provider keys down so the local tools have them:

   ```bash
   npx -y @aicopycoders/exodus@beta keys pull
   ```

   This writes your dashboard provider + image keys into `.env` (it only upserts
   those keys and preserves the rest of the file). Values are never printed.

### Check everything is wired up

```bash
npx -y @aicopycoders/exodus@beta doctor
```

`doctor` diagnoses local and dashboard-side issues in one shot — keys, workspace
health, CLI currency — and tells you exactly what to fix.

### Template video inputs

Native-audio template final cuts use the measured, post-trim clip length when an
approved picture reservation is longer than the available footage. Every spoken
word and required post-word action tail must still fit; unavailable speech/action
is refused rather than freeze-filled. Voice-first and ordinary script-door cuts
keep their existing timing. After the worker update, **Cut again** can reuse the
existing clips for this reservation-only failure; it does not require generating
new clips.

A measured native cut that exceeds its frozen length budget offers a longer target
and plan re-approval. Re-cutting unchanged selected clips is deterministic, so the
length refusal does not offer that as a recovery action.

Storyboard caption and overlay boxes use normalized `[x, y, width, height]`.
The first-cut text adapter converts them to the renderer's
`[left, top, right, bottom]`; source-ad reference boxes already use that renderer
contract and are preserved. Invalid geometry still holds the finish without
clamping. After the worker update, **Cut again** can retry a caption-geometry
adapter failure using the existing clips; no clip regeneration is needed.

Template sound choices stay explicit through prompt compilation, worker finishing
and CLI pull: `roomTone: false` requests no ambience and adds neither a room-tone
asset nor fallback brown noise. An absent historical choice keeps its existing
behavior. A selected music bed is independent of room tone; music-off templates
do not mix a stray bed file. In worker cuts and hand cuts from `exodus video pull`,
an actual held song master owns the audio alone: the pull carries `wholeVoice`
and `templateMotion` so first-cut omits the selected music bed. `songAsVoice` being
enabled without a held song does not suppress a selected bed or other sound.
The worker and backend share the same song-ownership check: a picked track or a
kept master counts; a pending song request alone does not.
The backend exposes `heldSong` only for a trusted template launch; ordinary
and legacy runs keep their existing response shape.
Narration takes a separate bed only when selected; no sound choice changes the
approved words, action windows or playback speed.

#### V2 input assistance and script review

Template input assistance is **not execution automation**:

- `--input-mode automatic` asks the server to resolve supported, unfilled choices.
- `--input-mode manual` exposes supported creative controls through the template's
  published capabilities and `--template-brief`.
- `--input-mode hybrid` uses the same controls as Manual; blank supported fields
  are automatic. There is no per-field checkbox or separate override map.

All modes retain explicit creative pins, model, voice route, account voices, saved
references and product selection. Server-owned locks still define the format:
Skeleton remains Skeleton, and a song-led format remains song-led. Unsupported or
incompatible values are refused, not silently cleared. No mode grants identity,
product facts, consent, soundtrack rights or permission to spend. V2 input controls
do not accept `--one-shot`; storyboard review remains required.

`--structure <key>` selects one of that template's published story structures.
`--reference <key>` selects reference-ad inspiration only, never production
conditioning or voice rights. Use authenticated discovery instead of guessing
keys or borrowing a different template's structures.
Reference examples can include advertiser references and historical generated
demos. Discovery prints each supplied source label and URL; the collection itself
does not certify that every example is an original ad or was made by us.

`--subject product|service|non-product` records an explicit subject. Absence remains
unknown, not an inferred product/service choice. Service and non-product briefs
must not select a saved product. Supply factual evidence in the source text;
subject selection does not grant new facts or claims.

Choose one explicit script entry path:

- **Write from a brief:** `--describe --script brief.txt`.
- **Adapt pasted copy:** `--adapt "<what may change>" --script original.txt`.
  The original file and adaptation intent are retained byte for byte. An adaptation
  request cannot supply new product claims or inferred identities/consent.
- **Intentionally keep original copy:** add `--keep-original` to the `--adapt`
  command. This requests guarded review of the exact original instead of generating
  changes. Any genuinely billable approval still needs a phase quote. The output
  explicitly says no adaptation was applied when the text is unchanged.

Mode/structure/manual-control flags alone never request a new script. A new V2
draft needs an explicit entry path above; no adaptation intent is inferred.

A new V2 write always returns a script-review stop before storyboard or video
generation. This is **not a promise of free preparation**: writer and claim-checking
work can be paid, and input assistance itself never approves that spending.
The human stop output displays the original pasted text, explicit intent and full
resulting script for comparison. `--json` retains the exact strings and the
server-issued approval. Keep the saved JSON unchanged and edit a separate script
file.
Extract with `jq -j '.script'`, not `jq -r`, when preparing an exact-text resume:
`-r` appends a newline that was not necessarily present in the reviewed result.

`--template-brief '<json>'` or `--template-brief @brief.json` supplies the existing
`{ "cards": { "<layer>": "<card>" }, "settings": { "<name>": <primitive> } }`
creative pins. The CLI checks only this transport shape; the server resolves
actual capabilities, locks and dependent choices. Dedicated `--requested-seconds`
and `--pictures-per-scene` flags override matching settings. Required `--style`
selects the launch look; matching the authenticated template default does not
automatically add a `cards.style` override (locked looks refuse even same-value
card pins). An explicit supplied or saved brief-style pin remains explicit for
server validation. A resumed brief merges supplied fields with saved pins, so
changing input mode never discards omitted choices.

Supported `--song-controls <json|@file>` and `--mechanism-plan <json|@file>` are
existing server-validated JSON objects, not arbitrary extra facts or engine
parameters. Explicit false music, frame/pacing shots and these sound/story controls
are retained on V2 stop/resume along with direction. A blank string in a creative
card/setting means unfilled: it removes that pin before server resolution. Nonblank
explicit values survive mode changes unchanged.
Song controls are offered only when the selected server template advertises
`templateCapabilities.songControls: true`. The existing fields are `genre`,
`mood`, `bpm`, `vocal`, `instruments`, and `durationSec`; for example,
`--song-controls '{"genre":"acoustic pop","mood":"hopeful"}'`. Absent capability
means unsupported, not a guessed format-ID exception. Nonempty incompatible pins
are held, not discarded; `--song-controls '{}'` (or all-blank text fields) explicitly
clears them for automatic resolution. Musical instructions do not grant soundtrack
or voice rights.

Discovery returns the authenticated server's `templateExperience` and
`templateCapabilities`; there is no bundled fallback catalog. Before quoting, the
CLI reads selected-draft input options using the exact intent/brief/route. When
published, safe `intentResolution` is retained separately in quote/review JSON and
shows `effectiveBrief`, explained holds, and `template-default` / `resolved` /
`pinned` provenance. Effective defaults never become new raw pins. Held or stale
resolution cannot proceed to a quote. If the server omits this optional view, the
CLI says provenance was not published instead of pretending defaults were
intelligently chosen; authoritative phase admission still applies.

Resuming a V2 stop retains its original `templateIntent`, subject, source, brief,
product, model, voice route, saved elements, voice map and current creative context,
including declared source-record and semantic adaptation-plan JSON when supplied.
A changed script, mode, structure/reference, creative pin, model, sound or voice
route needs another explicit `--stop-at-script --json` review before starting;
use the newly returned response and separately authorize its phase quote.
Changing product requires a fresh write using the original source, without
`--resume-script`. An older response without V2 original-input context cannot be
upgraded by attaching V2 flags to its receipt. Server verification remains
authoritative for workspace/template/product/context binding; editing saved JSON
does not confer approval.

#### V2 phase quote → exact script review → storyboard preparation

`--quote-preparation --json` requests a free, server-issued quote for the exact
current phase and inputs. It performs no writer, audio, image or video preparation.
The saved CLI envelope contains `preparationQuote`, stable `requestId`, and the
server-returned canonical action `input`. Review `estimatedUsd` (an approximate
point estimate, or `null` when actual cost is unknown), `maximumUsd` (the enforceable
allowance for this phase only), `scope`, and `expiresAt`. An unknown estimate is
neither zero nor the maximum; none of these values is a whole-video price.
The HTTP quote's `canonicalInput` uses the same existing server parsers as paid
preparation. The CLI stores that representation rather than independently trimming
Song or mechanism fields. Equivalent padded controls can continue against the same
canonical context; genuinely changed controls require fresh script review. A paid
review response must match the quoted canonical controls before it becomes a
resumable response. Original source bytes and explicit input intent are not
normalized or replaced by this process.

Only **`--authorize-preparation <saved-quote.json>`** accepts that quote's maximum
for its exact current phase/input. Before submitting paid work the CLI re-reads
the **same** quote operation with the same request ID and requires unchanged
authority. Missing/held/expired/replaced quotes and changed draft inputs cannot
fall through to the legacy paid route. Do not edit the saved file. For an ambiguous
failure, keep that same file and recover the same operation; the CLI never silently
creates new authority or retries paid preparation. A server cost/provider/worker
hold is a dependency to resolve, not permission to insert zero or an invented cap.

Discover actual entitled structure keys and supported controls first:

```bash
exodus video start --conceit ugc-template --input-options --json > options.json
STRUCTURE="$(jq -r '.templateExperience.defaultStructureKey' options.json)"
```

Review that structure and its locks. Then quote a new brief (the original text
remains `brief.txt` throughout):

```bash
exodus video start --script brief.txt --conceit ugc-template --style raw-iphone-ugc-template \
  --describe --input-mode hybrid --subject product --structure "$STRUCTURE" \
  --requested-seconds 30 --quote-preparation --json > script-quote.json
jq '.preparationQuote | {estimatedUsd, maximumUsd, scope, expiresAt}' script-quote.json
# Only after explicitly reviewing and accepting this phase's cost:
exodus video start --script brief.txt --conceit ugc-template --style raw-iphone-ugc-template \
  --describe --input-mode hybrid --subject product --structure "$STRUCTURE" \
  --requested-seconds 30 --authorize-preparation script-quote.json --json > script-review.json
jq -j '.script' script-review.json > reviewed.txt
```

For paste adaptation, replace `--describe` with `--adapt "<what may change>"` in
**both** commands and point `--script` at the unchanged original. Compare
`.templateIntent.input.originalText` with `.script` before continuing. Keep the
original and resulting files; for a full textual diff, `diff -u original.txt
reviewed.txt` shows their actual bytes/lines rather than an invented summary.
To intentionally retain the original, include `--keep-original` in both commands.

If you edit the result or change context, first quote and authorize a fresh guarded
script review, retaining the original source through `--resume-script`:

```bash
exodus video start --script reviewed.txt --resume-script script-review.json \
  --conceit ugc-template --style raw-iphone-ugc-template --stop-at-script \
  --quote-preparation --json > edit-quote.json
# Review edit-quote.json before accepting its bound:
exodus video start --script reviewed.txt --resume-script script-review.json \
  --conceit ugc-template --style raw-iphone-ugc-template --stop-at-script \
  --authorize-preparation edit-quote.json --json > refreshed-review.json
jq -j '.script' refreshed-review.json > reviewed.txt
```

Use the latest reviewed response and its exact script. A script-phase quote is
**never** storyboard authority. Quote storyboard preparation separately; only
after its actual scope/cap is available and accepted can this prepare a storyboard
(and supported prerequisite audio), still stopping for storyboard review:

```bash
exodus video start --script reviewed.txt --resume-script refreshed-review.json \
  --conceit ugc-template --style raw-iphone-ugc-template \
  --quote-preparation --json > storyboard-quote.json
# Review storyboard-quote.json; do not continue if the server returned a hold.
exodus video start --script reviewed.txt --resume-script refreshed-review.json \
  --conceit ugc-template --style raw-iphone-ugc-template \
  --authorize-preparation storyboard-quote.json
```

`--rewrite-to-fit` on V2 requires a signed saved review and itself stops for
review; it cannot launch or do an initial tidy-then-rewrite under one quote.
When supported, `--source-record` remains the original source-record JSON; V2
retains it through script stops and includes it in the storyboard quote. It is
not silently made adaptation evidence or production rights. The server judges
whether the selected format supports it. Ordinary Door 1/Swipe/Show commands keep
their existing behavior.

#### Existing template inputs and continuation

`video start --script <file> --conceit <template> --style <look>` accepts
`--requested-seconds <seconds>`, `--pictures-per-scene <1|3>` (default 1), and
`--product <brandProductId>` for template runs. Requested seconds are a positive
finite number, including fractions: the CLI does not clamp them to duration
presets. The server can refuse a length the selected template cannot support.
`--duration` remains the finished-cut upload duration, not a template input.

Choose an existing product belonging to your brand, not a product name or image
URL. Its authorized product photos are the supported product-reference path;
they are not actor identities, style references, or image-ad inputs. These flags
do not change ordinary script/swipe starts or Show runs and are refused on
`--show`. Missing values, invalid counts/numbers, and conflicting repeated choices
are refused before networking.

All metadata-identified approved templates require a free phase quote and explicit
authorization of that saved quote before paid preparation, even when using none
of the new input-mode flags. Cost-consent flags do not select an input mode,
invent `templateIntent`, or turn an existing script into a writing brief.
For a new start without `--describe` or `--adapt`, the supplied script remains
verbatim. A saved receipt retains its exact original source and source mode.
The first authorized script check always stops for review; it does not launch
a storyboard. `--one-shot` is refused, and `--rewrite-to-fit` needs a signed
saved review rather than an initial tidy-and-rewrite under one quote.
Authenticated template discovery is required; a failed catalog read is not a
paid-path bypass.

`--stop-at-script` starts no storyboard or video run, but writing and claim
checking may still incur the quoted provider costs. Save the entire JSON
response unchanged: it retains `scriptApproval`, exact original
`approvedSource`, `templateBrief` and `productId` when supplied. Use `jq -j` to
copy the exact script without adding a newline:

```bash
exodus video start --script script.txt --conceit ugc-template --style raw-iphone-ugc-template \
  --requested-seconds 45 --pictures-per-scene 1 --product <brandProductId> \
  --stop-at-script --quote-preparation --json > script-quote.json
# Inspect the phase, maximumUsd and exact input before explicitly authorizing.
exodus video start --script script.txt --conceit ugc-template --style raw-iphone-ugc-template \
  --requested-seconds 45 --pictures-per-scene 1 --product <brandProductId> \
  --stop-at-script --authorize-preparation script-quote.json --json > saved-stop-response.json
jq -j '.script' saved-stop-response.json > reviewed.txt
# Read reviewed.txt. An unchanged approved script needs a separate storyboard quote.
exodus video start --script reviewed.txt --resume-script saved-stop-response.json \
  --conceit ugc-template --style raw-iphone-ugc-template \
  --quote-preparation --json > storyboard-quote.json
exodus video start --script reviewed.txt --resume-script saved-stop-response.json \
  --conceit ugc-template --style raw-iphone-ugc-template \
  --authorize-preparation storyboard-quote.json
```

If you edit the script or its bound context, first quote and authorize another
script check using `--resume-script` with **`--stop-at-script --json`**. Review and
save that refreshed response before separately quoting storyboard preparation.
Neither a quote nor a previously signed receipt silently reapproves changed copy.

Template script receipts last **24 hours** and belong to the approving member in
that workspace. Resume using an API key owned by that same member (rotating the
key without changing its owner is fine). Receipt **v2** predates member/expiry
binding and cannot authorize a new storyboard quote or launch; this receipt version
is separate from the V2 template-input API. Already launched runs are unaffected.

An expired or legacy **signed** receipt can be renewed without rewriting your
script. Keep the saved JSON (including the old receipt) and your edited text file:

```bash
exodus video start --script reviewed.txt --resume-script saved-stop-response.json \
  --conceit ugc-template --style raw-iphone-ugc-template \
  --stop-at-script --renew-script-approval --quote-preparation --json > renewal-quote.json
# Review the script-check allowance, then authorize that same input:
exodus video start --script reviewed.txt --resume-script saved-stop-response.json \
  --conceit ugc-template --style raw-iphone-ugc-template \
  --stop-at-script --renew-script-approval --authorize-preparation renewal-quote.json \
  --json > refreshed-review.json
```

This keeps the edited script, original approved source, product, context **and signed
receipt**. Before consent, the server verifies the old receipt's signature, workspace,
template, product and source, including v2's original signing domain. Reapproval
ignores only the old expiry/member binding and issues the reviewing member a new
receipt. An unreadable, missing or unverifiable receipt requires a fresh write;
changing products also requires writing a new script, not renewing the old approval.
Checking may still cost the quoted amount; it is not a new write or storyboard
authorization. `--stop-at-script` performs this guarded review for expired/v2
receipts; `--renew-script-approval` makes recovery explicit after a server rejection.
It cannot be used with `--rewrite-to-fit`, without `--resume-script --stop-at-script`,
or on a Show. Review the refreshed response before requesting a separate storyboard
quote using an API key owned by the new approving member.

The resumed POST carries the script alongside the saved opaque `scriptApproval`,
exact approved source, brief and product. The server checks its approving member,
24-hour lifetime, workspace, template and context binding. An approved description
stays the original description, not the generated or edited script. Source modes are `verbatim` and
`description`; `script` is not a
wire mode. Explicit `--requested-seconds`, `--pictures-per-scene`, `--voice`,
`--voice-path` and `--video-model` override their matching saved choices. The CLI
retains the selected video model returned in the stopped response alongside
voice mode/path; a response without a model leaves the server to choose its
default. Malformed saved model values are refused locally. The server still
checks supported models and compatibility with the selected voice route.
These route choices are separate from signed account-voice selections.
Changing `--product`
requires a fresh write and approval without `--resume-script`; an old approval
cannot be relabelled. Outside V2, repeat other desired launch flags and supply
original `--source-record` / `--adaptation-plan` files when needed. V2 retains these
declared context records, but never unrelated saved execution/trust fields.

With authenticated template metadata, `--style` is also included in the writer's
template brief when it differs from that template's default. For legacy no-intent
starts, returning to the current server-provided default removes the saved style
override. V2 retains an already explicit brief-style pin for server validation
and material-context review. The server still validates style compatibility and
template locks; the CLI keeps no local catalog or hardcoded default.

Templates also accept existing saved references and account voices:

List supported saved references and actual account voices without writing or
starting anything:

```bash
exodus video start --conceit ugc-template --input-options --voice voice-first --json
```

This read-only command needs no script or Look. Optional `--voice`, `--voice-path`
and `--video-model` select the route whose capabilities are listed. Unsupported
selectors, an unavailable voice account and an available-but-empty catalog remain
distinct; no substitute voice catalog is supplied. Use the returned IDs below.

```bash
exodus video start --script script.txt --conceit ugc-template --style raw-iphone-ugc-template \
  --elements '[{"handle":"maya","elementId":"<savedElementId>"}]' \
  --voices '{"MAYA":"<accountVoiceId>"}' --stop-at-script --quote-preparation --json > selected-quote.json
# Inspect selected-quote.json before explicitly authorizing the same input.
exodus video start --script script.txt --conceit ugc-template --style raw-iphone-ugc-template \
  --elements '[{"handle":"maya","elementId":"<savedElementId>"}]' \
  --voices '{"MAYA":"<accountVoiceId>"}' --stop-at-script \
  --authorize-preparation selected-quote.json --json > selected-stop.json
```

Both flags accept inline JSON or `@file.json`. References use authorized saved
character/location IDs, not image uploads. Voice-map keys are canonical script
speaker names; `NARRATOR` means offscreen narration, not a visible character.
A string pins a voice ID, `{ "voiceId": "...", "label": "..." }` adds a label,
and `null` clears that speaker's pin. The server validates account availability
and template support; the CLI does not invent voice IDs or a catalog endpoint.

Saved references and account-voice maps survive edited-script continuation and
are bound to the approval. To change or remove a selection, resume with the new
`--elements` / `--voices` and **`--stop-at-script --json`**, first quoting and then
explicitly authorizing that script-check phase. This checks the edited draft
against its original source and new selections and returns a new bound receipt.
Save that response before separately quoting storyboard preparation. A direct start with
changed selections refuses before networking; it never silently reapproves or
discards the edited file. Equivalent explicit choices can repeat saved choices.
Repeated selection flags use the last value; `[]` references and `{}` voices
mean no selection and are omitted from the request. Changing the product still
requires a separate fresh write without `--resume-script`.

Resume requires `--script`, `--conceit` and `--style`, and always checks the
authenticated template menu before posting. A saved `launchDoor` or trust stamp
does not authorize a launch. Invalid JSON, malformed saved source/brief/product,
missing receipt, conflicting file flags, changed product overrides and Show
resumes are refused before networking. The saved response must have
`stoppedAtScript: true`, nonempty `script` and `scriptApproval` strings, and an
`approvedSource` with a valid mode and nonempty text. Older responses without a
receipt require a fresh write/approval. A brief may contain only string-valued
`cards` and primitive-valued `settings`; the server still judges the choices and
verifies the opaque receipt. Do not edit or fabricate it.

### Listen to and approve a run's Song

A run that sings its ad holds one Song master. Listen before motion starts:

- `video song <runId>` prints the Song's sha256s, its lyric, which lyric lines
  were heard, and whether it can be approved. It never downloads the audio.
  If recovery stopped before a master exists, it prints the held reason instead
  (`song: null` and a separate `hold` object in JSON, safe for older CLIs).
  Use **Try again on the held voiceover step**
  to resume this run's paid task and retained tracks; do not approve the empty
  checkpoint or start a new run to recover it. A retry does not replace a song;
  an unchanged permanent hold needs its stated input or recovery action first.
  Section alternatives longer than the approved transcription clock are retained
  but skipped without transcription. A fitting alternative can still become the
  master. If none fits, the hold lists both decoded lengths and the allowed clock;
  retry rechecks the retained alternatives without ordering another song.
- `video song approve <runId> --master <masterSha256>` approves exactly the
  master you listened to. If the run now holds a different one, nothing is
  approved.
- `video song import <runId> --file song.mp3 --lyric @lyric.txt --rights "<who
  owns it and consents>" [--from <s> --to <s>]` uses your own recording as the
  Song. The rights statement is kept as written, and the server records you,
  the signed-in member, as the person who confirmed it. Write the lyric one
  line per scene. A line nobody can hear on the recording keeps the Song from
  being approved.

## Where to go next

- `npx -y @aicopycoders/exodus@beta --help` — the full command surface.
- `npx -y @aicopycoders/exodus@beta workflow --help` — run, build, and automate
  saved multi-node workflows; resolve gate/repair parks from the inbox; read
  banks and promote winners.
- `npx -y @aicopycoders/exodus@beta hooks --help` — browse the Organic Scout
  hook library: filter by score, lane, validation status and more; explain a
  score; find cards sharing a hook pattern; export to CSV or JSON. Read-only.
- `npx -y @aicopycoders/exodus@beta ads --help` — read your own live Meta ads
  once the ad account is connected on the dashboard: `ads list` sorts them by
  cost per result, spend or CTR (lifetime, or `--since 90d`), and
  `ads show <adId>` prints the copy, both windows, the media links and the
  comment counts. Read-only — no Meta login needed.
- `npx -y @aicopycoders/exodus@beta comments --help` — read the comments on
  those ads, on Facebook and Instagram. Commenter names and links are stripped
  before storage; you get the words only. Read-only.
- `npx -y @aicopycoders/exodus@beta winners definition` — what this brand means
  by "a winner" for one ad account: the campaign roles, the rule, the dials and
  the last run's summary, exactly as confirmed on the dashboard.

Inside Claude Code, just say **"exodus"** plus what you want
("exodus, write me some ads") and the skills route the rest.
