# Sample Maker

Small local app for turning a YouTube URL into an exportable audio slice.

Sample Maker is meant to be a fast local bridge between YouTube references and a DAW/sampler workflow: paste a URL, inspect the waveform, create one or more chops, then export clean audio slices.

## Requirements

- Node.js + Yarn
- `yt-dlp` available in your shell
- `ffmpeg` and `ffprobe` available in your shell

## Commands

```bash
yarn dev
yarn build
```

The dev app runs at [http://localhost:5173](http://localhost:5173).
The local API runs at [http://localhost:4174](http://localhost:4174) and is proxied by Vite under `/api`.

Downloaded sources and exported samples are stored under `data/jobs`, which is ignored by Git.

## Workflow

1. Paste a YouTube URL.
2. Wait for the local `yt-dlp` download and WAV conversion.
3. Drag directly on the waveform to create a chop.
4. Adjust the chop visually or with the start/end fields.
5. Use space to play/pause the current chop.
6. Zoom horizontally when you need finer placement.
7. Choose WAV, MP3, or AIFF.
8. Export the active chop, or export all chops.

## Current Features

- Local async download jobs with progress from `yt-dlp`.
- WAV source extraction for waveform display.
- Waveform rendering with `wavesurfer.js`.
- Multiple draggable/resizable chops.
- Horizontal zoom control.
- Timeline ruler synchronized to waveform scroll.
- Loop playback for the active chop.
- Keyboard shortcuts:
  - `Space`: play/pause active chop
  - `Cmd/Ctrl + Z`: undo the last chop edit
- Export to WAV, MP3, or AIFF through `ffmpeg`.
- Reveal exported files in Finder through the local API.

## Project Structure

```text
server/index.js   Local Express API around yt-dlp, ffmpeg, ffprobe, and Finder reveal.
src/App.tsx       Main React app, WaveSurfer setup, chop state, shortcuts, zoom, export flow.
src/styles.css    App layout and visual system.
data/jobs         Runtime audio workspace, ignored by Git.
docs/context.md   Handoff notes for future development sessions.
AGENTS.md         Quick instructions for future coding agents.
```

## Notes

This is a local-first tool. It deliberately shells out to globally installed CLIs instead of moving audio work into the browser. Keep generated audio out of Git; `data/` is ignored.

If the waveform layout changes, be careful with resize logic. The waveform container has a stable CSS height, and WaveSurfer is resized from that height without observing the WaveSurfer output itself, to avoid resize feedback loops.
