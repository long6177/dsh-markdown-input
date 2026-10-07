/**
 * Committed snapshot of the @deepseek-ai/dsh-client-locale `en` dictionary
 * (common namespace) — the host copy the locale-facing tests
 * assert against in published mode, where the npm tarball ships no `src/`.
 *
 * Mirrors: `packages/client/locale/src/locales/en.ts` in the upstream checkout (default tag:
 * `dsh-v0.2.0-rc.2`). Values are verified against the checkout by the
 * fidelity contract test (`tests/host-locale-fidelity.test.ts`) on every
 * run with the source available. Regenerate after a verified upstream
 * bump: `node scripts/dev-harness.mjs snapshot` (ADR-0007).
 */
export const commonEn: Record<string, string> = {
  "ok": "OK",
  "cancel": "Cancel",
  "close": "Close",
  "copy": "Copy",
  "copied": "Copied",
  "codeBlock.title": "Code block",
  "codeBlock.wrap": "Wrap lines",
  "codeBlock.unwrap": "Do not wrap lines",
  "copy.failed": "Copy failed",
  "copy.value": "Copy value",
  "copy.json": "Copy JSON",
  "copy.path": "Copy property path",
  "copy.prettyJson": "Copy pretty JSON",
  "copy.compactJson": "Copy compact JSON",
  "copy.optionsHint": "{action}; right-click for copy options",
  "retry": "Retry",
  "loading": "Loading…",
  "load.failed": "Failed to load",
  "submit": "Submit",
  "submitting": "Submitting…",
  "next": "Next",
  "previous": "Previous",
  "skip": "Skip",
  "delete": "Delete",
  "edit": "Edit",
  "save": "Save",
  "search": "Search",
  "more": "More",
  "collapse": "Collapse",
  "expand": "Expand",
  "back": "Back",
  "brand.localBuild": "DSH Local Build",
  "workspace.defaultName": "Default workspace",
  "unknown": "Unknown",
  "none": "None",
  "truncated": "Truncated",
  "json.label": "JSON",
  "markdown.footnotes": "Footnotes",
  "markdown.truncatedCharacters": "… truncated at {total} characters",
  "number.thousand": "{value}K",
  "number.million": "{value}M"
}
