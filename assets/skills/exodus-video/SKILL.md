---
name: exodus-video
description: Make a video ad with Exodus from the terminal. One sentence ("swipe this ad as a microdrama for my brand", "make this a UGC video") is walked through the template door stop by stop, with a yes asked before each paid step. A competitor's video ad (a file, a link, or an ad in Exodus) is swiped with `exodus video swipe`, as Swipe a video does on the dashboard: broken down, matched to a kind of ad, read first, then one sheet of choices and one yes for the write and the whole video (or, when the member asks, step by step with a yes before each paid step). With no ad named ("find some ads to swipe for this product, give me options"), it first lists the video ads in the brand's swipe library with `exodus video swipe find` and offers at most six. The main path is script-first: run a saved video workflow with `npx @aicopycoders/exodus workflow run`. You read and approve the storyboard, pull every finished piece (per-scene clips, the narration track and per-scene voice, keyframes, cast identity stills, word timings, the music bed) into a folder with `exodus video pull`, and upload a finished cut for approval. Exodus makes the pieces; the cut is made outside it, in whatever editor the user wants — this skill hands over the pieces and the facts about them, it does not prescribe an editor. Use it whenever the user has invoked Exodus and wants anything to do with a video ad, an ad run's clips or storyboard, "pull the pieces", "stitch it together", "make the cut", "upload my cut", or checking on a video run ("exodus, make a video ad from this script", "exodus, is my video run done", "exodus, pull the clips for run X and cut them", "exodus, what's wrong with scene 3", "exodus video status"). Also use it when the user ran an `npx @aicopycoders/exodus video` command or the `exodus` hub skill routed here. Admins get every video command; beta testers with video switched on get start, swipe, status, storyboard, approve, voices, retry-frame, pull and upload on their own brands (see "Beta testers"). "video isn't enabled for this key" means the run id is wrong, the command is admin-only, or video isn't switched on for that dashboard user, so check the id and then say so; do not retry. Never claim generic video-editing asks ("edit this mp4", "add captions to my reel") without Exodus context; in shared folders those belong to the user's other tools. Running or authoring workflows generally is `exodus-workflow`; static image ads are `exodus-image`; copy is `exodus-write`.
---

# Video: make the pieces, cut the ad, hand it back

Exodus makes the PIECES of a video ad, not the finished ad. From a script, a run
writes a storyboard, draws one picture per scene, records the voice, renders one
video clip per scene, and generates a music bed. Then it parks and waits for a
cut.

