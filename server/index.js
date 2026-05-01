import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const jobsDir = path.join(dataDir, 'jobs');
const PORT = Number(process.env.PORT || 4174);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((error, _req, res, next) => {
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON payload.' });
    return;
  }

  next(error);
});

await fs.mkdir(jobsDir, { recursive: true });

const jobs = new Map();

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(stderr.trim() || `${command} exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
  });
}

function assertHttpUrl(input) {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only http(s) URLs are supported.');
    }
    return url.toString();
  } catch {
    throw new Error('Paste a valid YouTube URL.');
  }
}

function safeId(id) {
  return typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseJson(stdout) {
  const jsonStart = stdout.indexOf('{');
  if (jsonStart === -1) return {};
  return JSON.parse(stdout.slice(jsonStart));
}

async function ffprobeDuration(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath
  ]);

  return Number.parseFloat(stdout.trim());
}

function formatTimeName(seconds) {
  return seconds.toFixed(2).replace('.', 'p');
}

function jobPayload(job) {
  return {
    id: job.id,
    title: job.title,
    webpageUrl: job.webpageUrl,
    duration: job.duration,
    audioUrl: `/api/audio/${job.id}`,
    createdAt: job.createdAt
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/download', async (req, res) => {
  try {
    const url = assertHttpUrl(req.body?.url);
    const id = crypto.randomUUID();
    const jobDir = path.join(jobsDir, id);
    const sourcePath = path.join(jobDir, 'source.wav');

    await fs.mkdir(jobDir, { recursive: true });

    const metaResult = await run('yt-dlp', [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      url
    ]);
    const meta = parseJson(metaResult.stdout);

    await run(
      'yt-dlp',
      [
        '--no-playlist',
        '--extract-audio',
        '--audio-format',
        'wav',
        '--audio-quality',
        '0',
        '--output',
        'source.%(ext)s',
        url
      ],
      { cwd: jobDir }
    );

    if (!(await fileExists(sourcePath))) {
      throw new Error('yt-dlp finished, but no WAV file was created.');
    }

    const duration = await ffprobeDuration(sourcePath);
    const job = {
      id,
      title: meta.title || 'Untitled sample',
      webpageUrl: meta.webpage_url || url,
      duration: Number.isFinite(duration) ? duration : meta.duration,
      createdAt: new Date().toISOString(),
      sourcePath
    };

    jobs.set(id, job);
    res.json(jobPayload(job));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Download failed.'
    });
  }
});

app.get('/api/audio/:id', async (req, res) => {
  const { id } = req.params;
  if (!safeId(id)) return res.sendStatus(404);

  const sourcePath = path.join(jobsDir, id, 'source.wav');
  if (!(await fileExists(sourcePath))) return res.sendStatus(404);

  res.type('audio/wav');
  res.sendFile(sourcePath);
});

app.post('/api/export', async (req, res) => {
  try {
    const { id, start, end, format = 'wav' } = req.body || {};
    if (!safeId(id)) throw new Error('Unknown sample.');

    const safeFormat = ['wav', 'mp3', 'aiff'].includes(format) ? format : 'wav';
    const sourcePath = path.join(jobsDir, id, 'source.wav');
    if (!(await fileExists(sourcePath))) throw new Error('Source audio is missing.');

    const duration = await ffprobeDuration(sourcePath);
    const startTime = Math.max(0, Number(start));
    const endTime = Math.min(Number(end), duration);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      throw new Error('Choose a valid interval before exporting.');
    }

    const exportDir = path.join(jobsDir, id, 'exports');
    await fs.mkdir(exportDir, { recursive: true });

    const fileName = `sample_${formatTimeName(startTime)}_${formatTimeName(endTime)}.${safeFormat}`;
    const outputPath = path.join(exportDir, fileName);
    const codecArgs =
      safeFormat === 'mp3'
        ? ['-codec:a', 'libmp3lame', '-q:a', '2']
        : safeFormat === 'aiff'
          ? ['-codec:a', 'pcm_s16be']
          : ['-codec:a', 'pcm_s16le'];

    await run('ffmpeg', [
      '-y',
      '-ss',
      String(startTime),
      '-to',
      String(endTime),
      '-i',
      sourcePath,
      ...codecArgs,
      outputPath
    ]);

    res.json({
      fileName,
      downloadUrl: `/api/export/${id}/${encodeURIComponent(fileName)}`,
      duration: endTime - startTime
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Export failed.'
    });
  }
});

app.get('/api/export/:id/:file', async (req, res) => {
  const { id, file } = req.params;
  if (!safeId(id) || file.includes('/') || file.includes('..')) return res.sendStatus(404);

  const outputPath = path.join(jobsDir, id, 'exports', file);
  if (!(await fileExists(outputPath))) return res.sendStatus(404);

  res.download(outputPath);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Sample Maker API listening on http://localhost:${PORT}`);
});
