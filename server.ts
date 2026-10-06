import express, { Request, Response } from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const HISTORY_FILE = path.resolve(__dirname, 'uploaded_history.txt');
const DEFAULT_CHANNEL = 'MajalesAlKhaqani';

// In-memory runtime storage
interface TrackMetadata {
  postId: string;
  postUrl: string;
  title: string;
  performer: string;
  duration?: string;
  audioUrl: string;
  date?: string;
  messageSnippet?: string;
  filename: string;
  s3Key: string;
  fileSizeBytes?: number;
}

interface UploadedTrackRecord extends TrackMetadata {
  uploadedAt: string;
  s3PublicUrl?: string;
  status: 'uploaded' | 'simulated';
}

interface ServerLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  channel?: string;
}

const logs: ServerLog[] = [];
function addLog(level: 'info' | 'warn' | 'error' | 'success', message: string, channel?: string) {
  const entry: ServerLog = {
    id: Math.random().toString(36).substring(2, 9),
    timestamp: new Date().toISOString(),
    level,
    message,
    channel,
  };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
}

// Config state
let activeChannel = process.env.TELEGRAM_CHANNEL || DEFAULT_CHANNEL;
let s3Endpoint = process.env.ARVAN_ENDPOINT || '';
let s3AccessKey = process.env.ARVAN_ACCESS_KEY || '';
let s3SecretKey = process.env.ARVAN_SECRET_KEY || '';
let s3Bucket = process.env.ARVAN_BUCKET_NAME || '';

// Mock tracks for simulation mode when user has not yet configured S3 credentials
const simulatedTracks: UploadedTrackRecord[] = [];

// Helper to check if real S3 credentials are provided
function isS3Configured(): boolean {
  return Boolean(s3Endpoint && s3AccessKey && s3SecretKey && s3Bucket);
}

function getS3Client(): S3Client | null {
  if (!isS3Configured()) return null;
  try {
    return new S3Client({
      endpoint: s3Endpoint,
      region: 'default',
      credentials: {
        accessKeyId: s3AccessKey,
        secretAccessKey: s3SecretKey,
      },
      forcePathStyle: true,
    });
  } catch (err) {
    console.error('Failed to create S3 client:', err);
    return null;
  }
}

// History loading & saving
function loadHistory(): Set<string> {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const set = new Set<string>();
      content
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((id) => set.add(id));
      return set;
    }
  } catch (err) {
    console.error('Error reading history file:', err);
  }
  return new Set();
}

function saveHistory(history: Set<string>): void {
  try {
    const list = Array.from(history).sort();
    fs.writeFileSync(HISTORY_FILE, list.join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.error('Error saving history file:', err);
  }
}

let historySet = loadHistory();

// Telegram scraping function
async function scrapeTelegramChannel(channelName: string): Promise<{
  channelInfo: {
    name: string;
    title: string;
    avatar?: string;
    subscribers?: string;
    description?: string;
  };
  tracks: TrackMetadata[];
}> {
  const cleanChannel = channelName.replace(/^@/, '').trim();
  const url = `https://t.me/s/${cleanChannel}`;

  addLog('info', `Connecting to Telegram preview: ${url}`, cleanChannel);

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`Telegram returned status HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Channel Header Info
  const title = $('.tgme_channel_info_header_title').text().trim() || cleanChannel;
  const avatar = $('.tgme_page_photo_image').attr('src') || '';
  const subscribers = $('.tgme_channel_info_counter .counter_value').text().trim() || '';
  const description = $('.tgme_channel_info_description').text().trim() || '';

  const tracks: TrackMetadata[] = [];
  const messages = $('.tgme_widget_message');

  messages.each((_, elem) => {
    const msg = $(elem);
    const audioTag = msg.find('audio');
    const audioSrc = audioTag.attr('src');
    if (!audioSrc) return;

    const dataPost = msg.attr('data-post') || '';
    const postId = dataPost.split('/').pop() || '';
    if (!postId) return;

    const titleEl = msg.find('.tgme_widget_message_document_title');
    const performerEl = msg.find('.tgme_widget_message_document_subtitle');
    const trackTitle = (titleEl.text().trim() || 'Audio').replace(/[\r\n\t]/g, ' ');
    const trackPerformer = (performerEl.text().trim() || 'Performer').replace(/[\r\n\t]/g, ' ');

    const dateEl = msg.find('time');
    const date = dateEl.attr('datetime') || dateEl.text().trim();

    const textEl = msg.find('.tgme_widget_message_text');
    const messageSnippet = textEl.text().trim().substring(0, 150);

    const safeTitle = trackTitle.replace(/[\/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
    const safePerformer = trackPerformer.replace(/[\/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_');
    const filename = `${postId}_${safePerformer}_${safeTitle}.mp3`;
    const s3Key = `tracks/${filename}`;

    tracks.push({
      postId,
      postUrl: `https://t.me/${cleanChannel}/${postId}`,
      title: trackTitle,
      performer: trackPerformer,
      audioUrl: audioSrc,
      date,
      messageSnippet,
      filename,
      s3Key,
    });
  });

  addLog('success', `Found ${tracks.length} audio posts in ${cleanChannel}`, cleanChannel);

  return {
    channelInfo: {
      name: cleanChannel,
      title,
      avatar,
      subscribers,
      description,
    },
    tracks,
  };
}