There is no server-side stitch and no server-side mix. Nothing joins the clips,
nothing sets levels, nothing burns in captions
(`scout/src/workflow/video/music-bed.ts` states the ruling: "the cut, and the
mix, happen outside from the pieces the CLI pulls"). You pull the pieces, cut
them wherever you like, and upload the result. Approving the upload is what
makes it the ad.

Your job in this skill is to drive that loop, hand over the pieces with the
facts about them, and make whatever cut the user asked for. **How to edit is the
user's call, not this skill's** — see "Cutting the ad".

This file ships on the member's machine. It holds commands, the manifest's
shape, and recipes for the cut. It does not hold prompt text, house primers,
judge wording, or model instructions.

## How a run starts

The ad is a saved workflow in the brand, started script-first with `exodus
workflow run`. From there the same nodes render, `video status` reads the run,
`video pull` writes the folder, and `video upload` and `approve` finish it.

A Show is no longer required. `exodus video start` starts from a script, a
conceit, and a style. The same parks follow: it stops at the storyboard for the
user's yes, unless it was started with `--one-shot` (see "What costs money"). The full line is under
"Starting a run". An optional `--direction` note is whole-ad rules, and that
note cannot contain a colon. "The script file" shows the right form and the
wrong one.

**The kinds of ad.** `--conceit` takes one of the kinds the server offers. The
server's list is the truth, and nothing prints it on request. Pass a key it
doesn't offer and the refusal names every key it does: `video start --conceit
must be one of …`. Nothing is spent on a refused start. Today the server offers
15 formats and then Custom:

| Key | Kind |
|---|---|
| `podcast` | Podcast |
| `ugc` | UGC talking head |
| `stage` | Speaking on stage |
| `street` | Street interview |
| `personification` | Personification |
| `news-broadcast` | News Broadcast |
| `court-tv` | Court TV |
| `soap-opera` | Soap Opera |
| `storytime` | Storytime While Doing a Task |
| `customer-service-call` | Customer Service Call |
| `debate-circle` | Debate Circle |
| `talk-show-panel` | Talk Show Panel |
| `infomercial` | Infomercial |
| `dating-show` | Dating Show |
| `game-show` | Game Show |
| `custom` | Custom |

Custom builds the ad from the script itself. A script with no `CAST:` runs as a
voice-over, and a script with people runs as a scene. Voice-over and Scene are
not on the menu by name; Custom is the way to them. A narrator-only script fits
Custom alone. If the refusal lists different keys from this table, the server
is right and this table is stale.

The template door is a second menu, `exodus video start --input-options`. The
Golden Six formats start there. "From one sentence to a film" walks it.

The Rig box on that workflow is where the run's Conceit and Style come from.
Conceit is the family plus Wrapper, Narrator Person, and Delivery. Style is the
look. Narrated Story is the voice-over family and Acted Story is the dialogue
family (`familyTree.ts`). Those family names stay the code's names.

## From one sentence to a film

The member types one sentence, such as "swipe this ad as a microdrama for my
brand". You drive the run through its stops and wait for the member at each
one. When the sentence names a video ad to swipe as it is made (a video file,
a link to the ad, or an ad in Exodus) and the member asks for no format of
their own, go to "Swiping a video ad" below instead. The Golden Six formats start on the template door, which needs
Templates switched on for the member's account. Without it the CLI answers
"video isn't enabled for this key" or "Templates aren't available on your
account. Ask an admin if you need it." Tell the member that and stop. A beta
tester's key refuses the template flags and `retry-clip` with a sentence
naming what it refused ("Beta testers"): tell the member and stop. Do not retry.

Two rules hold at every stop:

- **The run page link.** The start prints `Watch it: <link>`. Keep it and give
  it to the member at every stop: the faces, rooms, pictures, voice samples
  and clips open there. `status` leaves it out at the storyboard stop.
- **A yes before every paid step.** Tell the member what the step buys
  and its price, then wait for their yes. The price is the one the CLI
  printed: `maximumUsd` and `estimatedUsd` under `preparationQuote` from
  `--quote-preparation`, or the total from `video quote`. Where the CLI prints
  no price, say that it prints none. A quote covers only its phase, never the
  whole video: say so. A saved quote that has expired or no
  longer matches is refused with nothing spent: quote again and ask again.
  Reads cost nothing and need no yes.

**The Golden Six.** `exodus video start --input-options` lists the templates
this account may start, the Golden Six first, one line each:
`<key> — <label> — <description> — <n> structures`. Use the key it prints.
`--style` takes the template's own look, from this table.

| The member asks for | `--conceit` | `--style` |
|---|---|---|
| UGC, a creator talking to camera | `ugc-template` | `raw-iphone-ugc-template` |
| an authority yapper, an expert explaining | `authority-yapper-template` | `realistic-template` |
| a microdrama, a short acted scene | `microdrama-template` | `realistic-template` |
| a skeleton timeline | `skeleton-timeline-template` | `pixar-3d-template` |
| a song ad, a Suno song, a jingle | `pixar-song-template` | `pixar-3d-template` |
| personification, the product or a body part talking | `personification-template` | none of its own: ask the member to pick one of the looks the server offers |

A `--style` the server does not offer is refused with the list of looks it
does offer, and nothing is spent.

### Start

1. Find three things in the sentence, and ask one question for whatever is
   missing:
   - the source ad: pasted text or a file, as it is, or the words of an ad in
     Exodus or behind a link (the `swipe` skill's section 1 gets them). Save
     the words to `source.txt`. A video ad the member wants swiped whole, its
     kind and look and shots as well as its words, goes to "Swiping a video
     ad" below. That path picks the kind itself, so a member set on one of the
     Golden Six stays here.
   - the format: the table above.
   - the brand: `exodus brand current`.
2. `exodus video start --input-options --conceit <key>` prints the template's
   story structures, its reference ads, the saved references and the account
   voices. It writes, quotes and starts nothing. Name the structures to the
   member, one line each. A structure they pick goes on the stop 1 lines as
   `--structure <key>`.
3. A template run always stops at the storyboard. The CLI refuses `--one-shot`
   on a template start before anything is sent ("Template preparation requires
   storyboard review; do not combine it with --one-shot. Nothing has
   started."), and the server never approves a template's storyboard by
   itself. A member who asks for no stops still gets each paid step named, with
   its price or the fact that the CLI prints none, and a yes asked before it
   runs.

### Stop 1: the script and the cast

1. Quote the script:

   ```
   exodus video start --script source.txt --conceit <key> --style <look> \
     --adapt "<what may change, in the member's words>" --stop-at-script \
     --quote-preparation --json > script-quote.json
   ```

   Add `--product <brandProductId>` only when the member gives a saved
   product's id; the CLI lists no products. Give the member the price.
2. On their yes, run the same line with `--authorize-preparation
   script-quote.json` in place of `--quote-preparation`, into `stop1.json`. It
   writes the script and starts no run.
3. Write the script out byte for byte:
   `node -e 'process.stdout.write(require("./stop1.json").script)' > script.txt`.
   Show the member the source and `script.txt` side by side, and the cast:
   each name that speaks a line. The stop file can also carry the app's notes
   on the copy, such as a claim it could not check against the source or a
   line that may not fit:
   `node -e 'for (const n of require("./stop1.json").copyNotes ?? []) console.log(n.detail)'`.
   Show each note next to the script, word for word. A note stops nothing;
   the member decides. Ask: go on, change a line, or stop.
   - Go on: "The run starts" below.
   - Change a line: copy `script.txt` to `edited.txt` and make their change.
     An edited script is checked and approved again, at a price of its own.
     The first line quotes; the second waits for their yes:

     ```
     exodus video start --resume-script stop1.json --script edited.txt \
       --conceit <key> --style <look> --stop-at-script --quote-preparation --json > edit-quote.json
     exodus video start --resume-script stop1.json --script edited.txt \
       --conceit <key> --style <look> --stop-at-script --authorize-preparation edit-quote.json --json > stop1b.json
     ```

     From here `stop1b.json` is the stop file. Write its script over
     `script.txt` the same way and show it again, with its copy notes.
   - Stop: nothing more is spent.

### The run starts

`<stop file>` is the latest one: `stop1.json`, or `stop1b.json` after an edit.
Use it with `script.txt` written out from it, unchanged. A different script,
product, voice or reference is refused, and nothing starts.

The approval in a stop file lasts 24 hours, and only a key of the member who
approved it can use it. After that the storyboard quote is refused and nothing
is spent. Renew it with the two "Change a line" lines above, with
`<stop file>` in place of `stop1.json`, `script.txt` as the script and
`--renew-script-approval` added to both. That checks the
same script again at a price of its own (give the member the price, and run
the second line on their yes); it writes nothing new. Continue from the new
stop file.

```
exodus video start --resume-script <stop file> --script script.txt \
  --conceit <key> --style <look> --quote-preparation --json > board-quote.json
```

That quotes the storyboard. On the member's yes:

```
exodus video start --resume-script <stop file> --script script.txt \
  --conceit <key> --style <look> --authorize-preparation board-quote.json --wait
```

It prints the run id and `Watch it: <link>`, then waits until the run needs
the member.

### Stop 2: the picks (arrives with the next server update)

Today a run goes from the script straight to the storyboard. Run this stop
only when `status` says the run is waiting for picks.

1. `exodus video picks <runId>` lists, for each person, four faces and the
   voices; four rooms for the set; the camera styles, when the run offers them.
   Each face, room and voice sample has its own link. Show it all with the run
   page link.
2. Ask for one face and one voice per person, one room, and a style when
   one is offered. Send the answers as:

   ```
   exodus video pick <runId> --face <who>=<n> --voice <who>=<n|voice name|voice id> \
     --room <place>=<n> [--style <key>] [--note "<text>"]
   ```

   `<who>` is the name the script uses. `--face` and `--voice` repeat once
   per person. `--style` (the camera style) is for the
   microdrama. The run goes on only when every slot has a pick. A pick that leaves a slot open prints the open
   slots: ask for those.
3. "Show me other faces": `exodus video picks <runId> --redo face:<who> --note
   "<what to change>"`, or `room:<place>` for rooms. It draws four new paid
   pictures. The CLI prints no price for them: say so, never guess one, and run
   it only after their yes. The second redo of a slot needs the note, and a
   third is refused: ask them to pick from what is shown.

When `picks` answers that the server does not support it yet, the run has no
picks stop: go to stop 3. When it answers `Unknown subcommand: "picks"`, this
CLI is older than the server: run `npx @aicopycoders/exodus@latest update`,
then `picks` again.

### Stop 3: the storyboard

`status` says "Parked: the storyboard is waiting for your yes."
`exodus video storyboard <runId>` prints each scene's line and picture, and who
speaks with which voice ("Reading the storyboard gate" has the detail). Show it
with the run page link, then ask: approve, redo a picture, change a voice,
move someone (Micro-drama template only), or stop.

- Approve: `exodus video approve <runId>`. It approves the storyboard and
  buys the voices and the clips
  (with the pilot stop, the pilot first), the expensive part. The CLI prints
  no price for them at this stop: say so, and approve on their yes. A storyboard the app's check stopped is
  refused with the reason. Tell the member, and on their yes approve again
  with `--accept-findings`.
- Redo a picture: `exodus video retry-frame <runId> --node <nodeId> --scene <n>
  --note "<what is wrong>"`, with the node id from the `Redo one frame:` line
  `status` printed. It redraws one picture. The CLI prints no price for it:
  say so and wait for their yes.
- Change a voice: `exodus video voices <runId> --set <who>=<voice>` ("Giving
  the characters voices").
- Move someone (only the Micro-drama template has the blocking map, and it is
  admin-only today; its storyboard prints `see each room and where everyone
  stands`): `exodus video map <runId>` prints each room in metres seen from
  above, each person's mark, their side of the wide shot, the setups that film
  the room, and what a move there redraws and its price. Show it. Then
  `exodus video move <runId> --move <who>=<x>,<y> [--place <place>] [--note
  "<what to change>"]`, with `<who>` as the script names them. Before it, tell
  the member how many pictures the move redraws and the price `map` printed;
  when `map` says `price unknown`, say the price is unknown. Either way, run it
  only after their yes. A move that keeps everyone on the same side of the
  wide shot redraws nothing and costs nothing, and `move` says so. A move off
  the room, onto another person or across the 180-degree line of a setup is
  refused in one sentence: tell the member and ask again. After a move, wait
  for the redrawn pictures (`exodus video storyboard <runId>` shows them)
  before you approve; approve and another move are refused until they land.
- Stop: `exodus workflow cancel <runId>`.

**The song format** waits twice more. `exodus video song <runId>` prints the
Song master, its listen link and its sha256 once one is ready. The member
listens; on their yes,
`exodus video song approve <runId> --master <masterSha256>`. Before its clips
the run parks with "Parked: final provider requests are prepared".
`exodus video quote <runId>` prints each request's price and the total; on
their yes, `exodus video approve <runId> --request-quote <reviewSha256>`.

### Stop 4: the pilot clip (arrives with the next server update)

Today approving the storyboard makes every clip, and the next stop is the end.
With the pilot stop, the run makes one clip after the storyboard, checks it and
parks. `status` then says it "made its pilot clip (scene <n>)" and whether the
words heard match. On UGC and the authority yapper the pilot is two clips, one
talking and one listening in silence. Show the pilot on the run page, the
words line and every "Check failed" or "Check skipped" line, then ask: keep
it, or redo it. When `status` says the pilot clip failed, there is nothing to
keep: offer the redo it prints, which names the scene.

- Keep it: `exodus video approve <runId>` makes the other clips, the expensive
  part. The CLI prints no price for it: say so, and approve on their yes.
- Redo it: `exodus video retry-clip <runId> --scene <n> --note "<what is
  wrong>"`. One new clip. The CLI prints no price for it: say so and wait for
  their yes. The note steers the motion,
  never the words.

### The audition stop

A template run started from the dashboard can film a few planned scenes first
and hold the rest. A run started here never asks for one. `status` then names
the audition scenes and prints what to run next:

- `exodus video approve <runId> --audition <digest>`: show the member those
  clips on the run page first. On their yes, run it exactly as printed. The
  run then goes on and makes the clips it held.
- `exodus video approve <runId>` with "failed audition takes only": it pays
  for another try of the audition takes that did not finish; the finished
  ones are kept. The CLI prints no price for it: say so and wait for their
  yes.
- "inputs changed" or "refused for safety or their pictures": nothing can
  be approved. Offer to stop the run (`exodus workflow cancel <runId>`) and
  start a new video.

### End: watch and approve

At the final watch, follow the block `status` prints ("Where a run can
stop"). When the cut is already uploaded, give the member the run page to
watch it. When the run waits for a cut: `exodus video pull <runId> --out ./ad-<runId>`, make the
cut ("Cutting the ad"), `exodus video upload <runId> --file <cut.mp4>`, and
give the member the run page. Ask: approve, redo a clip, or stop here.

- Approve: `exodus video approve <runId>` makes the cut the ad. It is one-way.
- Redo a clip: `retry-clip` as at stop 4, after their yes. Then pull, cut
  and upload again.

**On the song format**, tell the member this before they approve: "The song
made here is for review. Before this video runs as a paid ad, make the same
lyrics and style again in the Suno app while on a Pro or Premier plan, download
it there and use that file: Suno's terms allow commercial use only of songs made
on those plans and downloaded from Suno."

## Swiping a video ad

What Swipe a video does on the dashboard, from the terminal. Exodus breaks the
competitor's ad down, matches it to the closest kind of ad and look it makes
(the template), writes the brand's version, and starts the video on the kind
the swipe wrote. The run is the same one Swipe a video starts on the
dashboard.

These steps need Video switched on for the member's account. Without it every
swipe command answers "Not found on this brand. The id is wrong or is another
brand's, video isn't switched on for your dashboard user, or this is not the
brand you meant (exodus brand current). Check the id first." Check the id and
the brand. If both are right, tell the member Video isn't switched on for
them, and stop.

This path has no picks stop and no pilot clip. The run goes from the start
straight to the storyboard (stop 3), and approving the storyboard makes every
clip. A run started with `--one-shot` approves its own storyboard when its
checks pass. Making the video from one of our formats (`--adapt`, "From one
sentence to a film") keeps the picks stop and the pilot clip.

By default a swipe is one round: you read the ad, send the member one sheet,
and on their one yes write the brand's version and make each video they
picked. When the member names no ad, the options come first (step 0): video
ads from the brand's swipe library to pick from. A member who asks to say yes
before each paid step gets "Step by step" below.

**Long waits.** The CLI waits up to 25 minutes for a breakdown, 10 for a
template, 15 for a write (the write always waits; it has no `--wait`), and 60
for `swipe start --wait`. Run these in the background, or leave `--wait` off
and check in, so the shell's own time limit does not cut them off. A wait that
was cut off or timed out is not a failure: the work goes on. Follow it by the
id it printed, with the command the CLI names, and never by running the paid
line again: a second run buys it a second time.

### 0. No ad named: find some

When the member asks for ads to swipe without naming one ("find some ads to
swipe for this product, give me options"), offer options first. Skip this
step when the member named a file, a link or an id.

1. The free product check comes first, as in step 1: `exodus video swipe
   products`, and with no products, tell the member and stop. Then, free:
   `exodus video swipe find --json`. It looks through up to 200 ads of the
   brand's swipe library, shared fairly across the competitors (the whole
   library when it holds fewer, and then `"wholeLibrary"` is true), and keeps
   the video ads with a file, newest collected first, each with its id,
   advertiser, first line, word count and the start of its transcript. Its
   counts are of the ads it looked through, not of the whole library.
2. Send the options in one message, then stop and wait:

> I found <V> video ads from <C> competitors in <your swipe library, or, when "wholeLibrary" is false: the 200 ads I looked through in your swipe library>. The <k> that fit <product> best:
> 1. **<Advertiser>**: "<first line>" (<w> words). Fits: <one reason, from the ad's words and the product>.
> 2. **<Advertiser>**: post text "<first line>" (no transcript yet).
> <V − k> more found. Say "more" for the next six, or name a competitor.
> Pick by number, or say "all" for these <k>. Your pick is your yes to read
> every ad you pick, one after another: each read costs a little, on the
> team's keys and on your model key. Nothing is written or started before
> your yes to the sheet.

The rules of the options:

- **At most six options in one message.** "More" sends the next six in the
  same order you chose them by, leaving out every ad already shown; past
  the rows the CLI showed, run `exodus video swipe find --limit 200
  --json`. When the member names a competitor, run `exodus video
  swipe find --brand "<name>" --json`. Leave out the "more found" line when
  there are no more. When that find says none of the video ads is from that
  name, say the CLI's line and offer the advertisers it lists.
- **"All" means the options the member last saw**, never every ad found.
- **The reason comes from the ad's words and the product.** A product fact
  in it comes only from `exodus video swipe products` (the product's name
  and description) or the primer. Say nothing about the competitor beyond
  the ad's own words. Never call an ad a winner, a top ad or a proven ad:
  the list holds no results (no spend, no views, no days running) and does
  not rank by them. Its order is newest collected first, nothing more.
- **Post text is not spoken.** A first line with `"firstLineFrom": "post
  text"` is the post's headline or text, not words said in the video: show
  it as post text, never as something someone says.
- **An ad with no transcript goes last**, with no reason: its words are not
  known before the read.
- **The kind of an ad is known only after it is read.** Never state a kind
  as fact before a read.

**A find by kind.** When the member asks for a kind of ad ("find me some
authority yappers"), offer at most six whose words sound like that kind, and
say so in the message's first line, as "<kind>: sounds like, from the words;
the read confirms it." After the reads, the sheet's first
line names any ad the template read as another kind, so the member can drop
it ("drop video 3, go" is already a yes).

**What a pick is.** Only numbers given after an options message ("1, 3 and
5"), or "all" (the options the member last saw), are picks. The numbering
goes on across "more" and across a new find (for a named competitor): the
next six are 7 to 12, and so on, never 1 again. Keep the id of every
number you showed, and read a pick by that id. "You pick" is not a
pick: name your own picks by number, each with its reason, and wait; read
nothing yet. A reply that takes them ("yes, those") is the pick. "Swipe all
of them" in the first message, before any options were shown, gets the
options first. A reply that picks nothing (a question, "tell me more about
2", "maybe") is not a pick: answer it and wait.

**A pick is the yes to read every ad picked.** Say in one line what you are
about to read and who pays, in words like: "I'll read these 2 ads now, one
after another: each breakdown on the team's keys, each template on your own
model key." Then step 1 reads them in number order, by the ids the find
printed (`--ad <id>`), each breakdown then its template, without asking
again between them. Only what the member did not pick still gets the one
ask of "The limit: $0.50 for the read." in step 1: an ad found or named
after the pick, or a second pass over the same list. A pick whose read is
refused (its video expired or was removed; the read says so in one sentence
and buys nothing) or fails is left out, as step 1 says. Reading a failed ad
again is paid and needs its own yes.

**Into the sheet.** Every pick is on the sheet, in number order. The count is
ads × personas, and every rule of step 3 holds, above 6 videos too. In a
sheet file, each pick is `{"ad": "<id>"}` in `"sources"`, in the same order.

**Only part of the library was looked through.** When `"wholeLibrary"` is false
and none of those ads is a video with a file, the library is not empty:
the find looked through only part of it. Say the CLI's line, say that, and
offer a link or a file of an ad. Do not offer mining.

**An empty library.** When the find answers "The swipe library has no ads yet
for this brand.", or, with `"wholeLibrary"` true, that none of its ads is a
video with a file, tell the member in the CLI's own words, then offer
three ways and run none of them:

- a link or a file of an ad (step 1 reads it);
- `exodus swipe brands list` (free): the competitors this brand tracks, each
  with the date it was last mined;
- `exodus swipe mine`: collects the tracked competitors' ads into the
  library.

**Before any yes to mining**, tell the member in one message: it runs on
their own Scrape Creators key; the CLI prints no price for it; it mines every
active competitor on the watchlist, up to 50 in one run, the least recently
mined first; and it starts the moment it runs, in the background. Only a
reply that names mining after that message is the yes ("yes, mine them"), and
it buys the mining only, no read. After the mine, do not find again at
once: `exodus swipe latest` and `exodus swipe status <runId>` follow the
weekly swipe run, not mining, so they cannot show it is done. The mine
itself prints "Check progress: exodus swipe brands list". Tell the member
the mine has started and that you can look again in a few minutes. When
they ask, run `exodus swipe brands list` (a competitor that showed
`never-scraped` and now shows a `last=` date has been mined; the date has
no time, so one mined earlier the same day shows no change), then `exodus
video swipe find --json`. If it is still empty, say what the list shows and
stop; do not keep checking. Transcripts are made after the mine finishes, so
a newly mined ad can show "no transcript yet" for a while.

### 1. Read the ad

First, free: `exodus video swipe products`. When it answers "This brand has
no products yet. Add one in the dashboard first.", tell the member and stop
before any read.

**Reading the ad, without asking.** Read each ad the member named before the
sheet, and only those. Say so in one line, in words like: "I read the ad
first; that costs a little, on the team's keys and on your model key." Then:
`exodus video swipe --file <ad.mp4> | --url <link> | --ad <swipeAdId> --yes --wait`
(the breakdown, on the team's keys), `exodus video swipe status <breakdownId>
--full` (what it read: each shot, the script with who says each line, the
cast; free), and `exodus video swipe template <breakdownId> --yes` (the kind
of ad and look it matched; one model call on the member's own Anthropic or
OpenRouter key). The CLI's next lines say "ask first": here the one line
above covers the read, and the sheet's yes covers the writes and the starts.
When the breakdown prints "Still reading after 25 minutes", it is not done:
wait once more with `exodus video swipe status <breakdownId> --wait`, and if
it is still reading, stop and tell the member.

**The limit: $0.50 for the read.** The CLI prints no price before a read, so
keep to the limit with what it prints after. Count each breakdown once, from
the lines it ends with: those of the `exodus video swipe --file | --url |
--ad … --wait` command, or, when that wait was cut off, those of `exodus
video swipe status <breakdownId>` once it says the breakdown is done:

- "It cost $…, on the team's keys." is that breakdown's cost. Part of it may
  be an estimate: "It cost $… (partly an estimate), on the team's keys."
- A first line "This ad already has a breakdown: <id>. It cost nothing." is
  zero, even when a later line repeats what it cost the first time. "It
  reused answers bought before, so it cost nothing." is zero too.
- No cost line at all is unknown.

Every later `exodus video swipe status <breakdownId>` repeats the cost: count
it once only. The template is the member's own money in the read, and its cost is
never printed: "This template was already made, so it cost nothing." is
zero, and a new template is unknown.

Read one ad at a time: its breakdown, then its template. Before each read
after the first (a template, or the next ad's breakdown), stop and ask the
member once when the costs counted have reached $0.50, or when any read so
far is unknown: an unknown cost counts as reaching the limit. Say what is
left to read. A new template is always
unknown, so with several ads you read the first and ask before the rest. The
check comes before each read, so the total can pass $0.50 by one read. Ads
the member picked by number from the options (step 0), or with "all", are
already a yes to read: read every picked ad without this ask. The ask still
comes before any ad they did not pick.

A breakdown or a template that fails prints why. With one ad, tell the
member and stop. With several, leave that ad out, say so in the sheet's first
line, and go on with the others. Reading again is paid too, and needs their
yes.

### 2. Read the choices

Free, and no yes: `exodus segment personas` (the saved personas; leave out
the ones marked `[archived]`) and `exodus primer show` (its MECHANISM
section; with no primer saved, say so once and offer only the member's own
words or none). The products came in step 1.

### 3. The sheet, once

Send this in one message, in this order, then stop and wait:

> I read your ad as <kind of ad>, <look>, <n> lines, about <s> s. The swipe
> makes that kind of ad. Say "show me" for the shot list and the script.
> One sheet, answer once (my picks are marked):
> 0. **Let it run** (I pick every row) or **I choose**.
> 1. **Persona** (noted; the video writer does not read it yet): <your three best fits, each with a short reason>, show all <N>, or none. Pick several for one video each.
> 2. **Mechanism** (noted; the video writer does not read it yet): <the primer's mechanisms>, your own words, or none.
> 3. **How close:** 1 Mirror, 2 Close, 3 Same beats, 4 Same arc, 5 Pattern only.
> 4. **Characters:** the tool picks them (your saved characters: not yet).
> 5. **Run:** one shot, or stop at the storyboard.
> 6. **Finish:** music on or off (captions, speed, cuts: not yet).
> **How many:** <n> videos = <a> ads × <p> personas:
> - Video 1: <ad> × <persona>
> - Video 2: <ad> × <persona>
> **Cost:** the CLI prints no price for a swipe.
> **My picks:** <one line, with the reason>. **It buys:** <n> scripts and <n>
> whole videos, on your keys. Say go, or change a row. (Above 6 videos, end
> with "Say yes to <n> videos, or change a row." instead.)

**The yes covers only the list the member last saw.** Before any write or
start, the member has seen the list and the count, and said yes to them.
This holds also when their first message says "just do it" or "let it run":
"Let it run" fills the rows with your picks, and the yes still comes from
the member.

- A reply that makes the buy bigger is not the yes, even with "go" in it:
  more videos, another ad, music on where the sheet said off, or "one shot"
  where the sheet said "stop at the storyboard". Send the new list and count,
  and wait.
- A reply that changes a row without making the buy bigger, together with
  "go", is the yes: how close, music off, or leaving out videos it names
  ("drop video 3, go"). Say the change in one line and start. "Fewer" with
  no say in which ones is not the yes: send the shorter list and wait.
- Anything else is not the yes: a question, "show me", "maybe", "looks
  good?", or a reply you are not sure of. Answer it and wait. Above 6 videos,
  only a yes that names the count is the yes ("yes to 8 videos", "8, go"); a
  bare "go" or "yes" gets the count asked again.
- On a sheet of 1 video, "1: Anna, Ben and Cara. Go." is 3 videos: send the
  list of 3 and wait.

The rows:

- **The kind of ad.** The swipe writes the kind the template read and no
  other. When the member asks for another kind ("make it UGC instead"),
  leave this path for "From one sentence to a film", with the ad's words
  from `status --full`.
- **Persona.** Offer the three saved personas that fit the ad best, each with
  a short reason, then "show all <N>" (every persona not marked
  `[archived]`). Several may be picked: one video for each.
- **Persona and mechanism.** The video writer reads neither. When step 5's
  path is open, the text swipe bot writes them into each video's lines, and
  the rows say so (step 5). When it is closed, and for a video the bot does
  not write, they are noted, not read: in
  **My picks**, a persona or a mechanism always carries "(noted, not used
  yet)", the primer's lead mechanism included, and videos for two personas
  differ only as two writes of the same request differ. In that case, when
  more than one persona is picked, say this in your reply before the yes, so
  the member does not pay for several videos expecting a script for each
  persona. Two other ways make a persona real without step 5. The member
  writes their own script for that persona, and the write takes it with
  `--mode their-format --script <file>`, made the way their ad is made. Or
  the member swipes the words with the `swipe` skill and makes the film from
  one of our formats (its "Make it a video"). That path asks a yes before
  each paid step, and it makes the film in the format they pick, not in the
  ad's own kind and look.
- **Characters.** A swiped run takes no saved characters and draws no new
  faces yet, so the row offers only "the tool picks".
- **Run.** With "stop at the storyboard", the line reads **It buys:** <n>
  scripts, and <n> storyboards with their pictures; the voices and clips
  wait for your yes at each storyboard.
- **Finish.** `swipe start` takes `--music` and nothing else for the finish.
  Music is made on the member's own ElevenLabs key. Caption style, speed,
  jump cuts and the end card come with a later update.
- **How many.** Ads × personas, with none counting as one persona and the
  characters counting as one today. Show the multiplication, as in "4 videos
  = 2 ads × 2 personas". Above 6 videos, say the count and ask for the yes on
  that count in so many words: "That is 8 videos. Say yes to 8 videos."
- **Cost.** The CLI prints no price for a swipe, so the sheet says exactly
  that: no number, no range, no guess. The Director block of `exodus video
  status` prints "Spent: $… of $12.00": the $12.00 is the Director's limit
  for its redos on that video, not a price and not a ceiling for the first
  pass. Never quote it as the cost.
- **Product.** Add a row **Product:** only when `swipe products` lists more
  than one. With one, write for that one.
- **Anything else.** Add a row only when the member's ask carried a note. A
  note that names what to swipe (hook only, their format with their own
  script, a new look) sets `--mode` (step 4), and **My picks** says the mode
  back. Say back any other note as noted, not used yet.
- **Several ads.** One sheet covers every ad the member named: list what you
  read from each in the first line. The count and the warning above 6 hold.

**The videos, in a fixed order.** List them one per line: the ads in the
order the member gave them, and for each ad the personas in the order the
sheet shows them. The same picks give the same list.

**A bare number.** Read a reply of only a number ("3") as the count of
videos, and say so in the list's first line: "I read 3 as 3 videos." Pick
one video for each ad, in the order given, before a second persona for any
ad; then the next persona in the order shown for each ad, and so on, until
the count is reached. List the videos in the fixed order and wait for the
yes. When the picks cannot make that many, say how many they can make.

When the member says "just do it": no persona, the primer's lead mechanism
(noted, not used yet), closeness 2, the tool picks the characters, one shot,
no music. With more than one product and none named, ask that one row first.

### 4. On the yes

The yes covers the writes and the starts, and the bot calls when step 5
applies; nothing else. The breakdown and the template are once per ad, and
are done already. For each video, in the listed order, run steps 1 and 2;
step 3 comes once every video has started:

1. `exodus video swipe write <breakdownId> --product <id> --mode whole-ad
   --closeness <n> --yes`. A mode set from a note changes the line:
   `hook-only` takes `--closeness` as `whole-ad` does. `their-format` takes
   the member's own script: save it to a file and pass `--script <file>`,
   with no `--closeness` (the CLI refuses one). `new-look` takes `--look
   <slug>`; no command lists the looks a swipe can take, so ask the member
   for the exact look name and never invent one (the writer refuses a look
   it does not make). When step 5 applies, its write line takes the place of
   this one. The write takes four to nine minutes. Show the member the
   script, the direction, Kept and Changed, and what it cost. When a persona
   or a mechanism was picked and step 5 does not apply, add one line: "The
   persona and the mechanism are noted, not used: the video writer does not
   read them yet."
   The write's last line says "Start the video (paid; ask first)": the
   sheet's yes was that ask, so start now, with the line below, not the
   write's own, which leaves out `--one-shot`. Note the swipe id it printed
   for that video.
2. `exodus video swipe start <swipeId> --one-shot --yes`, without
   `--one-shot` when the member chose to stop at the storyboard, and with
   `--music` when they chose music. Give the member the `Watch it:` link at
   once. Then go on to the next video.
3. When every video has started, follow each run with `exodus video status
   <runId>` and do what it prints. A one-shot run that waits for a cut goes
   to "End: watch and approve" (pull, cut, upload, the run page). A run that
   stopped at the storyboard goes to stop 3, then the end.

**Never start the same swipe twice.** One swipe is one video. A start of a
swipe that already has a video is refused, starts nothing, and names the run:
follow that run with `exodus video status <runId>`. `--again` makes a second,
paid video from the same swipe: use it only when the member asks for a second
video. Before writing again after a write whose wait was cut off, run
`exodus video swipe list`. It lists the newest first, each with when it was
written and its product, and the writes run one at a time, so a row for that
ad and product above the last swipe id you noted (any row for it, when you
noted none), with no run and not marked refused, is that write. Show it with
`exodus video swipe show <swipeId>` and start it instead of writing again. A
row marked refused is that write's refusal: report it as a refused write. When
no such row is there yet, the write may still finish: check again later.

At the end, report each video on one line: its ad and persona, its run id
and its `Watch it:` link, or why it stopped.

**The final approve** is asked for each video as at "End: watch and
approve". It is one way. A redo of a clip there needs its own yes.

**A refusal or a failed check stops that video only.** The others go on, and
every video is in the report at the end. A refused write prints the writer's
sentence, its swipe id, what it cost, and "Nothing was started.": report all
of it for that video. Writing again is paid again and needs the member's
word. A refused start prints its sentence: report it for that video. A
one-shot run whose checks find a problem stops for the member: show what
`status` prints and ask.

### 5. With a persona or a mechanism: the text swipe bot

The video writer reads no persona and no mechanism. The `swipe` skill's bot
does: it writes the ad's lines again with them in, and the write then makes
those lines the way their ad is made.

**When the path is open.** Before the sheet, check these three, all free:

- `.claude/skills/genesis-bots/scripts/genesis-stream.mjs` is in the folder.
- `exodus keys status` (it prints key names, never values) shows
  `GENESIS_API_KEY`, and `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`, as
  "local ✓". When it cannot reach the dashboard, this does not hold.
- `grep -l '^GENESIS_BASE_URL=' .env .claude/skills/genesis-bots/.env`, run
  in the folder that holds `.claude/`, names at least one file. It prints
  file names only, never a value. The helper needs this address, and
  `exodus keys status` does not show it.

When one does not hold, the path is closed and everything stays as above:
the rows keep "(noted; the video writer does not read it yet)" and every
write is the one "On the yes" gives.

**Which videos take it.** With the path open, the bot writes a video's lines
when all three hold for that video, and "step 5 applies" means that video:

- The member picked a persona for it, or a mechanism. The primer's lead
  mechanism that "just do it" picks stays noted only.
- How close is 1, 2 or 3.
- The write would be `--mode whole-ad`. A note that sets `hook-only`,
  `their-format` or `new-look` keeps that write, and the persona and the
  mechanism stay noted only: the bot never takes the place of the member's
  own script.

Every other video is made as "On the yes" says, with the persona and the
mechanism noted only.

**On the sheet, when the path is open.**

- Rows 1 and 2 read "(used through the text swipe bot)" in place of
  "(noted; …)".
- Row 3 reads "1 Near-clone, 2 New scene, same beats, 3 Same idea, new
  drama, 4 Same arc, 5 Pattern only (with 4 or 5, the persona and the
  mechanism are only noted)". Levels 1 to 3 are the `swipe` skill's levels
  (its section 2), not the dial's: say so when the member asks. A video the
  bot does not write takes the same number as its `--closeness`.
- **It buys** adds, when the picks give the bot any video: "and a text swipe
  call for each video (two at level 2 or 3), on your own Genesis and model
  keys." When only some videos take it, name them ("for videos 1 and 3").
- A reply that adds bot calls makes the buy bigger, so it is not the yes: a
  persona or a mechanism added where the sheet had none, or, while a persona
  or a mechanism is picked, how close moved from 1 to 2 or 3, or from 4 or 5
  to 1, 2 or 3. A reply that moves how close to 4 or 5 while a persona or a
  mechanism is picked is not the yes either: say that they will then be only
  noted, and wait. One persona changed for another, with the same count, is
  not a bigger buy.

**For each video the bot writes, on the yes:**

1. The ad's lines: the Script part of `exodus video swipe status
   <breakdownId> --full` (free), with who says each line. Keep each video's
   files in a folder of its own, `swipes/<slug>/video-<n>/`, so no video
   reads another's lines, and save the options answer as `options.md`, apart
   from the lines.
2. The PRODUCT block, built as the `swipe` skill's section 3 says, with that
   video's persona and the mechanism. Begin it with the line `exodus video
   swipe products` prints for the product being written (its name and
   description).
3. The bot, called as the `swipe` skill's section 4 says, with LEVEL from
   row 3, one stream at a time, under that skill's "Security" rules. At level
   2 or 3 its options call comes first; its options are short scenes, one
   line each. The one round has no stop for the pick: take option 1 and send
   its full SCENE text, as section 4 says. Section 4's retries and section
   5's count and FIX call are each another paid call, and are not part of
   this path. Run the helper so the shell's own time limit cannot cut it off
   (a long timeout, or in the background), and wait for its "Done:" line or
   its error.
4. Save the bot's lines to a file, each line with its speaker label exactly
   as the bot wrote it ("Alex: …"). Drop blank lines, a line "---", and a
   first line that starts "Value mismatch —". When that first line comes,
   tell the member in one sentence: it says why the scene and the product do
   not fit, and may name a better level.
5. `exodus video swipe write <breakdownId> --product <id> --mode their-format --script <file> --yes`.
   No `--closeness`: the CLI refuses it with `their-format`, and the bot's
   LEVEL carried the closeness. The write keeps each line word for word, and
   its cast follows the file's speakers.
6. The check below, then the start, as "On the yes" does.

At level 2 the bot may give the lines to a new speaker named after the
persona, in place of the ad's own; the cast follows the script. Say so in
one line of the report for that video. For an ad with one speaker it still
wrote one speaker, even when its options had several people in them.

**The check is yours.** The write keeps the script's lines as they are and
checks none of their claims, so after each write and before its start, read
every line of the script it prints, and its Direction, against (1) that
video's persona, when one was picked, (2) the mechanism, when one was
picked, and (3) the product's own facts. The facts are only these: the line
`exodus video swipe products` prints for that product, and the product
facts in the PRODUCT block you sent for that video. Never the ad's own
claims (they were made for another product), and never the bot's. A picked
mechanism's own words count as a fact for a line that says only what they
say; a result beyond them needs a product fact.

- The persona is in when the lines speak as that person or to them (their
  situation, what they want). The mechanism is in when the lines name it or
  explain it.
- A line holds only when one of those facts says the same thing. A line that
  goes further does not hold: a result the facts do not name, a bigger
  number, a shorter time, "cures" where the facts say "helps". When you are
  not sure, it does not hold.
- Each of these needs a fact that says it: a health or body result (sleep,
  pain, weight, energy, skin, treating or curing anything), a money result
  (earning, saving), a guarantee or a refund, any number (a percent, a time,
  a count, a price, a rating, how many customers), and a named result (a
  named person's result, a review, a doctor or an expert, a study, an award,
  "the #1").

When a picked persona or mechanism is missing, or a line promises something
the product's facts do not hold (a result, a health benefit, a number), do
not start that video: show the member that line and ask. The other videos go
on. Show each such line with the fact it would need, and offer three ways
on: start it as written, leave that video out, or the member's own words for
those lines, written again with `--mode their-format --script <file>` (a
second paid write, on their word) and checked again. This is the one stop
this path adds, and it comes only when the check finds something. The write
may still refuse a name, price or code from their ad, or a cast the kind of
ad cannot take (more speakers than it holds, or speakers where it takes a
narrator only): a refused write stops that video only, as above. A write
whose wait was cut off and is found again with `exodus video swipe show
<swipeId>` (as "On the yes" says) gets this check too, on the script `show`
prints, before its start.

**Run so far.** Levels 1 and 2 of this path have been run for real, as far
as the write. Level 3 has not.

**A bot call that fails** (the helper prints an error, or "stream completed
but produced no content") stops that video only. Report it. Calling the bot
again is paid again and needs the member's word, even when the helper's own
error says "retry". Never use the partial lines a failed call leaves in its
file. These count as failed calls too: a "Done:" line with
`finish_reason=length`, which means the lines were cut short; an answer with
no speaker lines in it; and a call the shell cut off before "Done:" or an
error, which may have been paid all the same.

Some failures stop every video the same way. The helper stops before it
sends anything, and charges nothing, with "ERROR: GENESIS_BASE_URL is not
set", "ERROR: GENESIS_API_KEY is not set" or "ERROR: no provider key found".
A wrong model key prints `ERROR: provider_error: 401 …` and charges nothing.
A Genesis key it refuses, a limit reached or a server fault prints `ERROR:
HTTP 401`, `HTTP 429` or `HTTP 5…`. On one of these, make no further bot
call. Tell the member what went wrong, and ask whether to fix it and go on,
or to make the rest as "On the yes" says, with the persona and the mechanism
noted only.

### Step by step: a yes before each paid step

For a member who asks for stops. Four steps cost money, and the CLI prints no
price for any of them. Run each one first without `--yes`: it sends nothing
and prints what the step buys and who pays. Tell the member both, say the CLI
prints no price, never guess one, and run the same line with `--yes` only
after their yes.

1. **Get the ad.** One of a video file, a link (Meta Ad Library, TikTok,
   Instagram or YouTube), or a video ad in the brand's swipe library by the
   id that `exodus video swipe find` prints (free):
   `exodus video swipe --file <ad.mp4> | --url <link> | --ad <swipeAdId>`.
   The breakdown is paid on the team's keys, not the member's. A link or an
   ad this brand broke down before comes back at once and costs nothing.
   With `--wait` it prints each step as it starts, and takes a few minutes.
   Once it is done, `exodus video swipe status <breakdownId> --full` prints
   what Exodus read from the ad: each shot with its cut times, a-roll or
   cutaway, framing, camera and description, then the script with who says
   each line, then the cast. It is free. Show the member the shot list and
   the script before the template, so they can say whether Exodus read their
   ad right.
2. **The template.** `exodus video swipe template <breakdownId>`, paid on the
   member's own Anthropic or OpenRouter key. It prints the kind of ad and the
   look the ad matched, and why. A template made before costs nothing. Show
   the member the kind and the look. The swipe writes that kind and no other.
   If the member wants another kind, stop here and make the video from that
   format with the ad's words instead ("From one sentence to a film").
3. **The choices.** `exodus video swipe products` lists the brand's
   products. Ask which product, what to swipe and how close. What to swipe
   (`--mode`, `whole-ad` if left off): Whole ad, Hook only, Their format, my
   script (`--script <file>`, the member's own words), or Their script, a new
   look (`--look <slug>`). How close (`--closeness`, 2 if left off): 1 Mirror,
   2 Close, 3 Same beats, 4 Same arc, 5 Pattern only. `exodus video --help`
   has each one's line.
4. **The write.** `exodus video swipe write <breakdownId> --product <id>
   [--mode …] [--closeness …]`, paid on the member's own key. It takes four
   to nine minutes and waits by itself. Show the member the script, the
   direction, Kept and Changed, and what it cost. A refusal prints the
   writer's sentence and "Nothing was started.": tell the member, and offer to
   write again, which is paid too. If the wait gives up, the write may still
   finish: run `exodus video swipe list` before writing again. It shows the
   brand's newest swipes, and a refused one is marked with what it cost.
5. **The start.** `exodus video swipe start <swipeId>`. It buys the
   storyboard and its pictures; the voices and clips wait for the storyboard's
   yes. `--style <look>` changes the look, `--music` adds a music bed.
   `--title "<name>"` names the ad, for admins only: a beta tester leaves it
   off, or the CLI refuses it with one sentence naming it. With `--one-shot`
   it buys the whole video with no stop: ask before passing it. `--wait` waits until the run needs the
   member. A swipe that already has a video is refused, with its run; a
   second video from it needs `--again` and the member's yes to a second video.
6. **Then** stop 3 (the storyboard) and the end, as above.

### Every swipe command

```operator-guide
exodus video swipe --file <ad.mp4> | --url <link> | --ad <swipeAdId> [--yes] [--wait]
                                                          break the ad down (team's keys); one read before costs nothing
exodus video swipe status <breakdownId> [--wait] [--full] where the breakdown stands, step by step;
                                                          --full adds what it read: shots, script, cast
exodus video swipe template <breakdownId> [--yes]         the kind of ad and look it matched (member's key)
exodus video swipe products                               the brand's products and their ids
exodus video swipe write <breakdownId> --product <id> [--mode <mode>] [--closeness <step>] [--look <slug>] [--script <file>] [--yes]
                                                          the brand's version (member's key); waits for it
exodus video swipe show <swipeId>                         one swipe again
exodus video swipe list                                   the brand's newest swipes, each with when it was written and its product;
                                                          a refused one shows what it cost
exodus video swipe find [--brand "<name>"] [--limit <n>]  video ads in the swipe library to offer as options (free); no kind, no results
exodus video swipe start <swipeId> [--style <look>] [--title "<name>"] [--music] [--one-shot] [--again] [--yes] [--wait]
                                                          start the run on the kind the swipe wrote; --again for a
                                                          second, paid video of a swipe that already has one
exodus video swipe run --sheet <file> [--status] [--persona <name>] [--yes] [--retry-refused] [--wait]   every video of a sheet saved as a JSON file
```

## Before anything

- `npx @aicopycoders/exodus video --help` and `workflow --help` are the
  authoritative flag lists. The `video` verb is hidden from the top-level
  `--help` because most members can't use it; that is expected, not a broken
  install.
- **Who can use video.** Admins get everything in this file. A beta tester
  (video switched on for their dashboard user) gets a smaller set on their own
  brands, listed under "Beta testers" below. Two refusals:
  - "video isn't enabled for this key", from a `video` verb, has three causes
    the CLI cannot tell apart: the run id does not exist on this brand, the
    command is admin-only, or video isn't switched on for this user. Check the
    id first, then check the command against "Beta testers".
  - "Video workflows aren't available on your account. Ask an admin if you need
    video.", from `workflow run`, is unambiguous. `startRun` refuses any graph
    containing a video node for a non-admin, beta testers included. A beta
    tester starts with `exodus video start` instead.

  No flag or retry fixes either one.

## Beta testers

A beta tester's key gets the same video the dashboard's Video page makes, and
never how it is made. Every answer to them says `"view": "customer"`, and the
CLI words it the way the run page does. On their own brands they can:

- `video start --script <file> --conceit <key> --style <slug>` with
  `--direction`, `--frame`, `--pacing`, `--music`, `--one-shot`, `--review-storyboard`, `--stop-at-script`, `--rewrite-to-fit` and `--wait`. Any other start
  flag is refused with one sentence naming it. The answer is the run id and the
  link to the video's page, plus what the server did to the script: laid a
  plain transcript out, or wrote a script from a description (see "The script
  file"). `--stop-at-script` prints that script and starts nothing.
- `video status <runId>`: where the video is, in plain words (waiting in line,
  planning, drawing, storyboard ready for review, filming, ready with its link,
  held for a scene they must make again or keep as it is on the video's page,
  or stopped and why). `--json` prints the server's answer as it came; a held
  video says `"stage": "failed"` with the held scenes in `cutHolds`.
- `video storyboard <runId>`: each scene's line and picture, while the
  storyboard waits for review.
- `video approve <runId>`: approves the storyboard. At an audition stop,
  `video approve <runId> --audition <digest>` accepts the audition clips, and
  plain `video approve <runId>` pays for another try of the failed audition
  takes ("The audition stop"). Nothing else.
- `video voices <runId>`: who speaks, their current voice, and the voices on
  the tester's own ElevenLabs account. `--set <character>=<voiceId>` picks one,
  until the storyboard is approved.
- `video retry-frame <runId> --scene <n>`: redraws one scene's picture while
  the storyboard waits. No `--node`; the server finds the step.
- `video pull <runId> --out <dir>`: the finished video (`video.<ext>`), each
  scene's clip (`scene-NN.<ext>`) and voice (`scene-NN.voice.<ext>`), and the
  music (`music.<ext>`), with a `manifest.json` holding only `runId`,
  `pulledAt`, `dashboardUrl`, `scenes` (`index`, `clip`, `voice`), `music` and
  `video`. A file that did not download is `null` there. Nothing else in "The
  handover" below applies to them.
- `video upload <runId> --file <cut>`: attaches their cut and prints the page
  to watch it on.
- `video swipe`: all of "Swiping a video ad" except `swipe start --title`,
  which is refused with one sentence naming it. The run it starts answers the
  way start's does.

Admin-only, answered "video isn't enabled for this key" (or, for retry-clip and
revoice, a sentence saying they are for admins): `director`,
`status --rejected-draft`, `retry-clip`, `revoice`, `broll`, and the start flags
`--video-model`, `--voice`, `--voice-path` and `--director`.
`--broll` works for whoever B-roll is switched on for, beta testers included,
but nothing open to them changes the shots the app plans (see "B-roll").
- Other failures: `npx @aicopycoders/exodus doctor` first, then follow what it prints.
- `ffprobe` on the PATH lets `upload` read the cut's length by itself. Without
  it, `upload` falls back to parsing an MP4's own header, and for anything else
  you must pass `--duration <sec>`. Editing tools have their own requirements on
  top of that — the bundled script needs a full `ffmpeg` with `libx264` and
  exits 2 if it is missing.
- The brand matters. A workflow belongs to one brand, so `exodus workflow list`
  shows the active brand's only. Wrong list means wrong brand; `exodus brand use
  <slug>`.

## The loop

Run each line as `npx @aicopycoders/exodus …`; `exodus` below is shorthand.

**Starting a run.** The workflow is already saved in the brand — find it and
read what it wants before you run it, because the script's input field is named
by the workflow, not by this skill.

```operator-guide
exodus workflow list                                      the brand's workflows
exodus workflow describe <workflowId|name>                what inputs it needs
exodus workflow run <workflowId|name> --input <field>=@script.txt --wait
                                                          start, stop at the storyboard gate
exodus workflow run <workflowId|name> --input <field>=@script.txt --voices @voices.json --wait
                                                          same, with the brand's voices already chosen
exodus workflow run <workflowId|name> --input <field>=@script.txt --voice-treatment @voice-treatment.json --wait
                                                          same, with the video model speaking voices you WROTE
exodus video status <runId>                               where it is, per scene
exodus video start --script <file> --conceit <kind> --style <look> [--direction "…"] [--frame pov] [--pacing <jump-cuts|long-take|montage>] [--voice-path <path>] [--video-model <id>] [--voice native] [--music] [--broll] [--one-shot] [--director] [--stop-at-script] [--rewrite-to-fit] [--wait]
                                                          start from a script and the kinds the server offers.
                                                          The file can be a plain transcript, a draft or a
                                                          description: the server tidies it (see "The script
                                                          file"). --stop-at-script prints the tidied or
                                                          written script and starts nothing.
                                                          No music bed unless you pass --music.
                                                          --broll cuts away to B-roll shots, for
                                                          accounts with B-roll switched on. At the
                                                          storyboard, `video broll` adds, moves or
                                                          removes a shot (see "Reading the storyboard
                                                          gate").
                                                          --frame pov (conversation conceits) and --pacing
                                                          (presenter conceits) change the shots; a conceit
                                                          that can't follow one refuses it.
                                                          It stops at the storyboard for the user's yes
                                                          (Guided, the default). --one-shot makes the
                                                          whole video: the app approves its own storyboard
                                                          when its checks pass and goes straight on to the
                                                          clips, which is the part that costs. It stops
                                                          then only when a check finds a problem, and says
                                                          why. --review-storyboard is the default and
                                                          changes nothing.
                                                          Each conceit has its own video model and voice;
                                                          --video-model / --voice override them for one run.
                                                          --director turns the trial director on (admins only)
exodus video director <runId> on|off|follow               the trial director for one run (admins only);
                                                          follow = the brand's own setting. status shows
                                                          what it is doing and its last three notes
```

**Starting from a template.** The Golden Six start here; "From one sentence to
a film" walks them. Each paid template phase, the script and then the
storyboard, is quoted first: run the line with `--quote-preparation --json`,
give the member `maximumUsd`, and run it again with `--authorize-preparation
<saved-quote.json>` in its place only on their yes. A template line with
neither is refused, and nothing is spent. The template flags, as `exodus video
--help` prints them:

```operator-guide
  exodus video start --script <file> --conceit <kind> --style <look> [--direction "<note>"] [--frame pov] [--pacing <jump-cuts|long-take|montage>] [--voice-path <path>] [--video-model <id>] [--voice <native|voice-first>] [--source-record <file.json>] [--adaptation-plan <file|original>] [--music] [--broll] [--one-shot] [--director] [--wait] [--json]
    Template starts also accept: [--requested-seconds <seconds>] [--pictures-per-scene <1|3>] [--product <brandProductId>] [--elements <json|@file>] [--voices <json|@file>] [--resume-script <saved-stop-response.json>]
    With --describe: [--product-context <text>] [--audience <text>] [--offer <text>] [--mechanism <text>]
  exodus video start --input-options [--conceit <template>] [--voice <native|voice-first>] [--voice-path <path>] [--video-model <id>] [--json]

  --describe          Template: explicitly write from the brief in --script.
                       Review the returned script before preparing a storyboard.
                       Cannot be combined with --adapt or --resume-script
  --adapt <intent>    Template: adapt the exact pasted text in --script to the
                       selected structure. State what may change; no new claims,
                       identities or consent are inferred. Review original and
                       changed text before continuing. Not --adaptation-plan
  --keep-original     With --adapt, intentionally review the exact original
                       instead of generating changes. Guards and billable checks
                       still require a quote; no adaptation is claimed
  --quote-preparation  Request only the current script or storyboard phase quote.
                       No writer/audio/image/video work. Save --json and review
                       estimatedUsd (approximate), maximumUsd (phase bound), scope
                       and expiry; this is not a whole-video price
  --authorize-preparation <saved-quote.json>
                       Explicitly accept that quote's maximumUsd for its exact
                       phase/input. Never upgrades input Automatic to paid consent.
                       Keep the same file for recovery; no silent new quote/retry
  --stop-at-script     Print the script the run would start on, and start no
                       storyboard/video run (start, with --conceit). Preparation
                       may still be paid. For templates, use
                       --json to save the approval, source and choices; edit only
                       a separate script file, then continue with --resume-script
  --resume-script <saved-stop-response.json>
                       Continue a template's saved --stop-at-script --json
                       response with --script <edited.txt>, --conceit and
                       --style. Keep the server-issued approval, approved source,
                       brief, product, selected video model, signed references and voice map.
                       V2 also retains input intent/subject/structure/reference,
                       direction, sound/story choices and declared source/adaptation
                       records; material edits need a new quoted script review.
                       Explicit length, picture, --voice, --voice-path and
                       --video-model flags override their matching saved choices.
                       Changed or cleared --elements and --voices require
                       explicit --stop-at-script --json with
                       --resume-script to check the edited script and issue a new
                       approval; then resume that returned response to start.
                       Keep your original description and edited script files.
                       A different product still needs fresh writing and approval
                       without --resume-script.
                       Not for --show
  --renew-script-approval
                       Optional. Every --resume-script --stop-at-script review
                       already re-checks the --script edits against the saved
                       source and issues a new 24-hour approval, also when the
                       saved one expired; it never writes a fresh script. This
                       flag sends nothing extra: it only refuses the line
                       without --resume-script --stop-at-script, or with
                       --rewrite-to-fit or --show
  --input-options     List your templates: Golden Six first, then more templates.
                       Add --conceit <template> for structures, capabilities,
                       identity locks, references and account voices.
                       GET only: writes, quotes and starts nothing. Optional
                       --voice, --voice-path and --video-model require --conceit.
                       Reports unsupported, unavailable and empty separately;
                       use the returned IDs with --elements and --voices
```

The other template flags (`--input-mode`, `--structure`, `--reference`,
`--subject`, `--template-brief`, `--song-controls`, `--mechanism-plan`,
`--source-record`, `--adaptation-plan`,
`--requested-seconds`, `--pictures-per-scene`, `--product`, `--elements`,
`--voices`) are in `exodus video --help`.

**From the storyboard on.**

```operator-guide
exodus video picks <runId>                                a format with a picks stop parks before the storyboard:
                                                          the faces, voices and rooms it drew, one link each
exodus video pick <runId> --face <who>=<n> --voice <who>=<n> --room <place>=<n>
                                                          pick one of each; nothing is planned until every slot has one
exodus video picks <runId> --redo face:<who>|room:<place> --note "…"
                                                          four new paid pictures for one face or room;
                                                          only after the member's yes
exodus video storyboard <runId>                           read the scene cards
exodus video map <runId> [--place <place>]                Micro-drama template (admin-only): each room in metres,
                                                          each person's mark and the setups that film it
exodus video move <runId> --move <who>=<x>,<y> [--place <place>] [--note "…"]
                                                          move people in one room; redraws that room's pictures,
                                                          one a camera setup; only after the member's yes;
                                                          approve only once they are redrawn
exodus video voices <runId>                               who speaks and with whose voice
exodus video voices <runId> --set <character>=<voiceId>   give a character a voice
exodus video quote <runId>                                a quoting format: the exact prepared requests and prices
                                                          before any clip; approve them with --request-quote <reviewSha256>
exodus video approve <runId>                              keep going
exodus video song <runId>                                 a song-first run: the Song master to listen to
exodus video song approve <runId> --master <sha256>       approve the master you listened to
exodus video song import <runId> --file <audio> --lyric <text|@file> --rights "…" [--from <s> --to <s>]
                                                          use the member's own recording as the Song
exodus video retry-frame <runId> --node <nodeId> --scene <n>  redo one still at the pixel gate
                                                          (a beta tester leaves --node off)
exodus video broll <runId>                                B-roll run: the shots, and the script lines by id
exodus video broll add <runId> --line <id> [--note "…"]   plan a new B-roll shot on that line
exodus video broll move <runId> --scene <n> --line <id> [--note "…"]
                                                          move B-roll scene n to another line
exodus video broll remove <runId> --scene <n>             take B-roll scene n out
exodus video status <runId>                               where it is, per scene
exodus video pull <runId> --out ./ad-<runId>              every piece + manifest.json
exodus video retry-clip <runId> --scene <n> [--node <nodeId>] [--note "…"] [--voice-first]
                                                          redo one clip at the final watch
exodus video revoice <runId> --all | --scene <n>          redo only the voice; no new video
                                                          … make the cut (your choice of tool)
exodus video upload <runId> --file ./ad-<runId>/cut.mp4   attach it
exodus video review <runId> --file ./ad-<runId>/cut.mp4 --accept | --reject
                                                          a final-review format: YOUR review of that exact final cut
exodus video approve <runId>                              make it the ad
```

Every command takes `--json`. Read `--json` when you need to decide something
from the output; read the plain form when you are relaying it to the user.

**Read a run's position with `exodus video status`.** It is the richest reader —
every scene's clip, voice and picture, with the findings. A `--wait` that landed
already printed the same stop block, and `workflow inbox` lists a parked video
run, but neither shows the per-scene detail, and the checkpoint verbs cannot
resolve a video park — see "What the CLI can and cannot do".

**Where a run can stop.** The two video parks come in order when the run has
both. The storyboard gate is first. You read the cards there and you set the
voices there. Approving that gate releases the voices and the clips. That is the
expensive part. The final watch is next, after the pieces exist, and only when
the video node sets `finalWatch: true`. That park is for the cut. You pull, you
cut, and you upload. Approving the upload makes it the ad. A node with
`finalWatch` off skips the second park and the run finishes.

Five stops, each with the exact next command printed
under it:

- storyboard gate: needs `approve`. When the stop block prints a `Redo one
  frame:` line with a node id, one still can be redone first with `retry-frame`;
  a gate parked before the stills are drawn has nothing to redraw. When the run
  has B-roll (`storyboard` ends with a `change the B-roll shots:` line), offer
  to add a shot on a line with a note, move one, or remove one with `video
  broll`. Each change redraws only the pictures it changes, so wait for it to
  finish before you approve.
- final watch: every piece is made; needs `pull`, a cut, and `upload`. Once a
  cut is uploaded the stop block leads with `approve` instead, and `status
  --json` says which state it is in (`stop.cutAttached`, plus the same next-step
  lines under `guidance`). It is also
  the one park where a finished clip can be redone, with `retry-clip`. A run
  only reaches this park if its video node sets `finalWatch: true` — otherwise
  it skips straight to finished. If a scene has no clip, the stop block names
  it instead (`stop.missingScenes` in `--json`) and approval is refused until
  it has one. A scene whose picture the video service refused needs
  `retry-frame --note` before `retry-clip`; the clip redo alone resends the
  refused picture. On a video started from the dashboard, the app makes the
  cut itself; when a scene's clip still has a drawing fault after it was made
  again, the stop block says `Held:` and names the scene
  (`stop.heldScenes` in `--json`). No cut is made until each held scene is
  made again with `retry-clip`, or kept as it is on the video's page (the
  link it prints). Keeping the last one starts the cut.
- paused: a builder checkpoint neither video verb resolves —
  `exodus workflow checkpoint <runId>` is the verb for that one.
- failed: `status` shows how far it got, and a `--wait` that was running exits
  1 with the error. Tell the user; do not start another run on your own.
  When the storyboard is the step that failed, `status` adds a "What happened
  to the storyboard" block: which parts of the plan were accepted, which part
  was turned down, and why (#1902). Relay it as written. On an admin key it may
  also offer `status <runId> --rejected-draft`. That prints the draft the system
  threw away. It is a record only: never build on it, edit it, or re-run it.
- finished: pull what it made.

**`--wait` stops at both video parks** (#1818). `workflow run --wait` ends at
the storyboard gate and again at the final watch, exits 0, and closes with the
same `Parked:` block and next commands that `exodus video status` prints. Under
`--json` the line carries an
additive `stop` field in the same shape `video status --json` uses, so branch on
`stop.at` rather than re-deriving the park. Every other park still prints its
notice once and keeps polling, so a resolve from another shell carries the run
on — a Checkpoint park is `exodus workflow checkpoint <runId>`, not a video verb.

`exodus video status` prints these stop lines any time, so an agent that lost a
`--wait` terminal picks up from `status` alone. `--wait` gives up after 60
minutes with "Still running after 60 minutes" and exit 0; that is not done, so
check `status` before treating it as finished. Do not poll `status` in a tight
loop; a full run is several minutes.

**What costs money.** Every run writes the storyboard first and then draws the
reference, cast and scene pictures. Each picture is a few cents and each scene
draws a few to choose from: about 25 cents on a small test, and it can approach
a dollar on a longer ad. The expensive part comes after the storyboard: the
voices and the clips. What happens at that point depends on how the run
started.

- A paste-a-script run (`exodus video start --conceit …`) stops at the
  storyboard for the user's yes by default (Guided). Started with
  `--one-shot`, it checks its own storyboard once the pictures are drawn. When
  every check passes, the app approves the storyboard itself and goes straight
  on to the voices and the clips, with no stop. It stops for the user only when
  a check finds a problem, and the stop block says why in plain words. Ask the
  user before passing `--one-shot`: it spends the whole video in one go.
  `status` prints "the app checks the storyboard and approves it itself if the
  checks pass" on a run headed that way. `--review-storyboard` is the default
  and changes nothing.
- A template run (the Golden Six, "From one sentence to a film") quotes the
  script and the storyboard before it spends (`--quote-preparation`, then
  `--authorize-preparation`), and always stops at the storyboard. `--one-shot`
  is refused on a template start, and nothing is sent.
- A Show run (`video start --show`) and a saved workflow run (`workflow run`)
  still pause at the storyboard for approval. Approving is what releases the
  voices and the clips. `status` prints "This run will pause for your approval
  once the frames are ready" on a run headed for that pause.

Either way, a run still drawing pictures is healthy and already spending a
little. Do not cancel it because nothing has happened yet. `workflow list`,
`workflow describe`, `video status`, `storyboard` and `pull` are free reads; run
them as often as you like. Never start a second run to "retry" without the user
asking; tell them what failed instead.

**`--auto-approve` does not cover either video gate.** It releases Checkpoint
boxes only (`convex/workflows.ts:7266` keys on `pauseReason === "checkpoint"`),
and the storyboard gate and the final watch carry no pause reason. An unattended
`workflow run --auto-approve` still stops dead at the storyboard gate — which is the
safe behaviour, since nothing should approve paid rendering or ship an uncut ad
on its own.

## What the CLI can and cannot do

Verified against the CLI and the server, not assumed. Everything here is
about the admin tools; a beta tester has only what "Beta testers" lists. Five
things worth knowing before you promise a user anything:

- **A workflow only stops for your cut if its video node asks to.** `finalWatch`
  defaults to `false` (`convex/lib/workflow/catalog.ts:780`), and the run only
  parks for a final watch when it is `true`. Without it the run renders every
  piece and runs straight to the end, and `video upload` answers "This ad isn't
  waiting for your final cut right now." You can still `pull` the pieces and cut
  them, but there is nothing to attach the cut to. **Check this before you
  promise a user an upload**, with `exodus workflow export <workflowId|name>`:
  the export carries every node's `config` verbatim, so look for the `video`
  node and a `finalWatch: true` under it. The key is optional, so *absent* means
  off just as much as `false` does. `exodus workflow describe` does NOT answer
  this — it returns only name, inputs, prerequisites and outputs, no node
  config. If `finalWatch` is off the workflow needs editing (`exodus-workflow`);
  no flag on `workflow run` turns it on.
- **`exodus video approve` is the verb at a video gate, not the checkpoint
  cluster.** `workflow checkpoint approve|edit|retry` preflight on
  `pauseReason === "checkpoint"` (`exodus/commands/workflow.ts:4487-4519`), and
  both video gates park with no pause reason at all, so those verbs refuse
  client-side with "Run … is not parked for a checkpoint approval — it is parked
  at the cost gate (legacy)." `exodus video approve` posts straight through.
  `exodus workflow cancel` also works at a video gate; it has no preflight.

- **Nothing sends the storyboard back with a note.** There is **no** CLI path
  that returns a run's storyboard for a rewrite, and none that rewrites its
  scenes, script or prompts — the whole-envelope edit mutation is wired only to
  the dashboard's gate screen, not to any API route. The one exception is
  voices: `exodus video voices --set` writes the cast's voice choices in place
  and nothing else (see "Giving the characters voices"). A single still can be
  redrawn with `exodus video retry-frame`. For everything else the storyboard is
  approve-or-cancel from the terminal: `exodus workflow cancel <runId>` and run
  again with a better script, or edit the workflow.
  The stop block a parked run prints may still offer a `Send back:` line. A
  workflow ad refuses it, so never run it and never offer it to the user.
- **`--wait` lands on both video parks, but only those.** Since #1818 every
  `--wait` caller — `workflow run`, `triggers fire`, `checkpoint approve|retry`,
  `repair retry|skip` — ends at a storyboard gate or a final watch, exits 0, and
  prints the same `Parked:` block `video status` does
  (`videoParkStop`, `exodus/commands/workflow.ts`). A Checkpoint, repair or
  slots park is still not a landing: it prints its notice once and the loop
  keeps polling, so a resolve from another shell carries the run on. Do not read
  a park banner mid-poll as the wait having finished.
- **Every link the CLI prints follows the run.** A run opens on
  `/workflows/<workflowId>/runs/<runId>`. Since #1851 the manifest's
  `dashboardUrl`, the link in every park block and the link `upload` prints are
  all minted that way, so they agree. When all the CLI holds is a run id it
  mints `/runs/<runId>`, the canonical forwarder, which lands on the same page.

## The script file

**Pass the user's text as it is.** `exodus video start --script <file> --conceit …`
takes whatever the user gave you: a plain transcript, a rough draft, lines with
no names, voice-over labels, a title line, notes, a colon inside a spoken line,
or just a description of the ad they want. Save it to a file unchanged and start.
Do not add `CAST:`, `CTA:` or `NAME:` labels by hand, and do not rewrite it into
the format below first. The server tidies it the same way the dashboard does
when a person pastes a script, and it never changes a spoken word.

What the CLI prints, and what you tell the user:

- **Already in the format:** it starts as it is. No AI call, nothing printed
  about the script.
- **Laid out:** "We laid your script out in the format the video needs.", any
  speaker label it added (`SPEAKER`, `SPEAKER 1`), a short note on who each
  person is, and any line it left out as not part of the ad (a title, a stage
  note, a timestamp). The run has already started. Tell the user about a
  left-out line in one sentence. `--json` carries the same facts under
  `tidied` (`setAside`, `added.names`, `added.descriptions`).
- **Written from a description:** the file only described the ad, so the
  server wrote a script for it, printed it in full, and started the run on it.
  Show the user that script. `--json` carries it under `written`.
- **A question (`SCRIPT_QUESTION`, exit 1, nothing started):** the server
  can't tell who says a line. The error names the line, and `--json` lists them
  under `lines`. Ask the user who says it, put the name in front of that line
  (`SAM: …`), and run the same command again.
- **Too thin (`SCRIPT_TOO_THIN`, exit 1, nothing started):** the file only
  described the ad, and there wasn't enough in it to write a script from. The
  error says what is missing, in the dashboard's words ("There isn't enough
  here to write a script from. Tell us what the product is."), and `--json`
  lists the gaps under `missing` (`product`, `speaker`, `what-happens`). Ask
  the user for what it names, add it to the file, and run the same command
  again.
- **Today's refusal (exit 1, nothing started):** the user has no working AI
  key for the tidy, the AI call failed, or the server could not write a usable
  script from a description. The answer is the format's own message (for
  example "Line 1 has no speaker"). Ask the user for more detail about the ad,
  or for their AI key in Settings, or lay the file out in the format below
  yourself. A description
  that reports what someone says ("a guy says it stopped his crash") is
  sometimes refused this way (#3747): describe the ad without the reported
  words, or give the lines as a draft, and run it again.
- **The start refused the tidied script** (for example two speakers for a
  one-person kind of ad): the notes come first, then the refusal, and `--json`
  carries the tidied script under `script`. Fix that script and send it. It is
  already in the format, so it is not tidied or paid for again.
- **The script doesn't fit the kind of ad** (too many speakers, or a rule the
  kind of ad has): the refusal says `--rewrite-to-fit` can fix it, and
  `--json` carries `rewriteOffered: true`. Ask the user before you add the
  flag: the server then writes a new script for that kind of ad from theirs
  (the dashboard's "Rewrite to fit"), which can change every line and the
  names, starts the run on it, and prints it (`rewritten` in `--json`). Show
  the user that script. To let them read it first, add `--stop-at-script` too.
  If the rewrite can't be made, nothing starts and the error says why
  (`SCRIPT_NOT_REWRITTEN`). The other way out is a kind of ad made for the
  script's cast.

**`--stop-at-script`** prints the script the run would start on and starts
nothing (exit 0). A question or a description too thin to write from answers
as above instead (exit 1). Use it when the user wants to read a written or
laid-out script before anything is spent. To go ahead, save the printed script to a file
and run the same command with `--script <that file>` and without the flag.
`--json` answers `{ stoppedAtScript: true, script, tidied?, written? }`.

The tidy spends the user's own AI key, one short call. A Show run (`--show`)
is not tidied: a Show reads the script as written.

### The exact format (optional)

A file already in this format skips the tidy: no AI call. You never need to
write it, but use it when you are writing a script from scratch for the user,
or when the tidy can't run.

Plain text. An optional `DIRECTION:` block may open the file, before `CAST:` or
the first spoken line. Then a `CAST:` block naming the speakers, one line per
turn, then a `CTA:` block.

`DIRECTION:` carries whole-ad rules and no spoken words. The header is its own
line. The lines under it are the rules. The block ends at a blank line, at
`CAST:`, at `CTA:`, or at the first line that names a speaker. A second
`DIRECTION:` block is refused. So is a `DIRECTION:` after the first spoken line.
An empty block is refused too. The error code is `malformed-direction`.

Do not put a colon inside direction prose. The reader splits a line at its first
colon to find a speaker, so a colon in that prose is read as a name.

Right.

```
DIRECTION:
Nobody looks at the camera. The product stays on the table until the last line.
```

Wrong.

```
DIRECTION:
Rule: nobody looks at the camera.
```

The wrong line is not direction. `Rule` is read as the speaker, and the
block above it is empty, so the file is refused.

The planner sizes every line at 2.5 words per second (`WORD_LADDER_WPS`), so a
turn near 14 words plans a clip near 6 seconds. If a line does get truncated in
its clip, the manifest says so (`speech-cutoff`). That finding means the clip
cut the words off. Redo the clip. Do not speed the speech or cut it short to
hide the finding. The product rule is under "What the product actually
requires".

```
CAST:
THE EYES — a pair of tired cartoon eyeballs who stare at screens all day
THE SOFTGEL — a cheerful little capsule who knows how to fix that

THE EYES: Ten hours of screens today. Everything looks blurry and dry.
THE SOFTGEL: That's screen strain. Your eyes are begging for a break.

CTA:
THE SOFTGEL: Tap below and give your eyes ClearBlink.
```

The dash in a `CAST:` line is the parser's own separator. The example above
already shows that dash. A cast line may separate the name from the description
with an em dash, an en dash, or a hyphen with a space on each side. Keep that
dash on cast lines. A reader who strips it makes the line fail.

Do not use a long dash in words a character says, or in words shown on screen.
Synthesised speech reads a long dash oddly, and so does burned-in text. In the
exact format a spoken line is `NAME: what they say`; a file that is not in the
format is tidied into it.

### Directing a line

A spoken line can carry two kinds of note. Neither is required.

- **How the line is said goes in parentheses.** The voice acts it out.
- **What happens on camera goes in square brackets.** The storyboard plans the
  shot around it.

```
MIA: (whispering, excited) I can't believe this actually worked.
MIA: [holds the jar up to the camera] This is the one.
MIA: [leans in] (quietly) Don't tell my sister.
```

A note may sit anywhere on the line. It comes out of the spoken words, so the
voice never says it. Several notes of one kind on a line are joined. Notes work
on `CTA:` lines and on narrator lines too. They do not work on `CAST:` lines,
where anything in brackets is just part of the description.

How the voice uses a delivery note. By default a run records each line first,
on the Eleven v4 voices, which take the note as a short cue in front of the
line. The cue is the note's first clause, at most six words. A full stop,
colon, semicolon, question mark, exclamation mark, or a dash with a space on
each side ends the clause. A comma does not, so `whispering, excited` reaches
the voice whole. Keep the note short and put the part that matters first. Put
one delivery note on a line: two are joined with a semicolon, so the voice
hears only the first.

Right.

```
MIA: (whispering, excited) I can't believe this actually worked.
```

Wrong.

```
MIA: (She is whispering. She can barely contain how excited she is) I can't believe this actually worked.
```

The wrong note reaches the voice as `[she is whispering]`. The excitement is
lost.

In a narrated scene the whole narration is read as one part, so it takes one
cue: the note on the first narrator line in that scene.

What the reader refuses, with the code `malformed-direction`:

- an empty note, `()` or `[]`
- a square bracket that is never closed, or a stray `]`
- a line with no spoken words left once the notes come out

An unclosed `(` is not refused. It is read as ordinary words, and the voice
says it. Check every `(` has its `)`.

Both ways in read the notes the same way: `exodus video start --script` and
`exodus workflow run --input <field>=@script.txt`. Only `video start` tidies a
file that is not in the format; a workflow's Brief must already be in it. The second holds only when
the script goes straight from a Brief into the Storyboard. In a workflow where a
bot writes or rewrites the script first, the notes are not read this way, and
the bot may drop them or leave them in the spoken words.

With `--voice native` (admins only) the video model speaks the lines itself and
nothing is recorded first, so the six-word cue above does not apply.

**A line with no note still gets a natural read.** A note is the surest way to
get a particular delivery. The storyboard planner may add a note of its own to
a line you left plain. A note you wrote always wins over the planner's.

When you help the user write or tidy a script, suggest a delivery note where
the tone carries the ad: the hook, the turn, the CTA. Do not put a note on every
line. A note on every line reads as a script nobody trusted.

**How many speakers you may have depends on the rig.** Three by default. A rig
that carries saved format rules sets its own number: an ensemble rig seats more,
a talking-head rig seats one. Over the number, the launch refuses before
anything is spent and says both figures ("4 speakers — this format supports 3").
The rulebook the run followed is on the start receipt, on `workflow status`, and
in `manifest.json` under `provenance`.

## Reading the storyboard gate

`storyboard <runId>` prints one card per scene: who speaks, the
line, the planned duration, and whether its picture is drawn. Under the cards it
also lists the voices — one line per character who speaks or already has a voice
— so the user can see who sounds like whom before paying for the clips. Read it
for the user, then ask one question.

The question is approve or don't. If the storyboard is wrong, say so plainly and
let the user decide between approving anyway, redrawing a single still when
the stop block offers it (`exodus video retry-frame <runId> --node <nodeId>
--scene <n>`, with the node id that block prints), cancelling
(`exodus workflow cancel <runId>`) and re-running with a better script, or
changing the workflow. Approving is what releases the voices and the clips — the
expensive part — so do not approve a storyboard you have just told the user is
wrong.

**When the run has B-roll.** The storyboard ends with `change the B-roll shots:
exodus video broll <runId>`. Run that: it lists each B-roll shot (its scene
number, the line it sits on, the words it covers and its seconds) and every
script line with its id. Tell the user which lines have a shot, then offer three
changes:

- add a shot on a line, with a note on what it should show:
  `exodus video broll add <runId> --line <id> --note "what it shows"`
- move a shot to another line:
  `exodus video broll move <runId> --scene <n> --line <id>`, with an optional
  `--note`
- remove a shot: `exodus video broll remove <runId> --scene <n>`

An add or a move plans the shot on a worker, and then the storyboard pictures it
changes are redrawn. A remove saves at once, and the pictures it changes are
redrawn too. Every other picture comes back as it was. While a shot is being
planned, `video broll` says so and the server refuses another change. Run `video broll <runId>` again until it no longer says
it is planning, then read the storyboard again before you ask about approving.
If it says the last change didn't work, pass its sentence to the user as it
came. Do not approve while a shot is still being planned.

Do not approve on the user's behalf unless they told you to run the whole loop
unattended.

## B-roll

B-roll is a short shot the picture cuts away to while the speaker's voice keeps
going: the product, how it works inside the body, a result, a proof. Most top
ads use it. A run makes none unless it was started with `--broll`, and only an
account with B-roll switched on can pass it. The choice is fixed when the run
starts; it cannot be turned on afterwards.

**When to start with `--broll`.** Offer it whenever the script talks about
something a picture could show: the product, the mechanism, a before and after,
a number or a result. Leave it off when the user wants nothing but the person
talking. The app plans the shots and decides how many; it may plan few or none.
To direct the shots, start Guided (the default). `--one-shot` approves its own
storyboard, so nobody gets to change the B-roll.

**Reviewing and directing it.** At the storyboard gate, `video broll` lists the
shots and the lines, and adds, moves or removes one (see "Reading the
storyboard gate"). That is admin-only: a beta tester sees the shots in the
storyboard and can approve it, or stop the run on the video's page, but cannot
change them. A note on an add or a move says what the
shot should show, in one or two plain sentences ("close on the jar lid
twisting off", "the cream sinking into the skin, seen from inside"). Keep it
under 500 characters.

**The look.** A stylized ad (claymation, Pixar, anime, any animated style)
keeps its own look in every B-roll shot and goes closer or inside the body
instead. It changes look only when a note asks for a different one. A realistic, live-action ad may use any look a shot needs: a clean 3D
medical render, an animated diagram, a stock-footage look. Pass the user's
wish in the note; the app keeps or drops it by this rule.

**A shot that fails.** The app first tries a new idea for the shot, then a still
picture with a slow zoom. If both fail it leaves the shot out and the speaker
stays on screen. An admin's `pull` names those scenes and lists them under `dropped` in the
manifest. They have no clip, so cut with `--skip <those numbers>`.

## Giving the characters voices

By default a workflow run's characters have no voice of their own. A character
without one gets the run's default voice (the workflow's narrator voice) when the
run has one; with no default either, the clip keeps the voice the video model
invents. `exodus video voices` shows which of the three applies, and it is where you
fix the mapping. Fix it before you approve the storyboard gate. Approving that
gate locks the mapping, and `exodus video voices` refuses afterwards. On a
finished clip whose voice was never applied, the later command is `exodus video
revoice`, and that pass bills again. A clip that already went through the voice
pass is refused there. Use `retry-clip` for that one. See "Redoing only the
voice on finished clips".

```
exodus video voices <runId>
exodus video voices <runId> --json
exodus video voices <runId> --set C1=abc123voiceid --set "HOST 2=def456voiceid"
exodus video voices <runId> --from voices.json
exodus video voices <runId> --clear C2
```

Read it first. With no flags it prints one line per character: the character's
ID, the name the script uses, the voice chosen, whether ElevenLabs actually has
that voice on the user's account, and how many scenes that character speaks in.
Under it: how the voices get applied, who pays, and anything worth knowing before
approving.

Name a character either way. `C1` is the ID the planner handed out; `HOST 1` is
the name the script uses. Both work, and the name is the portable one — the same
voices file works on every run of that brand because the planner may hand out the
IDs differently each time.

**What `--set` changes.** The voice choices, and nothing else. The script, the
scene pictures and the run itself are left exactly as they were — no re-boarding,
no picture is redrawn, nothing is charged. A character whose voice was already
what you asked for reports "Nothing changed".

**What it refuses, and why nothing is written when it does.** A character name
nobody in the cast answers to, a voice ID with a space in it (people paste the
voice's *name* by mistake), and a voice ID ElevenLabs is certain it does not have
on that account. Each refusal says the plain reason and saves nothing. If
ElevenLabs simply cannot be reached, the choice IS saved and the output says the
check could not be made — a provider outage never blocks the run.

**Approving checks the voices one last time.** `video approve` re-checks every
chosen voice before the clips are paid for. If ElevenLabs is certain one of them
is gone — deleted from the account, or the account changed — the approve is
refused in one plain sentence, nothing is approved and the command exits 1. Fix
it by choosing another voice (`video voices <runId> --set <character>=<voiceId>`)
or clearing that character (`--clear <character>`, which lets the clip keep the
voice the video model makes), then approve again. When the approve goes through,
the receipt lists each speaking character and the voice they got, plus any
`Heads-up:` lines worth reading — that is the last moment a wrong voice is cheap
to fix.

**The voices file.** A plain JSON object, keyed by the names the script uses:

```json
{
  "HOST 1": { "voiceId": "abc123voiceid", "label": "First host" },
  "HOST 2": { "voiceId": "def456voiceid", "label": "Second host" }
}
```

A bare string works instead of the object when you do not care about the label
(`"HOST 1": "abc123voiceid"`), and `null` clears that character's voice. `--set`
and `--clear` win over the same name in the file, so one entry can be overridden
without editing it. Use the name the file uses: if the file says `HOST 2` and the
flag says `C2`, that is one character named two ways, and the whole request is
refused with a sentence saying so. Voice IDs belong to the user's own ElevenLabs account and to that brand's
folder — never put a brand's voice IDs in a shared workflow or template.

**One file, two moments.** A brand keeps a single `voices.json` in its own
folder. Hand it to the run at the start with `exodus workflow run <workflow>
--voices @voices.json` when the script is one the user supplied (it names its
speakers, so `HOST 1` means something before the planner has run), or hand it in
at the storyboard review with `exodus video voices <runId> --from voices.json`.
Launching with voices refuses before the run is created — nothing is spent — if
a speaker is not in the script, the same speaker is named twice, or ElevenLabs
is certain it does not have one of the voices; a workflow whose script is
written by a bot is refused with a pointer at the review-time command, because
nobody knows the speaker names yet. When the storyboard arrives, the voices are
already set and `exodus video voices <runId>` shows them.

**Choosing how the voices are made.** `--voice-treatment` on `workflow run` says
HOW a run makes its voices, and it is the only way. Two
kinds of answer.

A name on its own picks a way of working that plays a voice you already have,
and still pairs with `--voices`:

```
exodus workflow run "Podcast Ad" --input script=@script.txt \
  --voice-treatment lipsync-retarget --voices @voices.json
```

The other kind has the video model speak the CAST's lines itself, in voices you
WRITE. Those take a `voice-treatment.json`, which is the whole request body:

```json
{
  "path": "native-prompt",
  "describe": {
    "BUDGET": "Dry, tired middle-aged baritone. Slight rasp. Deadpan, unhurried.",
    "PIGGY BANK": "Bright quick alto, a little smug, crisp consonants."
  }
}
```

```
exodus workflow run "Podcast Ad" --input script=@script.txt \
  --voice-treatment @voice-treatment.json
```

Every speaker in the script needs a description. One left out gets a voice the
model invents afresh on every clip, and that drift only shows up once the clips
are paid for, so the launch refuses instead.

**The narration is not part of this.** A describing treatment changes how the
CAST's lines are voiced. A scene with narration (`voText`) is still recorded by
ElevenLabs on the member's own key by the Voiceover step, exactly as it always
was — so a run with `NARRATOR:` turns still needs an ElevenLabs key, and still
costs ElevenLabs money. `exodus video voices <runId>` says which of the two
shapes a run is, and only claims nothing is sent to ElevenLabs when nothing is.

**What refuses, all before the run is created, so nothing is spent.**

- A treatment name that does not exist. The message lists the ones that do.
- A describing treatment with a speaker undescribed, a speaker the script does
  not have, the same speaker described twice, or an empty description.
- Written voices plus `--voices`. The video model owns the voice on those runs,
  so the ElevenLabs voices would be paid for and never heard.
- Descriptions on a treatment that plays voices you picked instead.
- A workflow whose script is written by a bot. Nobody knows the speaker names
  yet, so there is nothing to describe.
- A workflow with no Video step, a Video step whose model cannot do what was
  asked, or a Video step with nothing wired into its voiceover port when the
  treatment needs one.
- No Google AI key on the account, for the treatment that renders through
  Google directly.
- A rig that shows every line on screen as text. No clip speaks, so there is no
  voice to treat.

**Still being tested.** Everything beyond the two shipped ways of working is
switched on only on the test stack while it is being tried out. On the live
stack those names refuse by name, and the message says which two to use
instead. That is a property of the stack, not of the workflow, so the same
saved workflow behaves differently on each — and a retry asks again rather than
copying, so a run retried after a treatment was switched off refuses.

**A sub-workflow chooses none of this.** When a Call box runs another workflow
inside this one, the child run carries no voice treatment: it renders the
shipped default, whatever the parent was started with. A treatment is a choice a
person made at a keyboard for one run, and nobody made it for the sub-workflow.

**Written voices cannot be changed at the review.** They are chosen when the run
starts. `exodus video voices <runId>` on a described run names the treatment and
prints each written voice, and says plainly that `--voice-treatment` at launch is
what changes them. Do not set a voice path in node config. Node config does
not set the treatment.

**Where it shows up afterwards.** The launch receipt and `exodus workflow status`
both print one line naming the treatment and the speakers who got a written
voice. `manifest.json` from `exodus video pull` carries the same under
`provenance.voice`, and each cast entry carries its `voiceDescription`.

**The JSON receipt** (`--json`), the same shape for reading and for setting:

```
ok                    true
runId
changed[]             the characters whose voice actually moved (set only)
canChange             false once the run has left the storyboard review
whyNot                why, in one sentence, when canChange is false
treatment.path        which way of making voices this run froze, or null
treatment.kind        "performance-then-conversion", "voiceover-then-lipsync" or
                      "render-owns-voice"
treatment.pinsHeard   true when the chosen ElevenLabs voices are heard on this
                      run; false only for "render-owns-voice"
cast[]                one per character
  characterId, name
  voice               { voiceId, label }: the voice this character's clips are
                      converted to. null only when they have no voice of their
                      own AND the run has no default voice
  voiceFrom           "own-pin" or "run-default"; absent when voice is null
  description         the WRITTEN voice, when the run was given one
  availability        { state: "available" | "missing" | "not-checked", … }
  spokenScenes        how many scenes this character speaks in
  spokenSeconds       those scenes' planned seconds — what ElevenLabs bills on
narrator              the one fallback voice, set on the workflow, not here
treatment             how the voices reach the clips: summary, provider, model,
                      speedChange, billedTo, estimatedCostUsd, costNote,
                      usage { clips, seconds }, keyOnRun
notices[]             plain sentences worth reading before approving
```

A failure is the same shape every `video` verb uses:
`{ "ok": false, "status": 400, "error": "<one plain sentence>" }`, exit 1.

**Before you approve, read `notices`.** The ones that cost the user something:
a character who speaks but has no voice of their own and no run default to fall
back on (those clips keep their generated voice), no ElevenLabs key saved on the run (no voice can be applied at all), and
a voice ElevenLabs no longer has.

`estimatedCostUsd` is always null. Exodus cannot price a voice conversion yet;
ElevenLabs bills the user's own account by audio length, and `usage` gives the
length. Do not invent a number.

## The handover: what `pull` gives you

`pull` writes a flat folder and a `manifest.json` that indexes it. The manifest
is the data you decide from; the filenames are its values. Scene numbers are the
run's own. Every `pull` re-downloads and overwrites every file, so running it
again is always safe.

```
storyboard.json          the whole storyboard envelope (see below)
reference.<ext>          the reference still the scene pictures were drawn from
cast-<characterId>.<ext> one identity still per locked cast member
cast-ref-NN.<ext>        an identity still the cast lock does not claim
scene-NN.keyframe.<ext>  the picture scene NN's clip was animated from
scene-NN.<ext>           the clip for scene NN, usually .mp4
scene-NN.voice.<ext>     the voice track for scene NN, when one was delivered
scene-NN.words.json      [{w, s, e}] word timings for that scene's speech
narration.mp3            one continuous narrator take of the whole script
narration.json           that take's settings, master-timeline words, and the
                         per-scene ranges it was cut into
music.<ext>              the music bed
manifest.json            the index below
```

`manifest.json`:

```
runId, pulledAt, dashboardUrl        the run and the page that opens it:
                                     /workflows/<workflowId>/runs/<runId>
storyboard, reference, music         filenames, or null when not delivered
musicBed                             on | off | unknown — whether the RUN has a
                                     music bed, which is not the same question
                                     as the `music` filename above. "unknown" is
                                     a run made before the run carried the
                                     answer; it is not "off"
musicHeardScenes[]                   scene numbers whose clip came back with
                                     music the video model baked in. A run with
                                     the bed off can still list scenes here, and
                                     those are the ones to listen to
pendingRedo[]                        scene numbers the app is redoing right
                                     now. Their clip and words are left out,
                                     because the file on the run is the take
                                     being replaced: run `exodus video wait`,
                                     then pull again
dropped[]                            B-roll scene numbers the app left out
                                     after a new idea and a still both failed.
                                     They have no clip on purpose: cut with
                                     `--skip` and stay on the speaker
narration                            { file, timing }, or null on a per-scene run
clipAudio                            keep | discard, on template-video pulls.
                                     Native talking keeps the clip's dialogue.
                                     Voice-first narration and song discard ALL
                                     embedded clip audio, including wordless
                                     pictures and reactions; use only the approved
                                     voice/song track. The bundled first-cut reads
                                     this policy for hand-run and automatic cuts.
                                     Absent on other models: existing cut rules apply.
cast[]                               one per identity still
  characterId, name                  from the run's cast lock; null for an
                                     unclaimed ledger still
  file, status, error
  voiceId, voiceLabel                the ElevenLabs voice this character was
                                     given before the clips were made; null when
                                     nobody chose one
scenes[]                             one per scene, in order
  sceneIndex, durationSec            the run's number and the clip's real length
  clip, voice, keyframe, words       filenames, or null
  wordsFrom                          clip | voice — which file the word times are
                                     measured against; null when none came
  wordsDescribe                      this-file | original-performance — whether
                                     those times were measured on the file you
                                     have, or on the take a cast voice replaced;
                                     null when no words came
  clipStatus                         done | failed | running | pending | missing
  error                              why the clip failed, when it did
  flagged, findings[]                QC verdict: {check, code, severity: fail|warn, detail}
  keyframeFindings[]                 the same, from the picture check; null when
                                     nobody checked the picture
  qc                                 {verdict, attempts} from the renderer
  revoiced                           the cast's pinned voice replaced the clip's
                                     generated voice; null when there is no clip
  speechTrimmed                      the clip was re-cut to its spoken words
                                     (0.5 s before the first, 0.8 s after the
                                     last); null when there is no clip
  rawStorageId                       the stored file the video model made, kept
                                     on record when the voice pass replaced the
                                     clip with a new file; null when the clip IS
                                     that file, or there is no clip
  voiceMode                          "voice-first" when the clip was redone voice
                                     first (its line recorded, then the clip made
                                     to match it); null otherwise
provenance                           which saved rulebook this run followed:
                                     {format: {via, nodeId, rigId, rigName,
                                     rulesFrom, specVersion}}. Absent when the
                                     run followed none. `nodeId` is the Rig box
                                     that chose it; `rulesFrom` names the rig the
                                     rules were borrowed from when the picked
                                     rig is a copy. Names, ids and a version
                                     only — never the rules themselves
failed[]                             files that did not download: {file, url, error}
```

### What each piece is

**The clips** (`scene-NN.<ext>`). The finished take, already trimmed and
revoiced where the run did that — not a raw render you have to repair.
`durationSec` is its real measured length. Whether the clip carries sound
depends on the scene; see "Which scenes carry their voice where" below.

**The storyboard** (`storyboard.json`). The intended cut, in the planner's own
terms. `script[]` is the ad's spoken words in order — `{lineId, speakerId, text}`,
with `speakerId: null` meaning narrator VO. Each scene carries `sceneIndex`,
`durationSec`, `dialogue[]`, `voText`, `notes`, and `lineIds` (the script lines
that scene renders). A scene with `kind: "cutaway"` carries `cueLineId` and a
`cutawayType` instead. Most cutaways are a picture-only takeover of the frame
while the spoken track underneath keeps running, so they add no audio and take
no place in the running order. A `cutawayType: "reaction"` cutaway is the room
reacting out loud to its cue line: it is its own short beat after that line,
heard with its own sound while the speaker is silent. The
envelope also carries `overlays[]` (each with a `cueLineId` and a `placement`)
and `audio` (`roomTone`, `music`, `sfxCues[]`) — the planner's notes on what
should sit on top. The image and motion prompts (`framePrompt`, `videoPrompt`,
`referencePrompt`) reach an admin key in full. A caller who cannot use video on
this brand gets them stripped before the file arrives. They are private Style
fragment IP (`redactVideoIp` in `convex/workflows.ts`). Style pack is the
retired name.

**The narration track** (`narration.mp3` + `narration.json`). Present when the
run recorded continuously: every narrated scene's `voText` joined into one
script and read by ElevenLabs in a single pass at speed 1.15 — one take, one
pace, start to finish. `narration.json` carries `takeHash`, `voiceId`,
`modelId`, `speed`, `alignment: "elevenlabs-timestamps"`, the master's word
timings, and `cuts[]`: for each scene, `startSec` and `durationSec` **into
narration.mp3**. Runs go per-scene instead when any scene has on-camera
dialogue, when the voiceover node is configured `take: "per-scene"`, or on an
older storyboard carrying no `script[]`; then there is no `narration.mp3` and
each scene's voice is its own recording. That choice is made from the storyboard
and the node config (`planNarration`).

**The per-scene voice tracks** (`scene-NN.voice.<ext>`). On a continuous run
these are cut out of `narration.mp3` itself — the same audio, sliced at the
ranges in `narration.json` with a 0.2 s pad and a boundary at the midpoint of
each gap. They are not separate performances. On a per-scene run each one is its
own ElevenLabs render.

**Which scenes carry their voice where.** A scene whose storyboard entry has a
non-empty `voText` is a narrator scene: its clip is rendered silent and the
voice arrives as a separate track. A scene with on-camera `dialogue[]` has the
speech inside the clip — under the default voice treatment the video model's
invented voice is then replaced, in place, with the cast member's pinned
ElevenLabs voice (that is `revoiced: true`). Other treatments leave the render
owning its own audio, e.g. lip-sync retargeting a VO track onto the video. The
treatment is frozen on the run when it starts, and there is exactly one flag
that sets it: `--voice-treatment` on `workflow run` (see **Choosing how the
voices are made**). Node config never sets it. Nothing on the canvas sets a
voice treatment, and a run that was given none renders the default. Read
`wordsFrom` and `revoiced` per scene rather than assuming.

**Word timings** (`scene-NN.words.json`). Seconds from the start of the file
`wordsFrom` names, always. `wordsFrom: "clip"` is an ElevenLabs Scribe
(`scribe_v1`) transcription of that clip's own audio, taken blind — the model
never sees the script — and re-based if the clip was speech-trimmed.
`wordsFrom: "voice"` is the ElevenLabs alignment of the continuous master,
re-based to the start of that scene's cut; on a per-scene run it is instead a
blind Scribe pass over that scene's own voice track. Nothing is aligned to the
finished ad — that timeline does not exist until you make it.

**How far to trust them** (`wordsDescribe`). `"this-file"` means the times were
measured on the very file `wordsFrom` names, so they hold to the frame: cut
captions and cue points straight off them. `"original-performance"` means the
scene's clip was re-voiced *after* its words were timed — the times describe the
take the cast voice replaced. The words and their order are right and the timing
is close, but nothing re-measures it, so check any cut that has to land on a
single frame. A clip carrying a `voice-timing-shifted` warning is the same thing
with a measured gap: the swapped audio came back a different length, so treat
that scene's times as a rough guide and watch it before you trust it. Nothing in
the pipeline speeds audio or video up or slows it down to make the two agree —
the timings are reported honestly instead.

**Cast identity stills** (`cast-*.<ext>`). A full-body identity still per cast
member, on a plain neutral background in the run's style, minted once and
frozen onto the run as its cast lock. Every scene picture was anchored to these,
which is why the same character holds across scenes. `cast-<characterId>` is a
locked member; `cast-ref-NN` is a still from the same minting the lock does not
claim. Useful as reference when you cut, and as the thing to point at when a QC
finding says `wrong-character`.

**The music bed** (`music.<ext>`). One continuous track for the whole ad,
generated by Eleven Music after the last clip lands, at the landed clips' summed
length plus a 3-second safety pad. One track per ad, never per-scene. It is
never mixed into any clip and never levelled — gain, fade and ducking are the
cut-maker's decisions. A music failure degrades to a warning rather than
blocking the run.

### Reading it before you cut

- `clipStatus: "done"` with a `clip` filename: the scene is cuttable.
- `wordsFrom: "voice"`, or a scene whose storyboard entry has `voText` and no
  on-camera line: the clip is picture only and the voice track is the sound.
  Do not use that clip's own audio.
- `wordsDescribe: "original-performance"`: the word times were measured before
  that clip's cast voice was swapped in. Close, not frame-exact — say so if the
  user is cutting captions to the frame.
- `manifest.narration` present: listen to `narration.mp3` end to end, then the
  joins between adjacent `scene-NN.voice` files, before you trust the cut.
  Matching voice IDs and a one-speaker diarization result do not prove
  continuity (#1802).
- `flagged: true` is a warning, not a block. The clip was delivered anyway; the
  findings say what the QC model saw (`wrong-character`, `eyeline-off`,
  `set-drift`, `speech-cutoff`, `framing-off`, `voice-timing-shifted`). Tell the
  user which scenes are flagged and why, and let them decide whether to keep,
  trim, drop or redo each one (`retry-clip`, see "Redoing one clip at the final
  watch").
  A `speech-cutoff` on the CTA scene is the one to worry about; the ad's last
  words are missing. `status` shows the checker's own wording behind each
  finding; the manifest carries only the verdict.
- A `pass` verdict is not a review. The checks are often optimistic. Watch the
  frames and listen to the audio before you call the run good. Two checks fail
  the wrong way. A cast-count check can reject a silent
  listener who belongs in the shot. A clip check can flag a clip that is fine.
  Read the finding, then watch the scene.
- `clipStatus: "failed"` or `"missing"` with a `keyframe`: `durationSec` is null
  (it comes from the clip), but the scene can still hold its place as a still —
  for the length of its voice track, or the storyboard's planned duration when
  there is no voice.
- `clipStatus: "running"` or `"pending"`: pull again later. `status` says when
  the run parks at the final watch, which means nothing is still rendering.
- `failed[]` non-empty: run the same `pull` again.

## Redoing one clip at the final watch

`retry-clip` re-renders ONE scene's clip on the run that already made it. There
is no second run, no new storyboard and no re-render of anything else.

```
exodus video retry-clip <runId> --scene 3
exodus video retry-clip <runId> --scene 3 --note "keep both hands in frame on the handshake"
exodus video retry-clip <runId> --scene 3 --node video-2
exodus video retry-clip <runId> --scene 3 --voice-first
```

`--node` is only needed when a run has clips for that scene on two video steps;
the CLI asks for it by name when it does.

**When it is allowed.** A failed clip, once the step that made it has finished. A
finished clip, only while the run is parked at the final watch, or when QC
flagged it (`flagged: true` in `status` and in the manifest). Everything else is
refused in one plain sentence before any task is queued: a step still rendering
its other scenes or one that failed outright, a scene already being redone, a
finished clip on a run that is not at its final watch. An ad that is already
delivered is refused by the server, in its own sentence.

**What stays untouched.** Every other scene's clip, every keyframe, the cast
pins, the voices and the approved script. The redone clip re-renders from the
same keyframe with the same voice path the first take used, so it comes back
revoiced and trimmed the same way, with fresh findings and fresh word timings.

**A `--note` steers the motion, never the words.** It is folded into that
scene's motion prompt only (`withRedoDirection`,
`scout/src/trigger/workflow-scene-retry.ts`); the spoken line still comes from
the approved storyboard. Asking for different words in a note will not change
them. If the script's words are wrong, that is a new run.

**`--voice-first` fixes a clip that said its line wrong** (#2299). It is for a
clip whose findings include `speech-mismatch`, `speech-repeat`,
`speech-after-line`, `speech-extra-words` or `speech-long-pause`. The scene's line is recorded in each
speaker's pinned ElevenLabs voice, and MiniMax (`minimax-h3/reference-to-video`)
makes the clip to match the recording. Only that clip changes; the word check
and the other checks still run on it. It needs an ElevenLabs key and a voice for
every speaker in the scene, and it is refused for a scene with no spoken line.
The clip then reads `clip: redone voice first` in `status`, carries
`voiceMode: "voice-first"` in the manifest, and is listed in the `pull` summary.

**A redo whose take fails the checks keeps the original clip.** On a finished
clip the row stays `done` with the ORIGINAL take and only its findings are
refreshed, because a worse take must never replace a delivered one. So never
report that the clip changed without reading `status` again: under the scene it
prints what the redo did, `new take accepted (take N)` or `new take rejected,
original kept (take N)`, and `status --json` carries the same sentence on the
row as `lastRedo.label`. A row with no `lastRedo` was redone before outcomes
were recorded; for those, pull and compare the file before and after.

**Re-cut afterwards.** A cut you already uploaded still holds the old clip, and
the CLI says so when that is the case. Pull again, re-cut and upload again before
anyone approves.

## Redoing only the voice on finished clips

`revoice` puts clips that are already paid for back through the voice pass: the
spoken words are checked against the script, the clip is trimmed to the speech,
and the chosen voice is applied. It makes no new video, so the picture cannot
change and no video credits are spent. ElevenLabs bills the voice work to the
member's own key.

```
exodus video revoice <runId> --all
exodus video revoice <runId> --scene 3
```

**When to reach for it.** `status` shows talking clips with `voice-unpinned` or
`voice-not-applied` (usually next to `speech-check-skipped`), and the manifest
shows `revoiced: false` with no words file. The usual cause is a run that had no ElevenLabs key when its
clips were made. `voices <runId>` says so: "This run has no ElevenLabs key saved".

**It finds the key by itself.** Before queuing anything, the server gives the run
the ElevenLabs key saved on the run owner's account, if the run has none. When
there is no saved key either, nothing is queued and the refusal says where to add
one (Settings → Keys). Approving a storyboard does the same top-up, so an older
run parked at its storyboard is fixed before any clip is paid for.

**`--all` picks the clips that need it.** Every finished clip whose file is still
the video model's own and whose findings carry `voice-unpinned` or
`voice-not-applied`, the two codes that mean a voice change should have happened
and did not. `speech-check-skipped` alone does not qualify: it also lands on
clips whose sound the video model or a later step owns, where there is no voice
to change and a pass would bill a transcription for nothing. `--scene <n>` is
not filtered this way; the server decides. It sends one request per scene, tries
every one, and reports each. Scenes refused with the same sentence share one
line (a run with no key prints that sentence once); `--json` keeps one entry per
scene.

**What is refused.** A clip that already went through the voice pass (`revoiced`,
`speechTrimmed` or a trimmed tail): the pass would trim or convert it twice. Use
`retry-clip` to make that clip again from scratch. A failed clip, a scene already
being redone, a step still rendering, and an ad already delivered.

**An older server starts nothing.** The voice redo has its own server route and
its own worker task. A server or worker from before it existed cannot run it, and
the CLI never falls back to `retry-clip`'s route, which would make new paid video.
You get one sentence saying the server does not have the voice redo yet, and
nothing is queued or spent.

**A clip is never lost.** The clip stays on its row the whole time. If the voice
pass cannot finish, the clip, its findings and its cost are left as they were and
one warning, `revoice-not-finished`, is added. Run it again. If ElevenLabs refuses
the key, the clip comes back unchanged with `voice-not-applied`.

**If the word check now fails.** The voiced clip is still delivered, and the scene
is flagged with the finding, because the picture is the same one the ad already
had. Decide from `status`: keep it, or `retry-clip` it.

**Afterwards.** Pull again. Each voiced scene now has `revoiced: true`, a words
file, and `rawStorageId` naming the original file. Re-cut and upload again if a
cut was already uploaded; the CLI says so when that is the case.

## Cutting the ad

Editing is the part every user does differently, and the team is deliberately
still finding out what works. Nothing below is the house way. Ask the user which
they want; if they have not said and are not around, say which you used and why.

- **The bundled script** — `node .claude/skills/exodus-video/scripts/first-cut.mjs
  ./ad-<runId>`, path from the workspace root (from a brand subfolder, prefix
  `../`). A plain assembly with no editing decisions in it, for seeing the whole
  ad end to end quickly. Read "What the bundled script does" before you run it.
- **HyperFrames** — HTML/CSS compositions rendered to video. Suits an ad that
  needs captions, title cards, overlays or motion graphics laid over the clips.
  It is a separate skill pack; check that a `hyperframes` skill is installed
  before offering it. The cut is made outside Exodus. `exodus video pull` is the
  handover. The folder it writes is what the next tool reads. When a HyperFrames
  skill pack is installed, that pack is the route for an HTML and CSS
  composition. Do not look for a stitch inside Exodus.
- **An NLE over MCP** — DaVinci Resolve publishes an MCP server, so a timeline
  can be built in a real editor and the user can carry on by hand afterwards.
  Suits a user who wants to keep editing after you stop. Check what MCP servers
  are actually connected first; do not assume one is there.
- **ffmpeg by hand** — full control with nothing extra to install. Suits a trim,
  a reorder, an aspect change, or anything the others make awkward.

Whatever you use, the only thing the product requires of the output is that
`upload` accepts it (see below).

### What the storyboard asks the cut to do

Read these out of `storyboard.json` before you build anything, in any tool:

- **Running order.** A-roll scenes (no `kind`, or `kind: "aroll"`) in
  `sceneIndex` order are the spine. Their summed length is the ad's length.
- **Cutaways.** `kind: "cutaway"` + `cueLineId`: lay the picture over the spine
  at the moment that script line is spoken, taking no audio and no place in the
  running order. To find the moment, locate the A-roll scene whose `lineIds`
  contain the cue line, then read the start time of the first word of that line
  out of that scene's `words.json`. A B-roll cutaway (one with `broll`) starts
  0.5 s before the first word of `broll.covers` instead (even if that reaches
  back into the scene before, but never into a reaction or before 0 s), and
  holds through its last word or for `broll.plannedSec`, whichever is longer,
  0.8 s to 4 s; a shot planned longer than 4 s (a talking character) holds at
  least `broll.plannedSec`. The next cutaway, a reaction or the ad's end cuts
  it short.
- **Reactions.** A cutaway with `cutawayType: "reaction"` is the exception. Do
  not lay it over the speech. Put it into the running order as its own beat
  right after its cue line ends, play its own sound (the audience laughing),
  keep it to about 1.5 s, then carry on with the speaker. Nobody talks during
  it. When more lines follow the cue line in the same scene, cut that scene
  where the cue line's last word ends in its `words.json` and put the reaction
  between the two halves.
- **Overlays and SFX.** `overlays[]` and `audio.sfxCues[]` are cued the same
  way, by `cueLineId`. Nothing renders them for you.
- **Jump cuts.** When `manifest.json` has `shots.pacing: "jump-cuts"`, every
  scene was filmed from the same framing on purpose. Punch in about 15% on
  every other cut between one speaker's scenes, so each cut visibly moves in
  or out. The bundled script does this for you.
- **Captions.** Nothing is burned into any clip. Captions belong in post; the
  word timings are what an editor imports to build them.

### What the bundled script does

State this to the user before you run it, so they know what the cut does with
the pieces:

- **It cuts the picture to the voice, and never the other way round.** A
  narrated scene's segment runs to the narrator's last word plus a beat of air:
  about 0.25 s before the next scene, 0.5 s when it ends the ad. The last word
  comes from the voice track's own word timings; when the scene has none, the
  end of the voice file stands in for it. A clip that runs longer is trimmed; a
  clip that runs shorter holds its last frame for the difference. The narration
  is never sped up or slowed down, so every scene plays at the speed it was
  recorded, and the word times are handed on as they were measured. The voice
  file is cut only in the silence after its last word, never inside a word.
- **It closes the dead air at the joins.** A clip that plays its own dialogue
  keeps about 0.15 s after its last word and about 0.1 s before its first (0.25 s
  when a different speaker answers), read from its `words.json`, so one clip
  runs into the next like one conversation. It only ever shortens a clip's
  silence and never cuts into a word. The ad's first clip also opens about 0.1 s
  before its first word, so a hum a clip makes before anyone speaks is not the
  first thing heard. The clip that ends the ad keeps about 0.5 s after its last
  word, the same beat a narrator line gets there, or longer when the storyboard
  marks an action after the line. A narrated scene, a still and a reaction beat
  keep their length.
- **It shortens long pauses between sentences inside one clip.** A silence over
  0.6 s between two sentences is cut down to about 0.5 s, picture and sound
  together, unless the script writes the pause in (an ellipsis or a dash), a
  direction asks for one, or a reaction's laugh follows the line.
- **It fades the audience reaction in and out.** A reaction beat fades in
  across any quiet start before its laugh (a generated laugh clip can hum
  there). When a line follows, the picture moves on early and the laugh's own
  remaining sound plays on under that line, quieter and fading out: up to
  0.75 s, and the beat keeps at least 1 s of picture (a 1.5 s clip shows 1 s
  and carries its last 0.5 s). A beat that ends the ad, or has under 0.4 s to
  carry, fades out over its last 0.4 s instead.
- **It ignores the continuous master.** It reads only `scene-NN.voice` files;
  it never opens `narration.mp3` or `manifest.narration`. A tool that lays the
  master down whole and cuts the pictures to it keeps the read intact. The one
  exception is a manifest with `wholeVoice: true`, which the automatic cut adds
  for a kind whose voice is a song: then `narration.mp3` is laid whole and each
  narrated scene lasts its stretch of it, from `narration.json`'s cuts.
- Otherwise: A-roll in manifest order as the spine, each reaction put in as its
  own beat of at most 1.5 s right after its cue line with its own sound, each
  other cutaway laid over the spine at its cued word (falling back to a
  proportional estimate when the scene has no word times, and saying which
  method it used), a narrated scene's voice
  replacing whatever the clip recorded, a dialogue scene keeping its performed
  line, everything normalized to 1080×1920
  at 24 fps and −16 LUFS per segment, a generated room-tone bed under the whole
  ad, and the music bed underneath at low level. Output is H.264 + AAC in an MP4
  with `-movflags +faststart`.
- **It stops when a scene has no clip.** A scene the storyboard plans that is
  still being made, never started, or failed stops the cut, which names each
  one. Wait for the clip and pull again, leave the scene out with `--skip`, or
  pass `--still-fill` to hold that scene's keyframe on screen instead: under its
  voice track if it has one, else silent for its planned length. The still is
  only ever made when asked for, because a run of them reads as a broken ad.
- Flags: `--out <file>`, `--skip 2,5`, `--no-music`, `--still-fill`. It prints what went in,
  what was left out and why, and the upload command. When a clip hums or
  clicks where nobody speaks at an edge the cut plays, it lists each one under
  "Sound at the edges" with its time in the cut. That is a warning to listen
  there; the cut is made anyway.
- Beside the MP4 it writes `cut.words.json` (every spoken word of the finished
  ad with its start and end) and `cut.srt` (the same words grouped into subtitle
  lines), named from the `--out` basename. Those times are on the finished ad's
  timeline, each scene's own word times offset by where that scene starts in the
  cut, less any lead-in trimmed at the join, and otherwise unaltered. Scenes with no word times leave
  gaps and are named in the report; when no scene delivered any, neither file is
  written. It always writes `cut.scenes.json` too: where each scene plays in the
  cut, one `{scene, startSec, seconds}` entry per placement. `exodus video
  upload` sends `cut.scenes.json` and `cut.words.json` with the cut when they
  sit beside it, so the customer's edit list shows each scene's time on screen
  and their editor folder gets the captions. These sidecars are the script's own
  output — another tool will not produce them.

Before uploading anything, from any tool, check what you made:
`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 cut.mp4`
should be close to the sum of the scene durations you kept (the bundled
script's cut runs somewhat shorter, by the silence it trimmed at the joins). A cut that is a few
seconds long when five clips went in means a filter dropped inputs; do not
upload it.

## What the product actually requires

These are the system's rules. They hold no matter which tool made the cut.

**`upload` accepts** `.mp4`, `.m4v`, `.mov` or `.webm`, up to 200 MB. The server
re-derives the type from the stored bytes and rejects anything that is not video.
The length comes from `--duration` if you pass it, else `ffprobe`, else the MP4
header; when none of those works the CLI says so and asks for `--duration`. The
length you give is recorded as stated and never measured against the file, so
give a real one.

**`upload` only works at the final watch.** The run has to be parked there with
its video step done, or the server answers "This ad isn't waiting for your final
cut right now." That park exists only when the video node sets
`finalWatch: true`. Uploading again replaces the
previous cut in place rather than adding a second one. Upload does not move the
run; it stays parked until someone approves.

**Approving is what makes it the ad, and it is one-way.** `approve` at the final
watch stamps the run delivered and resumes it. After that the server refuses any
further upload ("This ad is already delivered — nothing to change"). So approve
only when the user has seen the cut or told you to run unattended.

**Nothing checks that the cut matches the approved ad.** The server verifies
that the file is a video and that the run is at the right gate. It never
compares the cut against the script or the storyboard. The approved spoken copy
and the approved narration are therefore not the editor's to change — reordering
lines, re-recording narration, or cutting words out of the CTA will ship,
silently. Cut the pictures to the words, not the words to the pictures. If the
words are wrong, that is a new run, not an edit.

Never stretch speech, speed it up, slow it down, or cut it short so it fits a
clip. That is a product rule, and it holds for every tool that makes the cut,
including the bundled script. If the audio does not fit, redo the clip with
`exodus video retry-clip`. Do not repair the fit in the editor.

## Reporting to the user

Lead with where the run is and what it needs from them. Then, when you pulled
or cut: how many scenes, which are flagged and why in one line each, what you
left out, which tool you cut with and anything it changed, the cut's length, and
the exact command or link for the next step. Never paste the manifest;
summarize it.
