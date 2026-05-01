# Sample Maker Context

This document is for future development sessions. It captures the current product shape, implementation decisions, and pitfalls that matter when resuming work.

## Product Intent

Sample Maker is a local-first sample editor for quickly turning a YouTube music URL into one or more exportable audio chops.

The target workflow is:

1. Paste a YouTube URL.
2. Download/extract audio locally with `yt-dlp`.
3. Display the waveform.
4. Drag on the waveform to create chops.
5. Adjust chops visually or numerically.
6. Play/loop the current chop.
7. Export WAV, MP3, or AIFF for use in a DAW/sampler.

The app should feel like a small studio tool: direct, dense, quick, and visually calm.

## Tech Stack

- Vite + React + TypeScript for the UI.
- Express for the local API.
- `wavesurfer.js` for waveform rendering and regions.
- Global `yt-dlp` for download/extraction.
- Global `ffmpeg` and `ffprobe` for conversion, export, and duration probing.
- Yarn classic (`yarn.lock` present).

## Runtime Data

The API writes generated files under:

```text
data/jobs/<uuid>/
  source.wav
  exports/
    sample_<start>_<end>.<format>
```

`data/` is ignored by Git and should stay that way.

## Server API

Main endpoints in `server/index.js`:

- `GET /api/health`: basic health check.
- `POST /api/download`: validates URL, creates async download job, returns job state.
- `GET /api/download/:id`: polling endpoint for download progress.
- `GET /api/audio/:id`: serves source WAV for WaveSurfer.
- `POST /api/export`: exports the requested interval to WAV, MP3, or AIFF.
- `GET /api/export/:id/:file`: downloads an exported file.
- `POST /api/reveal`: reveals an exported file in Finder. It is restricted to files inside `data/jobs`.

Download progress is parsed from `yt-dlp --newline --progress` output.

## UI State Model

`src/App.tsx` owns most app behavior.

Important concepts:

- `sample`: loaded audio metadata from the API.
- `chops`: derived from WaveSurfer regions and sorted by start time.
- `activeRegionRef` / `activeRegionId`: current selected chop.
- `zoom`: horizontal WaveSurfer zoom, mapped to `minPxPerSec`.
- `timelineScroll` / `timelineWidth`: values used by the custom timeline ruler.
- `historyRef`: undo stack of region snapshots.

Chops are not independent React-controlled objects. WaveSurfer regions are the source of truth, and `syncChops()` mirrors them into React for the lower chop list and controls.

## Waveform And Timeline

WaveSurfer is created with `RegionsPlugin`.

The built-in `TimelinePlugin` was removed because labels could drift or disappear while horizontally scrolling. The app now renders a custom React timeline:

- width is based on `duration * zoom`;
- visible ticks are derived from `timelineScroll`, `timelineWidth`, and `zoom`;
- WaveSurfer events update it: `scroll`, `zoom`, `redraw`, `resize`;
- labels use `formatAxisTime()`.

Keep the timeline independent from WaveSurfer DOM internals unless there is a strong reason to change it.

## Waveform Height Gotcha

There was a bug where the waveform grew vertically forever after audio loaded. The cause was a resize feedback loop:

1. Measure waveform container.
2. Set WaveSurfer height.
3. WaveSurfer output changes container size.
4. Resize observer fires again.

The current fix:

- `.wave-wrap` has a stable CSS height: `clamp(520px, 58vh, 780px)`.
- `measureWaveformHeight()` reads that stable frame and subtracts the timeline height.
- WaveSurfer height is updated on initial load and browser resize, not by observing its own rendered output.

Be careful when changing this area.

## Playback Behavior

Space toggles playback unless the user is typing in an editable field.

Loop playback intentionally calls `playActiveRegion()` again when playback leaves the active region. This reads the current region at that moment, so resizing a region while it is playing uses the new end time instead of the old one.

## Undo Behavior

`Cmd/Ctrl + Z` restores the previous region snapshot.

Undo currently covers:

- creating a region;
- dragging/resizing a region;
- deleting a region;
- editing start/end numeric fields.

Undo intentionally does not cover:

- downloads;
- exports;
- format changes;
- zoom changes;
- reveal actions.

## Current UX Decisions

- No chop is created automatically after download.
- The user creates chops by dragging directly on the waveform, or by clicking the plus button near the current playhead.
- Reset chop was removed because it was not useful.
- Toolbar controls must stay aligned and not collapse when zoom is visible.
- Exported files stack in the Exports panel.

## Common Next Improvements

Good candidates for future work:

- Persist recent jobs/chops between refreshes.
- Let users rename chops.
- Add keyboard nudging for region start/end.
- Add normalize/loudness options on export.
- Add waveform loading skeleton or more precise `yt-dlp` stages.
- Add a compact mode for smaller screens.

## Validation Checklist

Before handing back:

1. `yarn build`
2. `yarn dev`
3. Open `http://localhost:5173`
4. Check browser console for warnings/errors
5. If audio behavior changed, test with a real YouTube URL and confirm:
   - waveform loads;
   - drag-to-create region works;
   - timeline stays aligned when scrolling;
   - zoom does not crush toolbar controls;
   - space toggles playback;
   - loop follows resized region end;
   - export still downloads a file.