// Download and upload single track
async function processTrackUpload(track: TrackMetadata): Promise<UploadedTrackRecord> {
  addLog('info', `Downloading audio for post #${track.postId}: ${track.performer} - ${track.title}`);

  // Fetch audio from telegram CDN
  const audioRes = await fetch(track.audioUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  });

  if (!audioRes.ok) {
    throw new Error(`Failed to download audio: HTTP ${audioRes.status}`);
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileSizeBytes = buffer.byteLength;

  let publicUrl = '';
  let status: 'uploaded' | 'simulated' = 'simulated';

  if (isS3Configured()) {
    const s3 = getS3Client();
    if (!s3) throw new Error('Could not initialize S3 client with current credentials');

    addLog('info', `Uploading to Arvan S3: bucket=${s3Bucket}, key=${track.s3Key}`);
    const command = new PutObjectCommand({
      Bucket: s3Bucket,
      Key: track.s3Key,
      Body: buffer,
      ACL: 'public-read',
      ContentType: 'audio/mpeg',
    });

    await s3.send(command);
    publicUrl = `${s3Endpoint.replace(/\/$/, '')}/${s3Bucket}/${track.s3Key}`;
    status = 'uploaded';
    addLog('success', `Uploaded successfully to S3: ${publicUrl}`);
  } else {
    // Simulated upload for testing without real Arvan S3 keys
    publicUrl = `/api/mock-audio/${track.filename}`;
    status = 'simulated';
    addLog('warn', `S3 credentials not configured. Saved in simulation sandbox (${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB).`);
  }

  // Update history
  historySet.add(track.postId);
  saveHistory(historySet);

  const record: UploadedTrackRecord = {
    ...track,
    fileSizeBytes,
    uploadedAt: new Date().toISOString(),
    s3PublicUrl: publicUrl,
    status,
  };

  // Keep in simulated cache
  const existingIdx = simulatedTracks.findIndex((t) => t.postId === track.postId);
  if (existingIdx >= 0) {
    simulatedTracks[existingIdx] = record;
  } else {
    simulatedTracks.unshift(record);
  }

  return record;
}

// REST API ROUTES
app.get('/api/status', async (req: Request, res: Response) => {
  const configured = isS3Configured();
  res.json({
    activeChannel,
    isS3Configured: configured,
    s3Endpoint: s3Endpoint || null,
    s3Bucket: s3Bucket || null,
    uploadedCount: historySet.size,
    logsCount: logs.length,
    historyFileExists: fs.existsSync(HISTORY_FILE),
  });
});

app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    channel: activeChannel,
    s3Endpoint,
    s3Bucket,
    hasAccessKey: Boolean(s3AccessKey),
    hasSecretKey: Boolean(s3SecretKey),
    isConfigured: isS3Configured(),
  });
});

app.post('/api/config', (req: Request, res: Response) => {
  const { channel, endpoint, accessKey, secretKey, bucket } = req.body;
  if (channel) activeChannel = channel.replace(/^@/, '').trim();
  if (endpoint !== undefined) s3Endpoint = endpoint.trim();
  if (accessKey !== undefined) s3AccessKey = accessKey.trim();
  if (secretKey !== undefined) s3SecretKey = secretKey.trim();
  if (bucket !== undefined) s3Bucket = bucket.trim();

  addLog('info', `Config updated: Channel=${activeChannel}, S3 Endpoint=${s3Endpoint || '(none)'}, Bucket=${s3Bucket || '(none)'}`);
  res.json({
    success: true,
    activeChannel,
    isS3Configured: isS3Configured(),
  });
});

