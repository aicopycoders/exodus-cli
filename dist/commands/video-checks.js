import { videoApiError } from "./video.js";
export const CHECKS_PATH = "/api/v2/video/checks";
export const NO_CHECK_ANSWERS = "No check answers are saved for this video.";
export const MORE_CHECK_ANSWERS = "This video has more check answers than one read shows; these are the first.";
const FOLLOWS = {
    note: "a note only",
    fix: "a fix by code",
    redo: "made again",
    hold: "held for a person",
};
const FAULT_WITHOUT_SENTENCE = {
    note: "A note of our checks.",
    fix: "Our checks fixed this.",
    redo: "Our checks had this made again.",
    hold: "Our checks held this.",
};
const UNKNOWN_DOES = {
    "go-on": "the video goes on",
    hold: "held for a person",
    "leave-out": "left out, and the video goes on",
};
const UNKNOWN_WHY = {
    "no-answer": "no answer came",
    lost: "the answer was lost",
    "cannot-tell": "it could not tell",
    "could-not-run": "the check could not run",
};
const UNMEASURED_WHY = {
    "switched-off": "switched off",
    "not-needed": "not needed",
};
function wordsFor(table, value) {
    const key = String(value);
    return Object.hasOwn(table, key) ? table[key] : key;
}
function sentence(text) {
    const trimmed = text.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
function faultLine(fault) {
    const follows = fault.follows ?? fault.onFail?.do;
    const id = fault.fault ? `[${fault.fault}] ` : "";
    if (fault.say)
        return `      - ${id}${sentence(fault.say)} Follows: ${wordsFor(FOLLOWS, follows)}.`;
    const plain = Object.hasOwn(FAULT_WITHOUT_SENTENCE, String(follows)) ? FAULT_WITHOUT_SENTENCE[String(follows)] : null;
    return `      - ${id}${plain ?? `Our checks found something; what follows: ${String(follows)}.`}`;
}
function fixEnded(answer) {
    if (answer.status !== "fail" || answer.check === "runner")
        return false;
    if (answer.fixEnded === true)
        return true;
    return answer.by === "runner";
}
function faultLines(faults) {
    return (Array.isArray(faults) ? faults : []).filter((fault) => typeof fault === "object" && fault !== null).map(faultLine);
}
function answerLines(answer) {
    if (fixEnded(answer) && answer.status === "fail") {
        return [`    ${answer.check} (attempt ${answer.attempt}), how its fix ended:`, ...faultLines(answer.faults)];
    }
    const head = `    ${answer.check} (attempt ${answer.attempt}):`;
    switch (answer.status) {
        case "pass":
            return [`${head} pass`];
        case "fail":
            return [`${head} fail`, ...faultLines(answer.faults)];
        case "unknown": {
            const said = answer.say ? ` ${sentence(answer.say)}` : "";
            return [`${head} unknown, ${wordsFor(UNKNOWN_WHY, answer.why)}.${said} Follows: ${wordsFor(UNKNOWN_DOES, answer.does)}.`];
        }
        case "unmeasured":
            return [`${head} not measured, ${wordsFor(UNMEASURED_WHY, answer.why)}`];
        case "not-applicable":
            return [`${head} does not apply`];
        case "not-finished":
            return [`${head} not finished in this leg; the item waits for the next`];
        default:
            return [`${head} ${String(answer.status)}`];
    }
}
export function checkAnswerLines(runId, answers, more = false) {
    if (answers.length === 0)
        return [NO_CHECK_ANSWERS];
    const lines = [`Check answers for video ${runId}:`];
    let station = null;
    let item = null;
    for (const answer of answers) {
        if (answer.station !== station) {
            station = answer.station;
            item = null;
            lines.push("", `Station: ${station}`);
        }
        if (answer.item !== item) {
            item = answer.item;
            lines.push(`  Item ${item}`);
        }
        lines.push(...answerLines(answer));
    }
    if (more)
        lines.push("", MORE_CHECK_ANSWERS);
    return lines;
}
export function summaryCountLine(summary) {
    const when = summary.delivered === false ? "so far" : "on this video";
    if (summary.more)
        return `At least ${summary.ran} ${summary.ran === 1 ? "check" : "checks"} ran ${when}.`;
    const parts = [`${summary.passed} passed`];
    if (summary.noted > 0)
        parts.push(`${summary.fixed + summary.noted} fixed or noted`);
    else if (summary.fixed > 0)
        parts.push(`${summary.fixed} fixed for you`);
    if (summary.look > 0)
        parts.push(`${summary.look} ${summary.look === 1 ? "needs" : "need"} your look`);
    if (summary.kept > 0)
        parts.push(`${summary.kept} kept by you`);
    return `${summary.ran} ${summary.ran === 1 ? "check" : "checks"} ran ${when}: ${parts.join(", ")}.`;
}
const KIND_ORDER = ["look", "kept", "fixed", "noted"];
export function summaryLines(runId, summary) {
    if (!summary || !(summary.ran > 0))
        return [NO_CHECK_ANSWERS];
    const items = Array.isArray(summary.items) ? summary.items : [];
    const ordered = [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const lines = [`Checks of video ${runId}: ${summaryCountLine(summary)}`];
    if (ordered.length > 0 || summary.passed > 0)
        lines.push("");
    const others = Array.isArray(summary.others) ? summary.others : [];
    for (const item of ordered) {
        const scene = item.kind === "look" && typeof item.scene === "number" ? `Scene ${item.scene}: ` : "";
        const other = scene && ordered.find((i) => i.kind === "look" && i.scene === item.scene) === item ? others.find((o) => o.scene === item.scene)?.text : null;
        lines.push(`  ${scene}${item.title} ${item.text}${other ? ` ${other}` : ""}`);
    }
    if (summary.passed > 0) {
        lines.push(summary.more ? "  Other checks passed." : `  ${summary.passed} ${ordered.length > 0 ? "other " : ""}${summary.passed === 1 ? "check" : "checks"} passed.`);
    }
    return lines;
}
export async function checksFlow(runId, json, deps) {
    const res = await deps.get(`${CHECKS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok) {
        const line = videoApiError(res);
        return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error: line })] : [line] };
    }
    const body = res.data;
    if (body?.view === "member" && body.summary !== undefined && (body.summary === null || typeof body.summary === "object")) {
        const summary = body.summary;
        if (json)
            return { code: 0, lines: [JSON.stringify({ runId, summary })] };
        return { code: 0, lines: summaryLines(runId, summary) };
    }
    const answers = body?.results;
    if (!Array.isArray(answers)) {
        const line = "The server's answer had no list of check answers. Try again in a minute.";
        return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: line })] : [line] };
    }
    const more = body?.more === true;
    if (json)
        return { code: 0, lines: [JSON.stringify({ runId, results: answers, ...(more ? { more: true } : {}) })] };
    const shown = answers.filter((answer) => typeof answer === "object" && answer !== null);
    return { code: 0, lines: checkAnswerLines(runId, shown, more) };
}
