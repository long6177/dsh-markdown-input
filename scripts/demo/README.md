# Demo asset recorder

Re-records the README demo assets under [`docs/assets/`](../../docs/assets) by
driving a real `dsh web` instance with headless Edge (Playwright). Everything
captured is synthetic — a neutral `markdown-demo` workspace, scripted demo
text, a throwaway browser profile — so re-recording never leaks private
content.

| file | role |
|---|---|
| `record.mjs` | boots nothing itself; drives the app and captures the hero GIF frames + static shots into a scratch run directory |
| `encode.mjs` | turns a run directory into the committed `docs/assets/` artifacts (pure JS: `pngjs` + `gifenc`, no ffmpeg/Python) |
| `manifest.json` (in a run dir) | storyboard description — frame files and per-frame GIF durations |

Artifacts produced (committed at `docs/assets/`):

| artifact | spec |
|---|---|
| `hero-markdown-composer.gif` | 8 frames, 720px wide, ~11s, well under 10MB, loops forever |
| `render-vs-source.png` | render mode vs source mode, stacked, 2x |
| `paste-conversion.png` | rich text (before) over converted Markdown (after), 2x |
| `bubble-markdown.png` | the rendered user bubble, 2x |

## Re-recording

Prerequisites: Node 22+/24, pnpm, Edge installed (Playwright uses
`channel: 'msedge'` — no browser download), the `dsh` CLI
(`@deepseek-ai/dsh`). All commands from this directory unless stated.

1. Build the plugin from the repo root (the profile links the repo directly,
   so the server serves the current build):

   ```sh
   pnpm run build        # repo root
   ```

2. Create a scratch profile under a scratch `DSH_HOME` (never point this at
   your real `%USERPROFILE%\.dsh`). The profile is one-time setup:

   ```sh
   export DSH_HOME=/tmp/dsh-demo-assets/home   # any scratch path
   dsh demo --from-default-profile web         # creates + boots; Ctrl+C after it starts
   dsh plugin --profile demo add <path-to-this-repo>
   ```

3. Boot the server and copy the tokenized URL it prints (the app rejects a
   bare `localhost` — the token is required):

   ```sh
   DSH_HOME=/tmp/dsh-demo-assets/home dsh demo --no-open --port 3080
   # dsh web: http://127.0.0.1:3080/?token=...
   ```

   A real API key is never needed: the only "send" happens at the very end of
   the recording and the capture stops before the model round can answer (the
   upstream e2e convention `DEEPSEEK_API_KEY=keyless-default-web-no-call`
   matches this setup).

4. Record, then encode:

   ```sh
   npm install            # first time only (playwright-core, pngjs, gifenc)
   node record.mjs "http://127.0.0.1:3080/?token=..." --out /tmp/dsh-demo-assets/run
   node encode.mjs /tmp/dsh-demo-assets/run
   ```

   `record.mjs` asserts the editor content in source mode and the pasted
   Markdown, and fails loudly instead of capturing a broken state.
   `encode.mjs` prints spec checks (width ≤ 1000px, duration 8–15s, < 10MB)
   and exits non-zero when a check fails.

5. **Eyeball the output before committing** — the run directory keeps every
   PNG frame plus `qa-sheet.png` (all hero frames in one strip). Check that
   the text is readable, the render actually forms, and nothing private
   appears. Only then commit `docs/assets/`.

### Resetting between runs

The app mirrors the typed draft and keeps the session, so a second recording
against the same server would show stale chat content. Reset before re-running:

```sh
rm -rf "$DSH_HOME/sessions" "$DSH_HOME"/home/storages/session_projcache 2>/dev/null
# then restart the server
```

(On the recording machine used for the current assets the paths were
`%TEMP%\dsh-demo-60\home\…`; any scratch location works.)

## screenshots.json

The repo-root [`screenshots.json`](../../screenshots.json) lists the same
artifacts for awesome-list style consumption (paths relative to the repo
root). Keep it in sync with `docs/assets/` when re-recording.
