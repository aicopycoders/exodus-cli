# 03: Script rules

## Why timeline ads work (keep this in mind while writing)

- **Imagined ownership:** the prospect pictures USING the product as a daily ritual and feeling the payoff. They're remembering a routine they haven't started. That's Cialdini's Consistency principle, weaponized: buying becomes staying consistent with the version of themselves they already watched.
- **They're a witness, not a judge:** the claims don't feel like claims because the viewer watches them happen.
- **Gradualization:** start with almost-nothing claims and climb. Every checkpoint earns permission for a bigger promise.
- **The skeptic beat buys trust:** saying "nothing happened on Day 1" validates their inner skeptic. 38% of winning ads do it.
- **A timeline is a serial:** every checkpoint opens a new loop and ends on momentum.

## The milestone ladder (order matters)

Data from 277 winning positive timeline ads (RYZE, IM8, Resilia). Average position where each benefit first appears, 0 = first word after the hook, 1 = the moment the ad starts selling:

gut 0.35 / cravings 0.37 / felt bloat 0.39 / focus 0.40 / energy 0.40 / clothes fit 0.43 / visible face or body 0.44 / sleep 0.45 / other people notice 0.47 / identity 0.80 / a weight or lab number 0.80

So climb:
1. **Skeptic beat / invisible changes.** Nothing felt, or work happening where they can't feel it. (64% of winners open Day 1 on "nothing" or invisible work. Only claim a felt Day 1 win in categories where fast is already believable: cravings, calm, hydration.)
2. **A small, tangible win tied to a real moment in their day.** "You weren't buzzing, but you felt steady... by noon you realized you were still on your first cup of coffee."
3. **Self-observation (behavior).** Something they DID or STOPPED doing. They can't doubt their own behavior.
4. **Visible wins + social observation, together, mid-ad.** Belt notch, jeans buttoning, the mirror, and right on their heels, someone else notices (kills the "placebo" doubt).
5. **Big numbers (if any) and identity, at the END.** The scale, the lab result, the doctor's chart. Then the identity/lifestyle scene. Many winners skip the number entirely.

**The AOV trick (results that compound):** the hook can say 14 or 30 days, but carry the milestones out to Month 2 and Month 3, and make each one BUILD on the last ("by month two, it's not just the stairs..." / "month three is when the people around you start asking"). If the best results land after the first bottle runs out, the viewer wants the 3-bottle bundle, not the single. Tie the offer to it: "Most people grab the 3-month supply, because month three is where it really comes together." Only use offer details the user gives you.

Spacing: DENSE early (Day 1, 3, 5, 7), sparse late (14, 30). Most winners run 3-7 milestones; 4 is the most common. Each checkpoint ends on momentum ("then things got interesting"), never a plateau.

## Two mechanism layers

- **Layer 1, ingredient credit:** a short tag naming what's doing the work, attached to something happening TO the person. "Turkey tail feeds the good bacteria in your gut. The bloat settles." 74% of winners put this INSIDE the milestones.
- **Layer 2, full explanation:** what was really wrong, why other fixes failed, why this product fixes it. Only 16% of winners do this inside a milestone. Most put it in the hook, on Day 1, or AFTER the timeline.

Pick one structure and say which:
- **Option 1, embedded:** Layer 1 credits in the milestones, Layer 2 after.
- **Option 2, results first:** milestones are pure results, then the full explanation after (Aurivita's cold-feet ad).

Never let it sound like the brand lecturing mid-timeline.

## Beat order (default)

0. Frame + tease (who, the ritual, the timeline; optionally name the last stage as the prize)
1. Day 1 (taste/ease, skeptic beat)
2. Small wins (often framed as things that STOP)
3. Feelings (+ ingredient credits if Option 1)
4. Visible + social
5. Identity / life scene
6. Bridge + differentiator (the villain is the cheap knockoff or the wrong fix, never the viewer)
7. The seal (one line that locks the ritual: "One cup every morning.")
8. Proof (only REAL proof the user gives you)
9. Offer + guarantee + urgency (only what the user gives you)

The timeline is ~75% of the script. The sale is the last quarter.

## Line craft

- One spoken line per line. Write for the ear. Median 7-9 words.
- Micro-moments from THEIR real day (the 3pm crash, the snooze button, the stairs).
- The pronoun trick: third-person frame, then slide into "you" for the body.
- Name the ritual in the tense they'd use once they own it: "two softgels with breakfast."
- Hedge the claims: "starting to", "a lot of people notice", "might".
- **Pronunciation check:** list every product/industry word a voice could misread (softgels, CoQ10, ashwagandha, brand names) in `project.json` -> `pronounce` with a phonetic spelling, e.g. `"softgels": "soft jells"`, `"CoQ10": "co Q ten"`. The voice says the spelling; captions still show the real word.
- Numbers in the script are written as they should be SPOKEN ("thirty days", "twelve-hour shift") so the voice reads them right.

## Banned

- Identity catchphrases: "There he is", "There she is", "You look like you again", "feel like yourself again". Show the scene instead (his wife reaches for his hand on the couch; he's on the floor building Legos with his grandson).
- AI tells: "here's the kicker", "here's the thing", "it's not X, it's Y" balanced flips, "game-changer", "unlock", "elevate", recap tags ("that's the whole game").
- Em-dashes (use a period, a comma or "...").
- Invented proof: fake results, fake reviews, fake doctors or credentials, user counts the user didn't give you.
- Big medical claims (cures, reverses, replaces medication). Flag them to the user instead.

## Self-check (run before showing the script; list results)

1. Does Day 1 promise almost nothing (or only a believable fast win)?
2. Do the milestones climb in ladder order, with identity and any number at the end?
3. Is every milestone a specific MOMENT, not a benefit word?
4. Is there a witness?
5. Is the mechanism placed per Option 1 or 2, and never as a mid-timeline lecture?
6. Is every claim hedged and supported by the user's inputs?
7. Any banned phrase, catchphrase, em-dash or invented proof? (must be zero)
8. Do the results keep going past the hook's timeline into Month 2 and Month 3 (the AOV trick)?
9. Every tricky product word has a `pronounce` entry?
10. Word count and estimated runtime (words / 2.6 = seconds, roughly).