// Telegram Scrape Preview
app.get('/api/scrape/preview', async (req: Request, res: Response) => {
  try {
    const channel = (req.query.channel as string) || activeChannel;
    const result = await scrapeTelegramChannel(channel);

    // Annotate tracks with history upload state
    const annotatedTracks = result.tracks.map((t) => ({
      ...t,
      isUploaded: historySet.has(t.postId),
      uploadedRecord: simulatedTracks.find((st) => st.postId === t.postId) || null,
    }));

    res.json({
      success: true,
      channelInfo: result.channelInfo,
      tracks: annotatedTracks,
      totalFound: annotatedTracks.length,
      uploadedCount: annotatedTracks.filter((t) => t.isUploaded).length,
      pendingCount: annotatedTracks.filter((t) => !t.isUploaded).length,
    });
  } catch (err: any) {
    addLog('error', `Scrape failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run Full Scrape & Upload Batch
app.post('/api/scrape/run', async (req: Request, res: Response) => {
  const channel = req.body.channel || activeChannel;
  addLog('info', `Starting pipeline execution for channel: ${channel}`);

  try {
    const scrapeResult = await scrapeTelegramChannel(channel);
    const unuploadedTracks = scrapeResult.tracks.filter((t) => !historySet.has(t.postId));

    addLog('info', `Pipeline: ${scrapeResult.tracks.length} total tracks found, ${unuploadedTracks.length} pending upload.`);

    const results: Array<{ postId: string; title: string; success: boolean; error?: string; record?: UploadedTrackRecord }> = [];

    for (const track of unuploadedTracks) {
      try {
        const record = await processTrackUpload(track);
        results.push({ postId: track.postId, title: track.title, success: true, record });
      } catch (err: any) {
        addLog('error', `Failed to upload track #${track.postId} (${track.title}): ${err.message}`);
        results.push({ postId: track.postId, title: track.title, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      channel,
      totalScraped: scrapeResult.tracks.length,
      pendingFound: unuploadedTracks.length,
      processed: results,
      totalUploadedNow: results.filter((r) => r.success).length,
    });
  } catch (err: any) {
    addLog('error', `Pipeline execution error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload Single Track
app.post('/api/upload/single', async (req: Request, res: Response) => {
  const { track } = req.body;
  if (!track || !track.postId || !track.audioUrl) {
    res.status(400).json({ success: false, error: 'Missing track metadata' });
    return;
  }

  try {
    const record = await processTrackUpload(track);
    res.json({ success: true, record });
  } catch (err: any) {
    addLog('error', `Single upload failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload History routes
app.get('/api/history', (req: Request, res: Response) => {
  res.json({
    historyIds: Array.from(historySet),
    records: simulatedTracks,
  });
});

app.delete('/api/history/:postId', (req: Request, res: Response) => {
  const postId = String(req.params.postId);
  const existed = historySet.delete(postId);
  if (existed) {
    saveHistory(historySet);
    const idx = simulatedTracks.findIndex((t) => t.postId === postId);
    if (idx >= 0) simulatedTracks.splice(idx, 1);
    addLog('info', `Removed post #${postId} from history.`);
  }
  res.json({ success: true, postId, removed: existed });
});

app.post('/api/history/clear', (req: Request, res: Response) => {
  historySet.clear();
  saveHistory(historySet);
  simulatedTracks.length = 0;
  addLog('warn', 'Uploaded history cleared.');
  res.json({ success: true });
});

// S3 Browser
app.get('/api/s3/tracks', async (req: Request, res: Response) => {
  if (isS3Configured()) {
    try {
      const s3 = getS3Client();
      if (!s3) throw new Error('S3 client not initialized');

      const command = new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: 'tracks/',
        MaxKeys: 100,
      });

      const response = await s3.send(command);
      const items = (response.Contents || []).map((item) => ({
        key: item.Key || '',
        filename: (item.Key || '').replace('tracks/', ''),
        size: item.Size || 0,
        lastModified: item.LastModified?.toISOString() || null,
        publicUrl: `${s3Endpoint.replace(/\/$/, '')}/${s3Bucket}/${item.Key}`,
        isSimulated: false,
      }));

      res.json({ success: true, isConfigured: true, items });
      return;
    } catch (err: any) {
      addLog('error', `Error listing S3 objects: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
      return;
    }
  }

  // Not configured: return simulated items
  const items = simulatedTracks.map((item) => ({
    key: item.s3Key,
    filename: item.filename,
    size: item.fileSizeBytes || 3420000,
    lastModified: item.uploadedAt,
    publicUrl: item.s3PublicUrl,
    isSimulated: true,
  }));

  res.json({
    success: true,
    isConfigured: false,
    items,
  });
});

// Delete from S3
app.delete('/api/s3/tracks/:key(*)', async (req: Request, res: Response) => {
  const key = String(req.params.key);
  if (isS3Configured()) {
    try {
      const s3 = getS3Client();
      if (s3) {
        await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
        addLog('info', `Deleted object ${key} from S3 bucket ${s3Bucket}`);
      }
    } catch (err: any) {
      addLog('error', `Failed to delete from S3: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
      return;
    }
  }

  // Also remove from simulated tracks if present
  const idx = simulatedTracks.findIndex((t) => t.s3Key === key);
  if (idx >= 0) simulatedTracks.splice(idx, 1);

  res.json({ success: true, key });
});

// Audio streaming proxy to prevent browser CORS/Referrer blocks when playing Telegram audio
app.get('/api/stream-proxy', async (req: Request, res: Response) => {
  const audioUrl = req.query.url as string;
  if (!audioUrl) {
    res.status(400).send('Missing url param');
    return;
  }

  try {
    const upstreamRes = await fetch(audioUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://t.me/',
      },
    });

    if (!upstreamRes.ok) {
      res.status(upstreamRes.status).send(`Upstream error: ${upstreamRes.statusText}`);
      return;
    }

    const contentType = upstreamRes.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const arrayBuffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    res.status(500).send(`Proxy error: ${err.message}`);
  }
});

// Live Logs
app.get('/api/logs', (req: Request, res: Response) => {
  res.json({ logs });
});

app.post('/api/logs/clear', (req: Request, res: Response) => {
  logs.length = 0;
  res.json({ success: true });
});

// Mount Vite or static dist
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: 3000 },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    addLog('info', `Telegram Scraper server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Server startup failed:', err);
});
