# Game repo conventions

This repository is ONE mobile game, generated from `andy2great/game-template`
by the « Usine à jeux » factory. Several autonomous agents (developer,
reviewer, QA, asset designer) work here in parallel. These rules keep them
from stepping on each other.

## The game

- Phone-first: portrait orientation, touch input only (`pointerdown`), no
  keyboard, no mouse hover. Everything must be reachable with one thumb.
- No external assets and no network calls: draw with canvas/SVG code, generate
  sound with WebAudio. The repo must stay self-contained.
- Core logic lives in `src/game.ts` (and new files next to it) and must stay
  free of DOM globals so it is unit-testable. Only `src/main.ts` touches the
  canvas element.
- `docs/concept.md` is the source of truth for gameplay; `docs/mockups/` shows
  the intended look.

## npm script contract (never break these)

- `npm run dev` — local dev server
- `npm run build` — type-check + production build (must stay green)
- `npm test` — unit tests (must stay green)

## Workflow rules (hard rules)

- Branch naming: `feat/<issue-number>-<slug>` or `fix/<issue-number>-<slug>`.
- Before pushing: `git pull --rebase origin main` (other agents merge while
  you work), then run `npm test` and `npm run build` locally.
- PR body must start with `Fixes #<issue-number>`.
- NEVER push to `main`. NEVER merge a PR — the factory merges after review.
- NEVER edit `.github/` (CI is owned by the factory) or `CLAUDE.md`.
- Keep the diff minimal: implement exactly the ticket, no drive-by refactors,
  no dependency additions unless the ticket requires them.
- You may update `appName` in `capacitor.config.ts` to the game title, but do
  not change `appId` or `webDir`.

## CI (owned by the factory)

- `web-deploy.yml`: every merge to main deploys to GitHub Pages
  (`https://andy2great.github.io/<repo>/`).
- `android-apk.yml`: a `v*` tag builds a debug APK and attaches it to a
  GitHub Release. The factory creates tags — never tag manually.
