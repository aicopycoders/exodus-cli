import { speechIssueText } from "../lib/speechIssueText.js";
import { AUDITION_RESTART_REASON } from "../lib/template-audition.js";
export function speechSummaryLines(speech) {
    if (!speech)
        return [];
    const labels = { verbatim: "Verbatim", "accepted-with-speech-issue": "Accepted with speech issue",
        "speech-issue": "Speech issue — review required", unverified: "Speech not verified" };
    return [labels[speech.status], ...speech.issues.map(speechIssueText)];
}
const END_CARD_CHECK_WORDS = { passed: "passed", failed: "failed", unchecked: "not checked" };
export function endCardLines(card, id, page) {
    if (!card)
        return [];
    const label = "The end card: ";
    const under = " ".repeat(label.length);
    if (card.state === "none")
        return [`${card.reason} ${card.note}`];
    if (card.state === "dropped")
        return [`${label}${card.note}`];
    if (card.state !== "ready")
        return [];
    const drawn = card.drawn ?? (card.imageUrl !== null && card.imageUrl !== undefined);
    return [
        `${label}${card.layout}. ${drawn ? `See it: ${page}` : "Its picture can't be shown here."}`,
        ...card.words.map((word) => `${under}${word.label}: ${word.words}`),
        `${under}Check: ${END_CARD_CHECK_WORDS[card.check.state] ?? card.check.state}`,
        `${under}${card.note}`,
        ...(card.simpleNote ? [`${under}${card.simpleNote}`] : []),
        `Drop it:      exodus video drop-card ${id}`,
    ];
}
function songNoticeLines(notice) {
    return Array.isArray(notice) ? notice.filter((s) => typeof s === "string" && s.trim() !== "").map((s) => `Heads-up: ${s}`) : [];
}
export const SONG_CALL_NEW_VIDEO = "A new video makes the whole ad again, at its own price, shown before you start.";
export const SONG_CALL_NO_SCENE_PICTURES = "This video is filmed from the pictures of its people and places, one clip for every one to three sung lines, so no picture of a scene was drawn.";
export const SONG_CALL_NO_ONE_SCENE = `One scene's clip or picture can't be made again on its own. ${SONG_CALL_NEW_VIDEO}`;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function callPictureWords(picture) {
    const who = typeof picture.characterId === "string" ? picture.characterId : "a person";
    switch (picture.kind) {
        case "character-sheet": return `the sheet of ${who}`;
        case "character-picture": return `the picture of ${who}`;
        case "product-sheet": return "the product's sheet";
        case "product-plate": return "the product's picture";
        case "props-sheet": return "the props' sheet";
        case "place-view":
            return `${typeof picture.place === "string" ? picture.place : "a place"}${typeof picture.view === "string" ? `, view ${picture.view}` : ""}${picture.lit === true ? ", lit" : ""}`;
        default: return typeof picture.kind === "string" ? picture.kind : "a picture";
    }
}
export function songCallsProblem(songCalls) {
    return isObject(songCalls) && typeof songCalls.problem === "string";
}
export function songCallStopLines(songCalls, page = "") {
    if (!isObject(songCalls))
        return [];
    if (typeof songCalls.problem === "string")
        return [songCalls.problem];
    if (typeof songCalls.notYet === "string")
        return [songCalls.notYet];
    if (!Array.isArray(songCalls.calls))
        return [];
    const lines = [SONG_CALL_NO_SCENE_PICTURES, "The pictures each video call is filmed from:"];
    let drawn = false;
    for (const call of songCalls.calls.filter(isObject)) {
        const scenes = Array.isArray(call.scenes) ? call.scenes : [];
        const pictures = Array.isArray(call.pictures) ? call.pictures.filter(isObject) : [];
        lines.push(`  Call ${String(call.n)} (${scenes.length === 1 ? "scene" : "scenes"} ${scenes.join(", ")}): ${pictures.length === 1 ? "1 picture" : `${pictures.length} pictures`}`);
        for (const picture of pictures)
            lines.push(`    ${callPictureWords(picture)}`);
        drawn = drawn || pictures.length > 0;
    }
    if (drawn && page)
        lines.push(`See the pictures: ${page}`);
    const notes = Array.isArray(songCalls.notes) ? songCalls.notes.filter((note) => typeof note === "string" && note.trim() !== "") : [];
    return [...lines, ...notes, SONG_CALL_NO_ONE_SCENE];
}
export function stopPictureText(pictures) {
    return pictures.flatMap((picture) => [picture.line, ...(picture.check ? [picture.check] : [])]);
}
const STOP_PICTURES = [
    { key: "face", noun: "face", label: "The face:     ", missed: "The face photo didn't come out. It is drawn when you approve, before the takes are filmed." },
    { key: "place", noun: "place", label: "The place:    ", missed: "The picture of the place didn't come out. It is drawn when you approve, before the takes are filmed." },
    { key: "cutout", noun: "product cut-out", label: "The cut-out:  ", missed: "The product cut-out didn't come out. It is drawn when you approve, before the takes are filmed." },
];
export function stopPictureLines(pictures, page) {
    return STOP_PICTURES.flatMap(({ key, noun, label, missed }) => {
        const picture = pictures[key];
        if (!picture)
            return [];
        const drawn = picture.imageUrl !== null;
        const check = drawn && picture.check?.line ? `${" ".repeat(label.length)}${picture.check.line}` : undefined;
        return [{ noun, drawn, line: drawn ? `${label}drawn. See it: ${page}` : missed, ...(check ? { check } : {}) }];
    });
}
export function noPhotoLines(run) {
    return run.productNoPhoto ? [`The product:  ${run.productNoPhoto.line}`] : [];
}
export function listedWords(words) {
    return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
export function extraShotLines(run, id) {
    const shots = run.extraShots?.shots ?? [];
    if (shots.length === 0)
        return [];
    const layout = { full: "full screen", split: "split screen" };
    return [
        `Extra shots:  ${shots.length} planned, cut in while the voice carries on (in development, untested).`,
        ...shots.map((shot) => `  ${shot.n}. ${shot.label}, on "${shot.word}", ${layout[shot.layout]}${shot.usd !== null ? `, $${shot.usd.toFixed(2)}` : ""}`),
        `Drop one:     exodus video drop-shot ${id} --shot <n>`,
    ];
}
function noPictureBeforeApproval(run) {
    return run.stage === "review" && run.planHold?.atBoard === true && run.planHold.beforePictures !== true;
}
export function spendAskLines(run, runId) {
    if (run.spendAsk) {
        return [
            `Waiting for you: ${run.spendAsk.sentence}`,
            `Keep going: exodus video keep-going ${runId}`,
            `Stop here:  exodus video stop-here ${runId}`,
        ];
    }
    if (run.spendStopped)
        return [run.spendStopped.sentence ?? SPEND_STOPPED_LINE];
    if (run.spendWentOn)
        return [run.spendWentOn.sentence];
    return [];
}
export const SPEND_STOPPED_LINE = "You stopped this video at its estimate. The app films nothing more on its own.";
export function customerCutHeld(run) {
    return (run.cutHolds?.length ?? 0) > 0;
}
function heldLines(run, page) {
    const holds = run.cutHolds ?? [];
    const scenes = run.cutHeldScenes;
    const one = (scenes?.length ?? holds.length) === 1;
    const head = `Held: the final video wasn't made yet. ${one ? "This scene needs" : "These scenes need"} you first:`;
    if (!scenes?.length) {
        if (run.songCalls !== undefined) {
            return [head, ...holds.map((hold) => `  ${hold}`), SONG_CALL_NO_ONE_SCENE, `${one ? "Keep it" : "Keep each one"} as it is on the video's page: ${page}`];
        }
        return [head, ...holds.map((hold) => `  ${hold}`), `${one ? "Make it again" : "Make each one again"}, or keep it as it is, on the video's page: ${page}`];
    }
    return [head, ...heldSceneChoiceLines(run, scenes, page)];
}
export function waitingSceneLines(run, page) {
    const scenes = run.waitingScenes;
    if (!scenes?.length || customerCutHeld(run))
        return [];
    return [
        `${scenes.length === 1 ? "This scene needs" : "These scenes need"} you before your video can be finished:`,
        ...heldSceneChoiceLines(run, scenes, page),
    ];
}
export function approveWaitingLines(run, page) {
    const scenes = run.cutHeldScenes?.length ? run.cutHeldScenes : run.waitingScenes;
    if (!scenes?.length)
        return [];
    const price = tryAgainPrice(run, scenes.filter((s) => !s.take && !s.voice).map((s) => s.sceneIndex));
    return [
        ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
        price ? `On the video's page, Try again costs ${price}: ${page}` : `The video's page: ${page}`,
        ...scenes
            .filter((s) => !s.unfilmed && !s.voiceLocked)
            .map((s) => `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
    ];
}
function tryAgainPrice(run, sceneIndexes) {
    const prices = sceneIndexes.map((n) => {
        const clip = run.scenes?.find((s) => s.sceneIndex === n)?.clip;
        return typeof clip?.redoEstimateUsd === "number" && typeof clip.redoEstimateMaxUsd === "number"
            ? `$${clip.redoEstimateUsd.toFixed(2)} to $${clip.redoEstimateMaxUsd.toFixed(2)}`
            : null;
    });
    if (prices.length === 0 || prices.some((p) => p === null))
        return "";
    return prices.length === 1 ? prices[0] : prices.map((p, i) => `${p} for scene ${sceneIndexes[i]}`).join(", ");
}
function heldSceneChoiceLines(run, scenes, page) {
    const takes = scenes.filter((s) => s.take);
    const unfilmed = scenes.filter((s) => s.unfilmed);
    const voices = scenes.filter((s) => s.voice && !s.take && !s.unfilmed);
    const faults = scenes.filter((s) => !s.take && !s.unfilmed && !s.voice);
    const keepable = faults.filter((s) => !s.voiceLocked);
    const calls = run.songCalls !== undefined;
    const inParens = (price) => (price ? ` (${price})` : "");
    const unfilmedPrice = inParens(tryAgainPrice(run, unfilmed.map((s) => s.sceneIndex)));
    const faultPrice = inParens(tryAgainPrice(run, faults.map((s) => s.sceneIndex)));
    return [
        ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
        ...(calls && (unfilmed.length > 0 || faults.length > 0) ? [SONG_CALL_NO_ONE_SCENE] : []),
        ...(unfilmed.length > 0 && !calls
            ? [`${unfilmed.length === 1 ? "Film it" : "Film each one"} with Try again on the video's page, which shows the price first${unfilmedPrice}: ${page}`]
            : []),
        ...takes.map((s) => takes.length === 1
            ? `Keep it as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`
            : `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
        ...voices.flatMap((s) => [
            `Try scene ${s.sceneIndex}'s voice change again (nothing is filmed; ${VOICE_RETRY_COST}): exodus video revoice ${run.runId} --scene ${s.sceneIndex}`,
            ...(s.voiceLocked
                ? []
                : [`Or keep scene ${s.sceneIndex} in the voice it was filmed in: exodus video keep ${run.runId} --scene ${s.sceneIndex}`]),
        ]),
        ...(faults.length > 0
            ? [
                ...(calls ? [] : [`${faults.length === 1 ? "Make it again" : "Make each one again"} with Try again${keepable.length > 0 ? ", or keep it as it is," : ""} on the video's page. Try again shows the price first${faultPrice}: ${page}`]),
                ...keepable.map((s) => `Or keep ${faults.length === 1 ? "it" : `scene ${s.sceneIndex}`} as it is from here: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
            ]
            : []),
        ...(takes.length > 0 && faults.length === 0 && unfilmed.length === 0
            ? [`${takes.length === 1 ? "Watch it first:  " : "Watch them first:"} ${page}`]
            : []),
    ];
}
function storyboardPictureLines(pictures, page) {
    if (!pictures)
        return [];
    const as = (picture) => picture ? { imageUrl: picture.drawn ? page : null, ...(picture.check ? { check: { line: picture.check } } : {}) } : undefined;
    const lines = stopPictureText(stopPictureLines({ face: as(pictures.face), place: as(pictures.place), cutout: as(pictures.cutout) }, page));
    return lines.length > 0 ? ["", ...lines] : [];
}
export function openingLines(openings, id, digest, acceptFindings = false) {
    if (!openings || openings.length < 2)
        return [];
    return [
        "",
        `Take 1's opening, its first 2 seconds: pick 1 of ${openings.length}. Opening 1 is picked.`,
        ...openings.flatMap((opening, i) => [
            `  ${i + 1}. ${opening.name}`,
            `     ${opening.seen}`,
            ...(opening.words ? [`     Words on screen: "${opening.words}"`] : []),
        ]),
        acceptFindings
            ? `pick another opening, accepting what the check found:  exodus video approve ${id} --opening <n>${digest ? ` --openings ${digest}` : ""} --accept-findings`
            : `pick another opening: exodus video approve ${id} --opening <n>${digest ? ` --openings ${digest}` : ""}`,
    ];
}
function storyboardEndCardLines(board, page) {
    const lines = endCardLines(board.endCard, board.runId, page);
    return lines.length > 0 ? ["", ...lines] : [];
}
function storyboardNoPhotoLines(board) {
    return board.productNoPhoto ? ["", ...noPhotoLines(board)] : [];
}
function hardWordLines(words) {
    if (!words?.length)
        return [];
    return [
        "",
        `Long or product words with no "said as" yet: ${words.join(", ")}`,
        `Add how one is said, before you approve: exodus brand dictionary add "${words[0]}" --say "<how it is said>"`,
        "A change to a word already in your dictionary applies from the next video.",
    ];
}
function findingLines(findings) {
    return (findings ?? []).map((f) => {
        const n = f.scenes;
        const where = n.length === 0 ? "" : n.length === 1 ? `Scene ${n[0]}: ` : `Scenes ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}: `;
        return `  ${where}${f.text}`;
    });
}
function acceptFindingsLine(id) {
    return `Go on anyway, accepting what the check found:  exodus video approve ${id} --accept-findings`;
}
export function customerAnswer(data) {
    return typeof data === "object" && data !== null && data.view === "customer"
        ? data
        : null;
}
export function customerRunPage(dashboardUrl, runId) {
    return `${dashboardUrl}/video/runs/${runId}`;
}
export function onOwnDashboard(serverUrl, dashboardUrl) {
    if (serverUrl === "" || dashboardUrl === "")
        return serverUrl;
    try {
        const url = new URL(serverUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:")
            return serverUrl;
    }
    catch {
        return serverUrl;
    }
    const rest = serverUrl.replace(/^https?:\/\/[^/?#]*/i, "");
    return `${dashboardUrl.replace(/\/+$/, "")}${rest}`;
}
export function customerStageIsWorking(stage) {
    return (stage === "waiting" ||
        stage === "planning" ||
        stage === "drawing" ||
        stage === "filming" ||
        stage === "editing");
}
export const VOICE_RETRY_COST = "it costs only cents";
function filmingSentence(run) {
    const scenes = run.scenes ?? [];
    const voice = scenes.filter((s) => s.clip?.voiceRetrying).map((s) => s.sceneIndex);
    if (voice.length === 0)
        return WORKING_SENTENCE.filming;
    const names = voice.length === 1 ? `scene ${voice[0]}'s voice` : `the voices of scenes ${voice.slice(0, -1).join(", ")} and ${voice.at(-1)}`;
    const filming = scenes.some((s) => (s.clip?.status === "generating" || s.clip?.status === "queued") && !s.clip.voiceRetrying);
    return filming
        ? `${WORKING_SENTENCE.filming} We're also changing ${names} again on the clip${voice.length === 1 ? " it has" : "s they have"}; nothing is filmed for ${voice.length === 1 ? "it" : "them"}.`
        : `Changing ${names} again on the clip${voice.length === 1 ? " it already has" : "s they already have"}. Nothing is filmed.`;
}
const WORKING_SENTENCE = {
    planning: "Planning your video: reading your script and planning each scene.",
    drawing: "Drawing your scenes. Each one is drawn before filming starts.",
    filming: "Filming your scenes. Each scene is being turned into a video clip.",
    editing: "Putting it all together. Your clips are being joined into one video.",
};
function waitingSentence(waiting) {
    const ahead = waiting?.ahead ?? 0;
    const start = waiting && waiting.stepsDone > 0 ? "Waiting to continue." : "Waiting to start.";
    const line = ahead > 0 ? ` ${ahead} ${ahead === 1 ? "video is" : "videos are"} ahead of this one.` : "";
    return `${start}${line} It starts as soon as a spot opens.`;
}
function stoppedLines(run, page) {
    const reason = run.stopReason;
    if (reason?.kind === "out-of-credits") {
        return [
            "Video making is paused on our side. Our video service ran out of credits partway through this video. This isn't anything you did, and the team has been told.",
            `Once it's back, try again from the video's page: ${page}`,
        ];
    }
    if (reason?.kind === "openrouter-out-of-credits") {
        return [
            "Your OpenRouter balance is too low to finish this video.",
            "Add credits to your OpenRouter account at openrouter.ai, then try again from the video's page. The OpenRouter key this video uses is in Settings → API Keys.",
        ];
    }
    if (reason?.kind === "plan-too-big") {
        return [
            "This video's plan came out too big to make in one go.",
            `Try again from the video's page and it will be planned fresh: ${page} If it stops here again, try a shorter script.`,
        ];
    }
    if (reason?.kind === "plan-rejected") {
        return [
            "This video's plan didn't pass our checks.",
            `Try again from the video's page: ${page} If it stops here again, try a shorter script or another kind of ad.`,
        ];
    }
    if (reason?.kind === "keys-missing") {
        return [
            `This video stopped because ${reason.keys.length === 1 ? "a key is" : "some keys are"} missing (${reason.keys.join(", ")}).`,
            `Add ${reason.keys.length === 1 ? "it" : "them"} in Settings → API Keys, then try again from the video's page.`,
        ];
    }
    if (reason?.kind === "stop-sentence") {
        return [
            "Here's why this video stopped.",
            reason.sentence,
            run.canRetry ? `Try again from the video's page: ${page}` : "Start a new one from the Video page.",
        ];
    }
    if (run.cutFailure && run.canCutAgain) {
        return [
            "The final cut didn't work.",
            run.cutFailure.sentence,
            `All your clips are done. Cut again from the video's page; it makes no new clips and costs nothing: ${page}`,
        ];
    }
    return run.canRetry
        ? ["Something went wrong making this video.", `Try again from the video's page: ${page}`]
        : ["Something went wrong making this video. Start a new one from the Video page."];
}
const FOR_GOOD = "It can't be undone; a change after it is a new run.";
export function finalApproveLines(template) {
    return [
        template ? "Approving makes this cut the run's finished video." : `Approving makes this cut the run's finished video. ${FOR_GOOD}`,
        "Nothing is posted to an ad account; the video stays on its page.",
    ];
}
export function finalApprovedLines(template) {
    return [
        template ? "Approved. This cut is now the run's finished video." : `Approved. This cut is now the run's finished video. ${FOR_GOOD}`,
        "Nothing is posted to an ad account. The video stays on its page, and exodus video pull saves it.",
    ];
}
export function customerStageLines(run, page) {
    const id = run.runId;
    const audition = run.templateApproval?.audition;
    if (audition)
        return [
            `Audition held: planned scenes ${audition.sceneIndexes.join(", ")}. Watch their clips on ${page}`,
            audition.invalidated ? "The bound inputs changed. Start a new run; the remaining batch was not ordered."
                : audition.retryBlocked ? AUDITION_RESTART_REASON
                    : audition.ready ? `Accept only after watching: exodus video approve ${id} --audition ${audition.digest}`
                        : `Approve another paid attempt for failed audition takes only: exodus video approve ${id}. Completed takes are kept; the remaining batch stays held.`,
        ];
    switch (run.stage) {
        case "waiting":
            return [waitingSentence(run.waiting), ...waitingSceneLines(run, page)];
        case "filming":
            return [filmingSentence(run), ...waitingSceneLines(run, page)];
        case "planning":
        case "drawing":
        case "editing":
            return [WORKING_SENTENCE[run.stage], ...waitingSceneLines(run, page)];
        case "picking":
            return ["This video is waiting for its picks: a face, a voice and a room for each part. The team makes them for now."];
        case "pilot":
            return [
                "Your pilot clip is being checked: one clip is made first, so a wrong voice or face is caught before the others are made. The team checks it, and redoes it if needed, before the others are made.",
                `Watch it here: ${page}`,
            ];
        case "review":
            if (run.planHold?.acceptFindings) {
                return [
                    ...(run.planHold.notes?.length ? run.planHold.notes : ["The app's check found a problem with this plan."]),
                    ...findingLines(run.planHold.findings),
                    ...stopPictureText(stopPictureLines(run, page).filter((picture) => picture.drawn)),
                    ...noPhotoLines(run),
                    ...endCardLines(run.endCard, id, page),
                    `Read it:      exodus video storyboard ${id}`,
                    acceptFindingsLine(id),
                    `If the check is right, stop this video on its page and start a new one with your script changed: ${page}`,
                ];
            }
            const pictures = noPictureBeforeApproval(run) ? stopPictureLines(run, page) : [];
            const card = run.endCard?.state === "ready" ? ["end card"] : [];
            if (pictures.length > 0) {
                return [
                    `Your ${listedWords(["script", ...pictures.map((picture) => picture.noun), ...card, "voice"])} are waiting for your yes. No take is filmed before you approve.`,
                    ...stopPictureText(pictures),
                    ...noPhotoLines(run),
                    ...endCardLines(run.endCard, id, page),
                    ...extraShotLines(run, id),
                    `Read them:    exodus video storyboard ${id}`,
                    `Approve them: exodus video approve ${id}`,
                ];
            }
            if (noPictureBeforeApproval(run)) {
                return [
                    card.length > 0
                        ? "Your script, end card and voice are waiting for your yes. No take gets a picture before you approve."
                        : "Your script and voice are waiting for your yes. No take gets a picture before you approve.",
                    ...noPhotoLines(run),
                    ...endCardLines(run.endCard, id, page),
                    ...extraShotLines(run, id),
                    `Read them:    exodus video storyboard ${id}`,
                    `Approve them: exodus video approve ${id}`,
                ];
            }
            return [
                "Your storyboard is ready for your review.",
                ...songNoticeLines(run.songNotice),
                `See it:      exodus video storyboard ${id}`,
                ...(songCallsProblem(run.songCalls) ? [] : [`Approve it:  exodus video approve ${id}`]),
                ...songCallStopLines(run.songCalls, page),
            ];
        case "ready":
            return [
                ...(run.awaitingSignOff
                    ? [
                        "Your video is ready to watch.",
                        ...waitingSceneLines(run, page),
                        waitingSceneLines(run, page).length > 0
                            ? `Once each one is answered and you're happy with the video, finish it:  exodus video approve ${id}`
                            : `When you're happy with it, finish it:  exodus video approve ${id}`,
                    ]
                    : ["Your video is ready."]),
                ...speechSummaryLines(run.video?.speech),
                ...(run.video?.notes ?? []),
                ...(run.video?.endCard ? [run.video.endCard.line] : []),
                ...(run.video?.wordsOff
                    ? ["Some words may not match your script exactly. Watch it through before you post it."]
                    : []),
                ...(run.awaitingSignOff && waitingSceneLines(run, page).length === 0 ? finalApproveLines(run.template === true) : []),
                `Download the pieces for your own cut: exodus video pull ${id} --out ./video-${id}`,
            ];
        case "failed":
            return run.cutHolds?.length ? heldLines(run, page) : stoppedLines(run, page);
        case "cancelled":
            return ["This video was stopped."];
    }
}
export function customerStatusLines(run, dashboardUrl) {
    const page = customerRunPage(dashboardUrl, run.runId);
    return [
        `Video ${run.runId}: ${run.title}`,
        ...(run.card ? [`${run.card.conceit}, ${run.card.style}`] : []),
        run.mode === "guided" ? "Storyboard first" : "In one go",
        "",
        ...customerStageLines(run, page),
        ...(run.spend ? [run.spend.line, ...(run.spend.storyboardEstimate ? [run.spend.storyboardEstimate.sentence] : [])] : []),
        ...spendAskLines(run, run.runId),
        ...(run.scenes ?? []).flatMap(scene => scene.clip?.speech
            ? [`Scene ${scene.sceneIndex} speech:`, ...speechSummaryLines(scene.clip.speech).map(line => `  ${line}`)] : []),
        "",
        `Watch it on the dashboard: ${page}`,
    ];
}
function sceneLines(scene) {
    const lines = [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`];
    if (scene.frameStatus === "ready" && scene.imageUrl)
        lines.push("    picture: drawn");
    else if (scene.frameStatus === "failed")
        lines.push("    picture: couldn't be drawn");
    else
        lines.push("    picture: drawing…");
    if (scene.frameStatus === "ready" && scene.productNote)
        lines.push(`    ${scene.productNote}`);
    return lines;
}
export function customerStoryboardLines(board, page, songCalls) {
    const id = board.runId;
    const notice = songNoticeLines(board.songNotice);
    if (board.stage !== "review" || !board.scenes) {
        return [
            "This video isn't waiting for you to review its storyboard right now.",
            `Check where it is: exodus video status ${id}`,
        ];
    }
    const scriptLines = (scenes) => scenes.flatMap((scene) => [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`]);
    const found = board.findings?.length ? ["", "What the app's check found:", ...findingLines(board.findings)] : [];
    const approve = board.findings?.length ? acceptFindingsLine(id) : `approve with: exodus video approve ${id}`;
    if (board.noPictureBeforeApproval) {
        return [
            "Script",
            ...scriptLines(board.scenes),
            ...found,
            ...storyboardPictureLines(board.pictures, page),
            ...storyboardNoPhotoLines(board),
            ...storyboardEndCardLines(board, page),
            ...hardWordLines(board.hardWords),
            ...openingLines(board.openings, id, board.openingsDigest, (board.findings?.length ?? 0) > 0),
            "",
            "No take gets a picture before you approve.",
            approve,
            `pick voices: exodus video voices ${id}`,
        ];
    }
    if (board.beforePictures) {
        return [
            "Storyboard",
            ...scriptLines(board.scenes),
            ...found,
            ...hardWordLines(board.hardWords),
            ...storyboardNoPhotoLines(board),
            ...storyboardEndCardLines(board, page),
            "",
            "No scene pictures are drawn before you approve. Any pictures of the people or the place were drawn already, inside the price you were shown.",
            approve,
            ...(board.filmsCalls ? [] : [`pick voices: exodus video voices ${id}`]),
        ];
    }
    if (board.filmsCalls) {
        const listed = isObject(songCalls) && Array.isArray(songCalls.calls);
        const problem = isObject(songCalls) && typeof songCalls.problem === "string" ? songCalls.problem : null;
        return [
            "Storyboard",
            ...board.scenes.flatMap((scene) => [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`]),
            "",
            ...notice,
            SONG_CALL_NO_SCENE_PICTURES,
            listed
                ? `See the pictures each video call is filmed from: exodus video status ${id}`
                : problem ?? "No picture a video call is filmed from is listed yet.",
            SONG_CALL_NO_ONE_SCENE,
            `approve with: exodus video approve ${id}`,
        ];
    }
    const stillDrawing = board.scenes.some((s) => s.frameStatus === "pending" || s.frameStatus === "drawing");
    return [
        "Storyboard",
        ...board.scenes.flatMap(sceneLines),
        ...hardWordLines(board.hardWords),
        ...storyboardNoPhotoLines(board),
        "",
        ...notice,
        stillDrawing
            ? "Waiting for every scene to finish drawing before you can approve."
            : `approve with: exodus video approve ${id}`,
        `redo one scene's picture: exodus video retry-frame ${id} --scene <n>`,
        `pick voices: exodus video voices ${id}`,
        `See the pictures: ${page}`,
    ];
}
export function customerVoicesLines(voices) {
    const lines = [`Voices for video ${voices.runId}`];
    if (voices.cast.length === 0)
        lines.push("  Nobody speaks in this video yet.");
    for (const member of voices.cast) {
        const voice = member.voice
            ? `${member.voice.name ?? "a voice you picked"} (${member.voice.voiceId})`
            : "no voice chosen yet";
        lines.push(`  ${member.characterId}  ${member.name}  ${voice}`);
    }
    if (voices.canChange) {
        lines.push("", voices.options.length > 0 ? "Voices you can pick:" : "Your ElevenLabs account has no voices to pick from.");
        for (const option of voices.options) {
            lines.push(`  ${option.voiceId}  ${option.name}${option.description ? `: ${option.description}` : ""}`);
        }
        lines.push("", `Pick one: exodus video voices ${voices.runId} --set <character>=<voiceId>`, "You can change voices until you approve the storyboard.");
    }
    else {
        lines.push("", voices.whyNot ?? "Voices can no longer be changed on this video.");
    }
    return lines;
}
