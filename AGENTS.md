# Agent Handoff Notes

This repository is a local Vite/React + Node app for creating audio chops from YouTube URLs.

## Before Changing Code

- Run `git status -sb` first. The user often asks for commit/push checkpoints between UX iterations.
- Preserve local audio output under `data/`; it is runtime data and ignored by Git.
- Prefer small, focused changes. The app is intentionally a quick local studio utility, not a SaaS dashboard.

## Core Commands

```bash
yarn dev
yarn build
```

`yarn dev` starts:

- API: `http://localhost:4174`
- Vite: `http://localhost:5173`

## Architecture Map

- `server/index.js`: Express API. Runs `yt-dlp`, `ffmpeg`, and `ffprobe`. Stores files in `data/jobs`.
- `src/App.tsx`: Main UI and state. Owns WaveSurfer, RegionsPlugin, timeline ruler, zoom, shortcuts, undo, download polling, export actions.
- `src/styles.css`: Layout and visual polish.
- `docs/context.md`: Longer project context and known gotchas.

## UX Principles

- Keep the waveform as the primary surface.
- Prefer direct manipulation over typing times.
- Keep controls dense, aligned, and stable.
- Avoid adding explanatory in-app copy unless it directly helps the workflow.
- Keyboard shortcuts should not fire while typing in inputs.

## Known Fragile Areas

- Waveform sizing: do not observe the WaveSurfer-rendered output and feed that directly back into `setOptions({ height })`; it can create an infinite growth loop.
- Timeline ruler: it is custom React UI synced from WaveSurfer `scroll`, `zoom`, `redraw`, and `resize` events. Avoid reintroducing the TimelinePlugin unless the scroll alignment bug is solved.
- Loop playback: use the current active region each time playback crosses the region end, so resizing a playing region uses the latest end time.
- Undo: scoped to chop edits only, via region snapshots. It intentionally does not undo downloads or exports.

## Validation

At minimum, run:

```bash
yarn build
```

For UI changes, also run `yarn dev` and inspect `http://localhost:5173`.
