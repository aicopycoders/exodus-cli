# 04: Storyboard

## Voice casting

**Provider:** `voice.provider` = `kie` (default; uses the Kie key, voices each line separately and joins them) or `elevenlabs` (uses the user's own ELEVENLABS_API_KEY; one continuous read with exact word timing, slightly smoother delivery). The voice IDs below work on both.

Pick the voice that fits THIS script and market. Ask: who would the viewer trust telling this story? Match narrator gender to the story's POV when it's first person (a woman's Diary needs a woman's voice). Match age and energy to the avatar (a 60-year-old market wants a warm, grounded voice; a bro ad wants a younger, cockier one).

Voices available on Kie's ElevenLabs model. Use the NAME in `project.json` (`voice.name`); the script converts it to Kie's voice ID. Preview any voice in a browser: `https://static.aiquickdraw.com/elevenlabs/voice/<ID>.mp3`.

| Name | ID (for the preview link) |
|---|---|
| James | EkK5I93UQWFDigLMpZcX |
| Arabella | Z3R5wn05IrDiVCyEkUrK |
| Bradford | NNl6r8mD7vthiJatiJt1 |
| Xavier | YOq2y2Up4RgXP2HyXjE5 |
| Kuon | B8gJV1IhpuegLxdpXFOE |
| Monika Sogam | 2zRM7PkgwBPiau2jvVXc |
| Mark | 1SM7GgM6IMuvQlz2BwM3 |
| Adeline | 5l5f8iK3YPeGga21rQIX |
| Sam | scOwDtmlUjD3prqpp97I |
| Spuds Oxley | NOpBlnGInO9m6vDvFkFC |
| Eve | BZgkqPqms7Kj9ulSkVzn |
| Northern Terry | wo6udizrrtpIxWGp2qJk |
| British Football Announcer | gU0LNdkMOQCOrPrwtbee |
| Brock | DGzg6RaUqxGRTHSBjfgF |
| Nathan | x70vRnQBMBu4FAYhjJbO |
| Anika | Sm1seazb4gs7RSlUVw7c |
| Viraj | P1bg08DkjqiVEzOn76yG |
| Taksh | qDuRKMlYmrm8trt5QyBn |
| Horatius | qXpMhyvQqiRxWQs4qSSB |
| Liam | TX3LPaxmHKxFdv7VOQHJ |
| Callum | N2lVS1w4EtoT3dr4eOWO |
| Laura | FGY2WhTYpPnrIDTdsKH5 |
| Brittney | kPzsL2i3teMYv0FxEYQ6 |
| Mark 2 | UgBBYS2sOqTuMpoF3BR0 |
| Bella | hpp4J3VqNfWAUOO0d1Us |
| Brian | nPczCjzI2devNBz1zQrb |
| Hope | uYXf8XasLslADfZ2MB4u |
| Jeff | gs0tAILXbY5DNrJrsM6F |
| Jamahal | DTKMou8ccj1ZaWGBiotd |
| Finn | vBKc2FfBKJfcZNyEt1n6 |
| Tom | DYkrAHD8iwork3YSUBbs |
| Cassidy | 56AoDkrOh6qfVPDXZ7Pt |
| Addison 2.0 | eR40ATw9ArzDf9h3v7t7 |
| Jessica Anne Bogart | g6xIsTj2HwM6VR4iXFCw |
| Lucy | lcMyyd2HUfFzxdCaC4Ta |
| Tiffany | 6aDn1KB0hjpdcocrUkmq |
| Felix | Sq93GQT4X1lKDXsQcixO |
| Jessica Anne Bogart Villain | flHkNRp1BlvT73UL6gyz |
| Lutz | 9yzdeviXkFddZ4Oz8Mok |
| Emma | pPdl9cQBQq4p6mRkZy2Z |
| Edward | zYcjlYFOd3taleS0gkk3 |
| Marshal | nzeAacJi50IvxcyDnMXa |
| John Morgan | ruirxsoakN0GWmGNIo04 |
| Aria | TC0Zp7WVFzhA8zpTlRqV |
| Viking Bjorn | ljo9gAlSqKOvF6D8sOsX |
| Pirate Marshal | PPzYpIqttlTYA83688JI |
| Johnny Kid | 8JVbfL6oEdmuxKn5DK2C |
| Hope 2 | iCrDUkL56s3C8sCRl7wb |
| Ana Rita | wJqPPQ618aTW29mptyoc |
| John Doe | EiNlNiXeDU1pqqOPrYMO |
| Burt Reynolds | 4YYIPFl9wE5c4L2eu2Gb |
| Hank | 6F5Zhi321D3Oq7v1oNT4 |
| Wyatt | YXpFCvM1S3JbWEJhoskW |
| Phil | LG95yZDEHg6fCZdQjLqj |
| Johnny Dynamite | CeNX9CMwmxDxUF5Q2Inm |
| Rachel M | aD6riP1btT197c6dACmy |
| Rex Thunder | mtrellq69YZsNwzUSyXh |
| Ed | dHd5gvgSOzSfduK4CvEg |
| Jean | eVItLK1UvXctxuaRV2Oq |
| Britney | esy0r39YPLQjOczyOib8 |
| Sven | Tsns2HvNFKfGiNjllgqo |
| Viraj 2 | 1U02n4nD6AdIZ9CjF053 |
| Nathaniel | AeRdCCKzvd23BpJoofzx |
| Benjamin | LruHrtVF6PSyGItzMNHS |
| Allison | 1wGbFxmAM3Fgw63G1zZJ |
| Theodore HQ | hqfrgApggtO1785R4Fsn |
| Leon | MJ0RnG71ty4LH3dvNfSd |

If in doubt, render one line first: `python <skill>/scripts/gen_vo.py <project> --test-voice NAME`.

Give your pick + one backup + why. Settings that sounded human on our builds: stability 0.38 (lower = more expressive), similarity 0.8, style 0.4, speed 1.0. Store them in `project.json` under `voice`.

## Character sheet (one image, generated once)

The character sheet is why the character looks the same in every shot. Rules:
- **Costume = a short list of NAMEABLE pieces** ("backwards mustard-yellow baseball cap, open teal bowling shirt over the bare ribcage, amber eyes, small silver chain"). Every later prompt repeats this exact list (`character.lock`). A model can match named pieces; it can't match a vibe.
- **6 poses = the emotional range the script needs** (exhausted, focused, celebrating, cocky, relaxed, shocked; adjust to the script).
- **Skulls stay PLAIN:** smooth ivory bone, no face paint, no sugar-skull or Day of the Dead markings. Painted skulls read as Pixar's Coco and get the video blocked as "protected IP".
- **"Charming not scary"** for skeletons and monsters. **"EXACTLY ONE [character] per pose"** stops twins.
- **Give the character the avatar's role** ("works as an ER nurse") so the market sees itself.
- Every recurring side character (spouse, boss, doctor, grandkid) gets its own reference sheet in `extra_cast`. Side characters drift more than the hero.

Sheet prompt template (fill the braces):
```
{STYLE} character model sheet of ONE original {CHARACTER TYPE} character, {ROLE}. {APPEARANCE + COSTUME LOCK}.
A clean 3x2 grid of SIX full-body poses on a neutral warm-grey studio background: (1) {POSE} (2) {POSE} (3) {POSE}
(4) {POSE} (5) {POSE} (6) {POSE}. Big expression range, squash-and-stretch friendly, cinematic three-point lighting,
{STYLE} production quality, charming not scary. EXACTLY ONE {CHARACTER TYPE} per pose.
NO text, NO labels, NO numbers, NO watermarks, NO letters anywhere.
```

## The set

ONE fixed set description (`set`) reused in every shot unless a panel says otherwise. It does for locations what the sheet does for the character. Keep monitors, TVs, phones and papers ABSTRACT ("glowing with colorful abstract shapes, pictures only") and UNBRANDED. Screens showing scenes got frames refused as "protected IP" on Omni, and leaked fake words like "BOOM" onto others.

## Shot plan

Group consecutive script lines into shots. Omni clips are 4/6/8/10 seconds, so aim for shots of ~4-10 seconds of voiceover (the scripts split anything longer automatically). Each shot in `project.json`:

```json
{"id": 3, "label": "DAY 1",
 "lines": ["Day one, nothing.", "He still grabs the railing on the stairs."],
 "panels": ["The skeleton swallows two red softgels with his coffee at the kitchen counter, unimpressed",
            "The skeleton grips the stair railing and hauls himself up one step at a time, wincing"],
 "beats": [["0-3s", "He swallows two softgels with his coffee and shrugs"],
           ["3-7s", "He grips the railing and hauls himself up the stairs, wincing"]]}
```

- `lines` must be the EXACT lines from `script.txt`, in order, covering the whole script with no gaps and no repeats. The scripts use them to time each shot from the voiceover.
- `panels`: 1-3 visual sentences, in order. Each must literally DO its line (abstract line, concrete picture).
- `beats`: the same actions with rough time ranges inside the shot.

## The Director Test (every panel, every clip)

Every frame must pass a detail-obsessed director with final say. Each panel description answers these, in words:
1. **FACING:** what is each character facing? (A character watching a screen faces the screen. A character climbing stairs faces UP the stairs.)
2. **DIRECTION OF TRAVEL + CAMERA:** which way are they moving, and where is the camera so the motion reads right? ("Walt climbs UP the stairs toward the camera; the camera is at the top of the staircase looking down at his face.") Never leave a moving character's direction implied.
3. **HANDS:** what is in each hand? (Mug, banister, book, the kid's legs on a piggyback.)
4. **BODY MECHANICS:** is the pose physically possible and natural? Weight on the right foot, knees bending the right way, the kid's weight actually supported, nobody floating.
5. **LIGHT:** where is the light coming from? (Matches the time of day of the beat.)
6. **CONTINUITY:** same costume, same set, same props as the shots around it.

When a new failure shows up in a finished ad, add the director question that would have caught it here.

## Panel rules

- **Literal visual metaphor for every claim.** "His editor butchered his vision" = his jaw falls off and clatters on the desk. "One winner into five" = one film reel splits into five.
- **Comedy carries the pain.** A cartoon can take brutal hits and stay watchable.
- **Show a witness** for every big win; the viewer believes it because someone in the scene reacts.
- **Screens and papers show pictures only.** Never ask for words in the image.
- **Color tells the story.** Warm gold for the good timeline, cold blue for the bad one.
- **End on direct address:** the character turns to camera / points at the viewer under the end card.
- **Any panel NOT in the default set starts with its location** ("In the moonlit bedroom...", "On the sunny soccer field...", "At his office desk in a grey cubicle..."). Without it, the image model drifts back to the default set.
- **Use `panel_cast`** when a shot's panels show different characters (e.g. `"panel_cast": [["wife"], ["dad", "wife"]]`), so nobody appears in a frame they shouldn't be in.
- **Every panel names the character with the costume lock**, and keeps EXACTLY ONE of each character.

## Date stamps and end card

`stamps`: the spoken words that trigger each big on-screen stamp, e.g. `{"say": "Day one", "label": "DAY 1"}`. The `say` text must appear in `script.txt`. Stamps pop in the instant the narrator says them.

`end_card`: up to 3 short lines (offer, guarantee, "Tap the link below"). Only what the user gives you.
