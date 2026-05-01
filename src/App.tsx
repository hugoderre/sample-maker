import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Pause, Play, Scissors, Search, SkipBack, TimerReset } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';

type DownloadedSample = {
  id: string;
  title: string;
  webpageUrl: string;
  duration: number;
  audioUrl: string;
  createdAt: string;
};

type ExportResult = {
  fileName: string;
  downloadUrl: string;
  duration: number;
};

type ApiError = {
  error?: string;
};

const MIN_REGION_SECONDS = 0.05;

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00.000';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${minutes}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) {
    throw new Error(payload.error || 'Something went wrong.');
  }
  return payload;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [sample, setSample] = useState<DownloadedSample | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [format, setFormat] = useState<'wav' | 'mp3' | 'aiff'>('wav');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState('Paste a YouTube URL to start.');
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const waveformRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const activeRegionRef = useRef<Region | null>(null);

  const selectionDuration = useMemo(() => Math.max(0, end - start), [end, start]);
  const canExport = Boolean(sample && isReady && selectionDuration >= MIN_REGION_SECONDS && !isExporting);

  useEffect(() => {
    if (!sample || !waveformRef.current || !timelineRef.current) return;

    setIsReady(false);
    setIsPlaying(false);

    const regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({
      container: timelineRef.current,
      timeInterval: 5,
      primaryLabelInterval: 15,
      secondaryLabelInterval: 5
    });

    const wavesurfer = WaveSurfer.create({
      container: waveformRef.current,
      url: sample.audioUrl,
      waveColor: '#84a59d',
      progressColor: '#f28482',
      cursorColor: '#ffffff',
      cursorWidth: 2,
      height: 280,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      minPxPerSec: 45,
      plugins: [regions, timeline]
    });

    wavesurferRef.current = wavesurfer;
    regionsRef.current = regions;
    activeRegionRef.current = null;

    wavesurfer.on('ready', () => {
      const initialEnd = Math.min(sample.duration || wavesurfer.getDuration(), 12);
      const region = regions.addRegion({
        start: 0,
        end: initialEnd,
        color: 'rgba(242, 132, 130, 0.28)',
        drag: true,
        resize: true
      });
      activeRegionRef.current = region;
      setStart(region.start);
      setEnd(region.end);
      setIsReady(true);
      setMessage('Drag the handles, then export the slice.');
    });

    wavesurfer.on('play', () => setIsPlaying(true));
    wavesurfer.on('pause', () => setIsPlaying(false));
    wavesurfer.on('finish', () => setIsPlaying(false));

    regions.on('region-updated', (region) => {
      activeRegionRef.current = region;
      setStart(region.start);
      setEnd(region.end);
    });

    regions.on('region-clicked', (region, event) => {
      event.stopPropagation();
      activeRegionRef.current = region;
      region.play();
    });

    regions.on('region-out', (region) => {
      if (activeRegionRef.current === region && wavesurfer.isPlaying()) {
        region.play();
      }
    });

    return () => {
      wavesurfer.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      activeRegionRef.current = null;
    };
  }, [sample]);

  async function handleDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return;

    setIsDownloading(true);
    setIsReady(false);
    setExportResult(null);
    setMessage('Downloading and converting audio...');

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      const payload = await readJson<DownloadedSample>(response);
      setSample(payload);
      setStart(0);
      setEnd(Math.min(payload.duration, 12));
      setMessage('Audio loaded. Build your sample.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Download failed.');
    } finally {
      setIsDownloading(false);
    }
  }

  function updateRegion(nextStart: number, nextEnd: number) {
    if (!sample) return;

    const clampedStart = Math.max(0, Math.min(nextStart, sample.duration - MIN_REGION_SECONDS));
    const clampedEnd = Math.max(clampedStart + MIN_REGION_SECONDS, Math.min(nextEnd, sample.duration));

    activeRegionRef.current?.setOptions({
      start: clampedStart,
      end: clampedEnd
    });

    setStart(clampedStart);
    setEnd(clampedEnd);
  }

  function togglePlayback() {
    if (!wavesurferRef.current) return;

    if (activeRegionRef.current) {
      if (wavesurferRef.current.isPlaying()) {
        wavesurferRef.current.pause();
      } else {
        activeRegionRef.current.play();
      }
      return;
    }

    wavesurferRef.current.playPause();
  }

  function rewindToSelection() {
    if (!wavesurferRef.current || !sample) return;
    wavesurferRef.current.seekTo(start / sample.duration);
  }

  async function handleExport() {
    if (!sample || !canExport) return;

    setIsExporting(true);
    setExportResult(null);
    setMessage('Exporting sample...');

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sample.id, start, end, format })
      });
      const payload = await readJson<ExportResult>(response);
      setExportResult(payload);
      setMessage('Sample exported.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Sample Maker</p>
          <h1>From YouTube URL to clean sample slice.</h1>
        </div>

        <form className="search-form" onSubmit={handleDownload}>
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="YouTube URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            disabled={isDownloading}
          />
          <button type="submit" disabled={isDownloading || !url.trim()}>
            {isDownloading ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
            <span>{isDownloading ? 'Loading' : 'Fetch'}</span>
          </button>
        </form>
      </section>

      <section className="workspace">
        <div className="sample-header">
          <div>
            <p className="label">Current track</p>
            <h2>{sample?.title || 'No audio loaded yet'}</h2>
          </div>
          <div className="status-pill">{message}</div>
        </div>

        <div className="wave-wrap">
          <div ref={waveformRef} className="waveform" />
          <div ref={timelineRef} className="timeline" />
          {!sample && (
            <div className="empty-wave">
              <Scissors size={42} />
              <span>Drop in a URL and the full waveform will appear here.</span>
            </div>
          )}
        </div>

        <div className="controls">
          <button className="icon-button" onClick={togglePlayback} disabled={!isReady} title="Play selection">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button className="icon-button" onClick={rewindToSelection} disabled={!isReady} title="Jump to start">
            <SkipBack size={20} />
          </button>
          <button
            className="icon-button"
            onClick={() => updateRegion(0, Math.min(sample?.duration || 12, 12))}
            disabled={!isReady}
            title="Reset selection"
          >
            <TimerReset size={20} />
          </button>

          <label className="time-field">
            <span>Start</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={start.toFixed(2)}
              disabled={!isReady}
              onChange={(event) => updateRegion(Number(event.target.value), end)}
            />
          </label>

          <label className="time-field">
            <span>End</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={end.toFixed(2)}
              disabled={!isReady}
              onChange={(event) => updateRegion(start, Number(event.target.value))}
            />
          </label>

          <div className="selection-readout">
            <span>{formatClock(start)}</span>
            <strong>{formatClock(selectionDuration)}</strong>
            <span>{formatClock(end)}</span>
          </div>

          <div className="format-switch" role="group" aria-label="Export format">
            {(['wav', 'mp3', 'aiff'] as const).map((option) => (
              <button
                key={option}
                className={format === option ? 'active' : ''}
                onClick={() => setFormat(option)}
                type="button"
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>

          <button className="export-button" onClick={handleExport} disabled={!canExport}>
            {isExporting ? <Loader2 className="spin" size={18} /> : <Scissors size={18} />}
            <span>Export</span>
          </button>
        </div>

        {exportResult && (
          <a className="download-result" href={exportResult.downloadUrl}>
            <Download size={18} />
            <span>{exportResult.fileName}</span>
            <small>{formatClock(exportResult.duration)}</small>
          </a>
        )}
      </section>
    </main>
  );
}
