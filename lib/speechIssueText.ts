import type { SpeechSummary } from "../commands/video-customer.js";

/** Shared member-safe wording; kept inside the independently shipped CLI's source tree. */
export function speechIssueText(issue: SpeechSummary["issues"][number]): string {
  const span = issue.operation === "delete"
    ? `Missing “${issue.expected.text}” (script words ${issue.expected.startWord + 1}–${issue.expected.endWord}, heard-word boundary ${issue.heard.startWord}).`
    : `${issue.repeated ? "Repeated" : "Extra"} “${issue.heard.text}” (heard words ${issue.heard.startWord + 1}–${issue.heard.endWord}, script-word boundary ${issue.expected.startWord}).`;
  const time = issue.heard.startSec !== undefined && issue.heard.endSec !== undefined
    ? ` ${issue.heard.startSec.toFixed(2)}–${issue.heard.endSec.toFixed(2)}s in the clip.` : "";
  return `${issue.sceneIndex !== undefined ? `Scene ${issue.sceneIndex}: ` : ""}${span}${time}`;
}
