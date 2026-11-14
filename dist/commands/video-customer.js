import { speechIssueText } from "../lib/speechIssueText.js";
import { AUDITION_RESTART_REASON } from "../lib/template-audition.js";
export function speechSummaryLines(speech) {
    if (!speech)
        return [];
    const labels = { verbatim: "Verbatim", "accepted-with-speech-issue": "Accepted with speech issue",
        "speech-issue": "Speech issue — review required", unverified: "Speech not verified" };
    return [labels[speech.status], ...speech.issues.map(speechIssueText)];
}
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
    const takes = scenes.filter((s) => s.take);
    const faults = scenes.filter((s) => !s.take);
    return [
        head,
        ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
        ...takes.map((s) => takes.length === 1
            ? `Keep it as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`
            : `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
        ...(faults.length > 0
            ? [
                `${faults.length === 1 ? "Make it again" : "Make each one again"}, or keep it as it is, on the video's page: ${page}`,
                ...faults.map((s) => `Or keep ${faults.length === 1 ? "it" : `scene ${s.sceneIndex}`} as it is from here: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
            ]
            : [`${takes.length === 1 ? "Watch it first:  " : "Watch them first:"} ${page}`]),
    ];
}
export function customerAnswer(data) {
    return typeof data === "object" && data !== null && data.view === "customer"
        ? data
        : null;
}
export function customerRunPage(dashboardUrl, runId) {
    return `${dashboardUrl}/video/runs/${runId}`;
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
    return run.canRetry
        ? ["Something went wrong making this video.", `Try again from the video's page: ${page}`]
        : ["Something went wrong making this video. Start a new one from the Video page."];
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
            return [waitingSentence(run.waiting)];
        case "planning":
        case "drawing":
        case "filming":
        case "editing":
            return [WORKING_SENTENCE[run.stage]];
        case "picking":
            return ["This video is waiting for its picks: a face, a voice and a room for each part. The team makes them for now."];
        case "pilot":
            return [
                "Your pilot clip is being checked: one clip is made first, so a wrong voice or face is caught before the others are made. The team checks it, and redoes it if needed, before the others are made.",
                `Watch it here: ${page}`,
            ];
        case "review":
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
                        `When you're happy with it, finish it:  exodus video approve ${id}`,
                    ]
                    : [`Your video is ready: ${run.video?.url ?? page}`]),
                ...speechSummaryLines(run.video?.speech),
                ...(run.video?.notes ?? []),
                ...(run.video?.wordsOff
                    ? ["Some words may not match your script exactly. Watch it through before you post it."]
                    : []),
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
