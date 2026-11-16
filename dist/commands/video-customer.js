import { speechIssueText } from "../lib/speechIssueText.js";
import { AUDITION_RESTART_REASON } from "../lib/template-audition.js";
export function speechSummaryLines(speech) {
    if (!speech)
        return [];
    const labels = { verbatim: "Verbatim", "accepted-with-speech-issue": "Accepted with speech issue",
        "speech-issue": "Speech issue — review required", unverified: "Speech not verified" };
    return [labels[speech.status], ...speech.issues.map(speechIssueText)];
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
    const price = tryAgainPrice(run, scenes.filter((s) => !s.take).map((s) => s.sceneIndex));
    return [
        ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
        price ? `On the video's page, Try again costs ${price}: ${page}` : `The video's page: ${page}`,
        ...scenes
            .filter((s) => !s.unfilmed)
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
    const faults = scenes.filter((s) => !s.take && !s.unfilmed);
    const inParens = (price) => (price ? ` (${price})` : "");
    const unfilmedPrice = inParens(tryAgainPrice(run, unfilmed.map((s) => s.sceneIndex)));
    const faultPrice = inParens(tryAgainPrice(run, faults.map((s) => s.sceneIndex)));
    return [
        ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
        ...(unfilmed.length > 0
            ? [`${unfilmed.length === 1 ? "Film it" : "Film each one"} with Try again on the video's page, which shows the price first${unfilmedPrice}: ${page}`]
            : []),
        ...takes.map((s) => takes.length === 1
            ? `Keep it as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`
            : `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
        ...(faults.length > 0
            ? [
                `${faults.length === 1 ? "Make it again" : "Make each one again"} with Try again, or keep it as it is, on the video's page. Try again shows the price first${faultPrice}: ${page}`,
                ...faults.map((s) => `Or keep ${faults.length === 1 ? "it" : `scene ${s.sceneIndex}`} as it is from here: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
            ]
            : []),
        ...(takes.length > 0 && faults.length === 0 && unfilmed.length === 0
            ? [`${takes.length === 1 ? "Watch it first:  " : "Watch them first:"} ${page}`]
            : []),
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
        case "planning":
        case "drawing":
        case "filming":
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
                    ...(run.place?.imageUrl ? [`The place:    ${run.place.imageUrl}`] : []),
                    `Read it:      exodus video storyboard ${id}`,
                    acceptFindingsLine(id),
                    `If the check is right, stop this video on its page and start a new one with your script changed: ${page}`,
                ];
            }
            if (noPictureBeforeApproval(run) && run.place) {
                return [
                    "Your script, place and voice are waiting for your yes. No take is filmed before you approve.",
                    run.place.imageUrl
                        ? `The place:    ${run.place.imageUrl}`
                        : "The picture of the place didn't come out. It is drawn when you approve, before the takes are filmed.",
                    `Read them:    exodus video storyboard ${id}`,
                    `Approve them: exodus video approve ${id}`,
                ];
            }
            if (noPictureBeforeApproval(run)) {
                return [
                    "Your script and voice are waiting for your yes. No take gets a picture before you approve.",
                    `Read them:    exodus video storyboard ${id}`,
                    `Approve them: exodus video approve ${id}`,
                ];
            }
            return [
                "Your storyboard is ready for your review.",
                `See it:      exodus video storyboard ${id}`,
                `Approve it:  exodus video approve ${id}`,
            ];
        case "ready":
            return [
                ...(run.awaitingSignOff
                    ? [
                        `Your video is ready to watch: ${run.video?.url ?? page}`,
                        ...waitingSceneLines(run, page),
                        waitingSceneLines(run, page).length > 0
                            ? `Once each one is answered and you're happy with the video, finish it:  exodus video approve ${id}`
                            : `When you're happy with it, finish it:  exodus video approve ${id}`,
                    ]
                    : [`Your video is ready: ${run.video?.url ?? page}`]),
                ...speechSummaryLines(run.video?.speech),
                ...(run.video?.notes ?? []),
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
        lines.push(`    picture: ${scene.imageUrl}`);
    else if (scene.frameStatus === "failed")
        lines.push("    picture: couldn't be drawn");
    else
        lines.push("    picture: drawing…");
    if (scene.frameStatus === "ready" && scene.productNote)
        lines.push(`    ${scene.productNote}`);
    return lines;
}
export function customerStoryboardLines(board) {
    const id = board.runId;
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
            "",
            "No scene pictures are drawn before you approve. Any pictures of the people or the place were drawn already, inside the price you were shown.",
            approve,
            `pick voices: exodus video voices ${id}`,
        ];
    }
    const stillDrawing = board.scenes.some((s) => s.frameStatus === "pending" || s.frameStatus === "drawing");
    return [
        "Storyboard",
        ...board.scenes.flatMap(sceneLines),
        "",
        stillDrawing
            ? "Waiting for every scene to finish drawing before you can approve."
            : `approve with: exodus video approve ${id}`,
        `redo one scene's picture: exodus video retry-frame ${id} --scene <n>`,
        `pick voices: exodus video voices ${id}`,
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
