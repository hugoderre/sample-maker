import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FolderOpen,
  Layers,
  Loader2,
  Pause,
  Play,
  Plus,
  Scissors,
  Search,
  SkipBack,
  Trash2,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
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

type DownloadJob = {
  id: string;
  status: 'queued' | 'metadata' | 'downloading' | 'analyzing' | 'done' | 'error';
  progress: number;
  message: string;
  sample: DownloadedSample | null;
  error: string | null;
};

type Chop = {
  id: string;
  label: string;
  start: number;
  end: number;
};

type ChopSnapshot = {
  activeId: string | null;
  regions: Array<Pick<Chop, 'id' | 'start' | 'end'>>;
};

type ExportResult = {
  id: string;
  label: string;
  fileName: string;
  downloadUrl: string;
  outputPath: string;
  duration: number;
};

type ApiError = {
  error?: string;
};

const MIN_REGION_SECONDS = 0.05;
const DEFAULT_CHOP_SECONDS = 8;
const DEFAULT_ZOOM = 45;
const MIN_ZOOM = 24;
const MAX_ZOOM = 180;
const EDGE_SCROLL_ZONE = 96;
const EDGE_SCROLL_MAX_SPEED = 7;
const ACTIVE_COLOR = 'rgba(242, 132, 130, 0.34)';
const CHOP_COLOR = 'rgba(132, 165, 157, 0.26)';

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00.000';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);
  return `${minutes}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatAxisTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatSeconds(seconds: number) {
  return Number.isFinite(seconds) ? seconds.toFixed(2) : '0.00';
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
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [message, setMessage] = useState('Paste a YouTube URL to start.');
  const [exportResults, setExportResults] = useState<ExportResult[]>([]);
  const [chops, setChops] = useState<Chop[]>([]);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  const waveformRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const waveWrapRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const activeRegionRef = useRef<Region | null>(null);
  const activeRegionIdRef = useRef<string | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef(0);
  const isRegionDragRef = useRef(false);
  const historyRef = useRef<ChopSnapshot[]>([]);
  const pendingRegionUpdateSnapshotRef = useRef<ChopSnapshot | null>(null);
  const isRestoringRef = useRef(false);

  const selectionDuration = useMemo(() => Math.max(0, end - start), [end, start]);
  const canExport = Boolean(
    sample && isReady && activeRegionId && selectionDuration >= MIN_REGION_SECONDS && !isExporting
  );
  const currentChopLabel = chops.find((chop) => chop.id === activeRegionId)?.label || 'No chop';

  function paintRegions(activeId = activeRegionIdRef.current) {
    regionsRef.current?.getRegions().forEach((region) => {
      region.setOptions({
        color: region.id === activeId ? ACTIVE_COLOR : CHOP_COLOR
      });
    });
  }

  function syncChops() {
    const regions = regionsRef.current?.getRegions() || [];
    const nextChops = regions
      .slice()
      .sort((left, right) => left.start - right.start)
      .map((region, index) => ({
        id: region.id,
        label: `Chop ${index + 1}`,
        start: region.start,
        end: region.end
      }));

    setChops(nextChops);
  }

  function getSnapshot(): ChopSnapshot {
    return {
      activeId: activeRegionIdRef.current,
      regions: (regionsRef.current?.getRegions() || []).map((region) => ({
        id: region.id,
        start: region.start,
        end: region.end
      }))
    };
  }

  function pushHistory(snapshot = getSnapshot()) {
    if (isRestoringRef.current) return;

    historyRef.current = [...historyRef.current.slice(-49), snapshot];
  }

  function selectRegion(region: Region) {
    activeRegionRef.current = region;
    activeRegionIdRef.current = region.id;
    setActiveRegionId(region.id);
    setStart(region.start);
    setEnd(region.end);
    paintRegions(region.id);
  }

  function restoreSnapshot(snapshot: ChopSnapshot) {
    if (!regionsRef.current) return;

    isRestoringRef.current = true;
    regionsRef.current.clearRegions();
    activeRegionRef.current = null;
    activeRegionIdRef.current = null;

    const restoredRegions = snapshot.regions.map((region) =>
      regionsRef.current!.addRegion({
        id: region.id,
        start: region.start,
        end: region.end,
        color: region.id === snapshot.activeId ? ACTIVE_COLOR : CHOP_COLOR,
        drag: true,
        resize: true,
        minLength: MIN_REGION_SECONDS
      })
    );

    const activeRegion =
      restoredRegions.find((region) => region.id === snapshot.activeId) || restoredRegions[0] || null;

    if (activeRegion) {
      selectRegion(activeRegion);
    } else {
      setActiveRegionId(null);
      setStart(0);
      setEnd(0);
    }

    syncChops();
    isRestoringRef.current = false;
  }

  function undoLastAction() {
    const snapshot = historyRef.current.pop();
    if (!snapshot) return;

    restoreSnapshot(snapshot);
    setMessage('Undo.');
  }

  function createRegion(nextStart: number, nextEnd: number) {
    if (!sample || !regionsRef.current) return null;

    const clampedStart = Math.max(0, Math.min(nextStart, sample.duration - MIN_REGION_SECONDS));
    const clampedEnd = Math.max(
      clampedStart + MIN_REGION_SECONDS,
      Math.min(nextEnd, sample.duration)
    );

    const region = regionsRef.current.addRegion({
      start: clampedStart,
      end: clampedEnd,
      color: ACTIVE_COLOR,
      drag: true,
      resize: true,
      minLength: MIN_REGION_SECONDS
    });

    selectRegion(region);
    syncChops();
    return region;
  }

  function playActiveRegion() {
    const wavesurfer = wavesurferRef.current;
    const region = activeRegionRef.current;
    if (!wavesurfer || !region) return;

    wavesurfer.setTime(region.start);
    wavesurfer.play();
  }

  function updateZoom(nextZoom: number) {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    setZoom(clampedZoom);
    wavesurferRef.current?.zoom(clampedZoom);
  }

  function stopEdgeAutoScroll() {
    autoScrollVelocityRef.current = 0;
    isRegionDragRef.current = false;
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }

  function startEdgeAutoScroll(velocity: number) {
    if (!wavesurferRef.current) return;

    autoScrollVelocityRef.current = velocity;
    if (autoScrollFrameRef.current !== null) return;

    const tick = () => {
      const wavesurfer = wavesurferRef.current;
      if (!wavesurfer || autoScrollVelocityRef.current === 0) {
        autoScrollFrameRef.current = null;
        return;
      }

      wavesurfer.setScroll(wavesurfer.getScroll() + autoScrollVelocityRef.current);
      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
  }

  function isRegionPointerTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest('[part*="region"]'));
  }

  function handleWavePointerMove(event: PointerEvent) {
    if (!waveWrapRef.current || !isRegionDragRef.current || !regionsRef.current?.getRegions().length) {
      stopEdgeAutoScroll();
      return;
    }

    const bounds = waveWrapRef.current.getBoundingClientRect();
    const rightDistance = bounds.right - event.clientX;
    const leftDistance = event.clientX - bounds.left;

    if (rightDistance < EDGE_SCROLL_ZONE) {
      const pressure = Math.max(0, Math.min(1, 1 - rightDistance / EDGE_SCROLL_ZONE));
      startEdgeAutoScroll(Math.max(1, Math.round(pressure * EDGE_SCROLL_MAX_SPEED)));
      return;
    }

    if (leftDistance < EDGE_SCROLL_ZONE) {
      const pressure = Math.max(0, Math.min(1, 1 - leftDistance / EDGE_SCROLL_ZONE));
      startEdgeAutoScroll(-Math.max(1, Math.round(pressure * EDGE_SCROLL_MAX_SPEED)));
      return;
    }

    stopEdgeAutoScroll();
  }

  useEffect(() => {
    if (!sample || !waveformRef.current || !timelineRef.current) return;

    setIsReady(false);
    setIsPlaying(false);
    setChops([]);
    setActiveRegionId(null);
    activeRegionRef.current = null;
    activeRegionIdRef.current = null;

    const regions = RegionsPlugin.create();
    const timeline = TimelinePlugin.create({
      container: timelineRef.current,
      height: 34,
      timeInterval: 5,
      primaryLabelInterval: 15,
      secondaryLabelInterval: 5,
      formatTimeCallback: formatAxisTime,
      style: {
        color: 'rgba(247, 244, 238, 0.76)',
        fontSize: '12px'
      }
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
      minPxPerSec: zoom,
      plugins: [regions, timeline]
    });

    wavesurferRef.current = wavesurfer;
    regionsRef.current = regions;
    const disableDragSelection = regions.enableDragSelection(
      {
        color: ACTIVE_COLOR,
        drag: true,
        resize: true,
        minLength: MIN_REGION_SECONDS
      },
      4
    );

    wavesurfer.on('ready', () => {
      wavesurfer.zoom(zoom);
      setIsReady(true);
      setStart(0);
      setEnd(0);
      setMessage('Drag anywhere on the waveform to create a chop.');
    });

    wavesurfer.on('play', () => setIsPlaying(true));
    wavesurfer.on('pause', () => setIsPlaying(false));
    wavesurfer.on('finish', () => setIsPlaying(false));

    regions.on('region-initialized', () => {
      pushHistory();
    });

    regions.on('region-update', () => {
      if (!pendingRegionUpdateSnapshotRef.current) {
        pendingRegionUpdateSnapshotRef.current = getSnapshot();
      }
    });

    regions.on('region-updated', (region) => {
      if (pendingRegionUpdateSnapshotRef.current) {
        pushHistory(pendingRegionUpdateSnapshotRef.current);
        pendingRegionUpdateSnapshotRef.current = null;
      }
      selectRegion(region);
      syncChops();
    });

    regions.on('region-created', (region) => {
      selectRegion(region);
      syncChops();
    });

    regions.on('region-clicked', (region, event) => {
      event.stopPropagation();
      selectRegion(region);
      playActiveRegion();
    });

    regions.on('region-out', (region) => {
      if (activeRegionRef.current === region && wavesurfer.isPlaying()) {
        playActiveRegion();
      }
    });

    return () => {
      stopEdgeAutoScroll();
      disableDragSelection();
      wavesurfer.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
      activeRegionRef.current = null;
      activeRegionIdRef.current = null;
      pendingRegionUpdateSnapshotRef.current = null;
      historyRef.current = [];
    };
  }, [sample]);

  useEffect(() => {
    wavesurferRef.current?.zoom(zoom);
  }, [zoom]);

  useEffect(() => {
    const waveWrap = waveWrapRef.current;
    if (!waveWrap) return;

    const onPointerEnd = () => {
      document.removeEventListener('pointermove', handleWavePointerMove);
      stopEdgeAutoScroll();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!isRegionPointerTarget(event.target)) return;
      isRegionDragRef.current = true;
      document.addEventListener('pointermove', handleWavePointerMove);
      document.addEventListener('pointerup', onPointerEnd, { once: true });
      document.addEventListener('pointercancel', onPointerEnd, { once: true });
    };

    waveWrap.addEventListener('pointerdown', onPointerDown);

    return () => {
      waveWrap.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', handleWavePointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
      stopEdgeAutoScroll();
    };
  }, [sample]);

  async function pollDownloadJob(jobId: string) {
    let done = false;

    while (!done) {
      await new Promise((resolve) => setTimeout(resolve, 450));

      const response = await fetch(`/api/download/${jobId}`);
      const job = await readJson<DownloadJob>(response);
      setDownloadProgress(job.progress);
      setMessage(job.message);

      if (job.status === 'done' && job.sample) {
        setSample(job.sample);
        setStart(0);
        setEnd(0);
        setActiveRegionId(null);
        activeRegionRef.current = null;
        activeRegionIdRef.current = null;
        setMessage('Audio loaded. Drag on the waveform to create a chop.');
        done = true;
      }

      if (job.status === 'error') {
        throw new Error(job.error || 'Download failed.');
      }
    }
  }

  async function handleDownload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return;

    setIsDownloading(true);
    setIsReady(false);
    setExportResults([]);
    setChops([]);
    setDownloadProgress(2);
    setMessage('Preparing download...');

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      const job = await readJson<DownloadJob>(response);
      setDownloadProgress(job.progress);
      setMessage(job.message);
      await pollDownloadJob(job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Download failed.');
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
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
    syncChops();
  }

  function addChop() {
    if (!sample) return;

    const anchor = wavesurferRef.current?.getCurrentTime() || start || 0;
    const nextStart = Math.min(Math.max(anchor, 0), Math.max(0, sample.duration - MIN_REGION_SECONDS));
    const nextEnd = Math.min(nextStart + DEFAULT_CHOP_SECONDS, sample.duration);
    createRegion(nextStart, nextEnd);
  }

  function deleteActiveChop() {
    const region = activeRegionRef.current;
    if (!region || !regionsRef.current) return;

    pushHistory();
    region.remove();
    const remaining = regionsRef.current.getRegions();
    if (remaining.length > 0) {
      selectRegion(remaining[0]);
      syncChops();
      return;
    }

    activeRegionRef.current = null;
    activeRegionIdRef.current = null;
    setActiveRegionId(null);
    setStart(0);
    setEnd(0);
    syncChops();
  }

  function togglePlayback() {
    if (!wavesurferRef.current) return;

    if (activeRegionRef.current) {
      if (wavesurferRef.current.isPlaying()) {
        wavesurferRef.current.pause();
      } else {
        playActiveRegion();
      }
      return;
    }

    wavesurferRef.current.playPause();
  }

  function rewindToSelection() {
    if (!wavesurferRef.current || !sample) return;
    wavesurferRef.current.seekTo(start / sample.duration);
  }

  function handleTimeFieldFocus() {
    if (activeRegionId) {
      pushHistory();
    }
  }

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoLastAction();
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  async function exportChop(chop: Chop) {
    if (!sample) throw new Error('No sample loaded.');

    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sample.id, start: chop.start, end: chop.end, format })
    });
    const payload = await readJson<Omit<ExportResult, 'id' | 'label'>>(response);

    return {
      ...payload,
      id: crypto.randomUUID(),
      label: chop.label
    };
  }

  async function handleExportActive() {
    if (!canExport || !activeRegionId) return;
    const activeChop = chops.find((chop) => chop.id === activeRegionId);
    if (!activeChop) return;

    setIsExporting(true);
    setMessage(`Exporting ${activeChop.label}...`);

    try {
      const result = await exportChop(activeChop);
      setExportResults((current) => [result, ...current]);
      setMessage(`${activeChop.label} exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleExportAll() {
    if (!sample || chops.length === 0 || isExporting) return;

    setIsExporting(true);
    setMessage(`Exporting ${chops.length} chops...`);

    try {
      const results: ExportResult[] = [];
      for (const chop of chops) {
        results.push(await exportChop(chop));
      }
      setExportResults((current) => [...results.reverse(), ...current]);
      setMessage(`${chops.length} chops exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  }

  async function revealExport(path: string) {
    try {
      await readJson<{ ok: true }>(
        await fetch('/api/reveal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path })
        })
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not reveal file.');
    }
  }

  return (
    <main className={`app-shell ${sample ? 'has-sample' : ''}`}>
      <section className="topbar">
        <div>
          <p className="eyebrow">Sample Maker</p>
          <h1>{sample ? 'Shape the chop.' : 'From YouTube URL to clean sample slice.'}</h1>
        </div>

        <div className="search-stack">
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

          {isDownloading && (
            <div className="download-meter">
              <span style={{ width: `${Math.max(4, downloadProgress)}%` }} />
              <strong>{Math.round(downloadProgress)}%</strong>
            </div>
          )}
        </div>
      </section>

      <section className="workspace">
        <div className="sample-header">
          <div>
            <p className="label">Current track</p>
            <h2>{sample?.title || 'No audio loaded yet'}</h2>
          </div>
          <div className="status-pill">{message}</div>
        </div>

        <div ref={waveWrapRef} className="wave-wrap">
          <div ref={timelineRef} className="timeline" />
          <div ref={waveformRef} className="waveform" />
          {!sample && (
            <div className="empty-wave">
              <Scissors size={42} />
              <span>Drop in a URL and the full waveform will appear here.</span>
            </div>
          )}
        </div>

        <div className="controls">
          <button className="icon-button" onClick={togglePlayback} disabled={!activeRegionId} title="Play selection">
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button className="icon-button" onClick={rewindToSelection} disabled={!activeRegionId} title="Jump to start">
            <SkipBack size={20} />
          </button>
          <button className="icon-button" onClick={addChop} disabled={!isReady} title="Add chop">
            <Plus size={20} />
          </button>
          <button className="icon-button" onClick={deleteActiveChop} disabled={!activeRegionId} title="Delete chop">
            <Trash2 size={19} />
          </button>

          <div className="zoom-control">
            <ZoomOut size={17} />
            <input
              aria-label="Horizontal zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step="1"
              value={zoom}
              disabled={!sample}
              onChange={(event) => updateZoom(Number(event.target.value))}
            />
            <ZoomIn size={17} />
          </div>

          <label className="time-field">
            <span>{currentChopLabel} start</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formatSeconds(start)}
              disabled={!activeRegionId}
              onFocus={handleTimeFieldFocus}
              onChange={(event) => updateRegion(Number(event.target.value), end)}
            />
          </label>

          <label className="time-field">
            <span>End</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formatSeconds(end)}
              disabled={!activeRegionId}
              onFocus={handleTimeFieldFocus}
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

          <button className="export-button" onClick={handleExportActive} disabled={!canExport}>
            {isExporting ? <Loader2 className="spin" size={18} /> : <Scissors size={18} />}
            <span>Export</span>
          </button>
        </div>

        {sample && (
          <div className="lower-panels">
            <section className="chop-panel">
              <div className="panel-title">
                <Layers size={18} />
                <span>{chops.length} chops</span>
              </div>
              <div className="chop-list">
                {chops.map((chop) => (
                  <button
                    key={chop.id}
                    className={chop.id === activeRegionId ? 'active' : ''}
                    type="button"
                    onClick={() => {
                      const region = regionsRef.current
                        ?.getRegions()
                        .find((candidate) => candidate.id === chop.id);
                      if (region) selectRegion(region);
                    }}
                  >
                    <strong>{chop.label}</strong>
                    <span>{formatClock(chop.start)}</span>
                    <span>{formatClock(chop.end - chop.start)}</span>
                  </button>
                ))}
              </div>
              <button className="secondary-action" onClick={handleExportAll} disabled={!isReady || isExporting}>
                <Download size={17} />
                <span>Export all</span>
              </button>
            </section>

            <section className="export-panel">
              <div className="panel-title">
                <FolderOpen size={18} />
                <span>Exports</span>
              </div>
              {exportResults.length === 0 ? (
                <p className="muted-line">Exported samples will stack here.</p>
              ) : (
                <div className="export-list">
                  {exportResults.map((result) => (
                    <div className="export-item" key={result.id}>
                      <a href={result.downloadUrl}>
                        <Download size={17} />
                        <span>{result.fileName}</span>
                      </a>
                      <small>
                        {result.label} / {formatClock(result.duration)}
                      </small>
                      <button type="button" onClick={() => revealExport(result.outputPath)}>
                        <ExternalLink size={16} />
                        <span>Reveal</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
