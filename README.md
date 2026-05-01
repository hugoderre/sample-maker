# Sample Maker

Small local app for turning a YouTube URL into an exportable audio slice.

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

Downloaded sources and exported samples are stored under `data/jobs`, which is ignored by Git.

## Workflow

1. Paste a YouTube URL.
2. Wait for the local `yt-dlp` download and WAV conversion.
3. Drag the waveform selection handles.
4. Choose WAV, MP3, or AIFF.
5. Export the slice and download it.
