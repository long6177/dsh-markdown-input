# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues at the repo's remote (`long6177/dsh-markdown-input`), managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical role labels are used as-is: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Release publishing

`npm publish` on the `0.2.0-alpha.x` line always carries two flags — official registry + `--tag latest` — plus the release-commit/checklist ritual and the post-publish lag checks (dist-tags CDN, npmmirror sync). See `docs/agents/release.md`.
