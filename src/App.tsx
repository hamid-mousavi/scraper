import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  CloudUpload,
  RefreshCw,
  HardDrive,
  Terminal,
  Settings,
  GitBranch,
  Volume2,
  VolumeX,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Radio,
  FileAudio,
  Trash2,
  Copy,
  Check,
  Search,
  Server,
  Zap,
} from 'lucide-react';

interface ChannelInfo {
  name: string;
  title: string;
  avatar?: string;
  subscribers?: string;
  description?: string;
}

interface TrackItem {
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
  isUploaded?: boolean;
}

interface S3Item {
  key: string;
  filename: string;
  size: number;
  lastModified?: string;
  publicUrl?: string;
  isSimulated?: boolean;
}

interface ServerLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  channel?: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'feed' | 's3' | 'workflow' | 'logs' | 'settings'>('feed');
  const [status, setStatus] = useState<any>(null);
  const [channel, setChannel] = useState('MajalesAlKhaqani');
  const [channelInfo, setChannelInfo] = useState<ChannelInfo | null>(null);
  const [tracks, setTracks] = useState<TrackItem[]>([]);
  const [s3Items, setS3Items] = useState<S3Item[]>([]);
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isProcessingSync, setIsProcessingSync] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Audio Player State
  const [playingTrack, setPlayingTrack] = useState<{
    id: string;
    title: string;
    performer: string;
    url: string;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Settings form
  const [configForm, setConfigForm] = useState({
    channel: 'MajalesAlKhaqani',
    endpoint: '',
    bucket: '',
    accessKey: '',
    secretKey: '',
  });
  const [configSavedNotice, setConfigSavedNotice] = useState(false);

  // Fetch initial status and preview
  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetchPreview();
    fetchS3Items();

    const interval = setInterval(() => {
      fetchLogs();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      setStatus(data);
      if (data.activeChannel) {
        setChannel(data.activeChannel);
        setConfigForm((prev) => ({ ...prev, channel: data.activeChannel }));
      }
    } catch (e) {
      console.error('Error fetching status:', e);
    }
  };

  const fetchPreview = async (targetChannel = channel) => {
    setIsLoadingPreview(true);
    try {
      const res = await fetch(`/api/scrape/preview?channel=${encodeURIComponent(targetChannel)}`);
      const data = await res.json();
      if (data.success) {
        setTracks(data.tracks || []);
        setChannelInfo(data.channelInfo || null);
      }
    } catch (e) {
      console.error('Error loading preview:', e);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const fetchS3Items = async () => {
    try {
      const res = await fetch('/api/s3/tracks');
      const data = await res.json();
      if (data.success) {
        setS3Items(data.items || []);
      }
    } catch (e) {
      console.error('Error loading S3 tracks:', e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (e) {
      console.error('Error fetching logs:', e);
    }
  };

  const handleRunFullSync = async () => {
    setIsProcessingSync(true);
    try {
      const res = await fetch('/api/scrape/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      await fetchPreview();
      await fetchS3Items();
      await fetchStatus();
      await fetchLogs();
    } catch (e) {
      console.error('Error running full sync:', e);
    } finally {
      setIsProcessingSync(false);
    }
  };

  const handleUploadSingleTrack = async (track: TrackItem) => {
    try {
      const res = await fetch('/api/upload/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track }),
      });
      const data = await res.json();
      if (data.success) {
        setTracks((prev) =>
          prev.map((t) => (t.postId === track.postId ? { ...t, isUploaded: true } : t))
        );
        fetchS3Items();
        fetchStatus();
        fetchLogs();
      }
    } catch (e) {
      console.error('Upload error:', e);
    }
  };

  const handleDeleteS3Track = async (key: string, postId?: string) => {
    if (!confirm(`آیا از حذف فایل ${key} اطمینان دارید؟`)) return;
    try {
      await fetch(`/api/s3/tracks/${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (postId) {
        await fetch(`/api/history/${postId}`, { method: 'DELETE' });
      }
      fetchS3Items();
      fetchPreview();
      fetchStatus();
      fetchLogs();
    } catch (e) {
      console.error('Delete error:', e);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm),
      });
      setConfigSavedNotice(true);
      setTimeout(() => setConfigSavedNotice(false), 3000);
      setChannel(configForm.channel);
      fetchStatus();
      fetchPreview(configForm.channel);
      fetchS3Items();
      fetchLogs();
    } catch (e) {
      console.error('Failed to save config:', e);
    }
  };

  const playAudio = (id: string, title: string, performer: string, rawUrl: string) => {
    // Use the streaming proxy to avoid browser CORS/referrer restrictions on Telegram audio CDN
    const proxyUrl = `/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`;
    if (playingTrack?.id === id) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play();
        setIsPlaying(true);
      }
      return;
    }

    setPlayingTrack({ id, title, performer, url: proxyUrl });
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.src = proxyUrl;
      audioRef.current.play().catch((err) => console.log('Playback error:', err));
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredTracks = tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.performer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.postId.includes(searchTerm)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans" dir="rtl">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Radio className="h-5 w-5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-lg text-white tracking-wide">
                  پایپ‌لاین اسکرپر تلگرام به ابر آروان
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                  v1.0
                </span>
              </div>
              <p className="text-xs text-slate-400">
                همگام‌سازی خودکار و دانلود فایل‌های صوتی به آبجکت‌استوریج S3
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* S3 Status Indicator */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border ${
                status?.isS3Configured
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                  : 'bg-amber-950/50 text-amber-300 border-amber-800'
              }`}
            >
              <div
                className={`h-2 w-2 rounded-full ${
                  status?.isS3Configured ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'
                }`}
              />
              <span>
                {status?.isS3Configured
                  ? `متصل به آروان S3 (${status.s3Bucket})`
                  : 'حالت سندباکس شبیه‌ساز (کلیدهای S3 تنظیم نشده)'}
              </span>
            </div>

            {/* Quick Run Button */}
            <button
              onClick={handleRunFullSync}
              disabled={isProcessingSync || isLoadingPreview}
              className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-sm px-4 py-2 rounded-lg shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isProcessingSync ? 'animate-spin' : ''}`} />
              <span>{isProcessingSync ? 'در حال همگام‌سازی...' : 'اسکرپ و آپلود فوری'}</span>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex gap-2 border-t border-slate-800/60 pt-1">
          <button
            onClick={() => setActiveTab('feed')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'feed'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="h-4 w-4" />
            <span>کانال تلگرام ({tracks.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('s3')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 's3'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="h-4 w-4" />
            <span>فایل‌های آروان S3 ({s3Items.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('workflow')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'workflow'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch className="h-4 w-4" />
            <span>ورکفلو GitHub Actions</span>
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'logs'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="h-4 w-4" />
            <span>لاگ‌های سیستم ({logs.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="h-4 w-4" />
            <span>تنظیمات و متغیرها</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Channel Info Card Banner */}
        {channelInfo && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
            <div className="flex items-center gap-4">
              {channelInfo.avatar ? (
                <img
                  src={channelInfo.avatar}
                  alt={channelInfo.title}
                  className="h-14 w-14 rounded-2xl object-cover border border-slate-700 shadow-md"
                />
              ) : (
                <div className="h-14 w-14 rounded-2xl bg-cyan-950 border border-cyan-800 flex items-center justify-center font-bold text-xl text-cyan-400">
                  {channelInfo.name.substring(0, 2).toUpperCase()}
                </div>
              )}
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold text-white">{channelInfo.title}</h2>
                  <a
                    href={`https://t.me/s/${channelInfo.name}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono"
                    dir="ltr"
                  >
                    @{channelInfo.name} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {channelInfo.description && (
                  <p className="text-sm text-slate-400 mt-1 max-w-2xl line-clamp-2">
                    {channelInfo.description}
                  </p>
                )}
                {channelInfo.subscribers && (
                  <span className="inline-block mt-1 text-xs text-slate-500">
                    {channelInfo.subscribers} عضو
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <div className="text-right pl-4 border-l border-slate-800">
                <div className="text-xs text-slate-400">کل ترک‌های یافت شده</div>
                <div className="text-xl font-bold text-white">{tracks.length}</div>
              </div>
              <div className="text-right pl-4 border-l border-slate-800">
                <div className="text-xs text-slate-400">آپلود شده</div>
                <div className="text-xl font-bold text-emerald-400">
                  {tracks.filter((t) => t.isUploaded).length}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">در انتظار آپلود</div>
                <div className="text-xl font-bold text-amber-400">
                  {tracks.filter((t) => !t.isUploaded).length}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: TELEGRAM FEED */}
        {activeTab === 'feed' && (
          <div className="space-y-4">
            {/* Search & Actions Filter */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <div className="relative w-full sm:w-96">
                <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="جستجو بر اساس عنوان یا مداح/خواننده..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pr-9 pl-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  onClick={() => fetchPreview()}
                  disabled={isLoadingPreview}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingPreview ? 'animate-spin' : ''}`} />
                  <span>بروزرسانی لیست کانال</span>
                </button>
              </div>
            </div>

            {/* Track List Cards */}
            {isLoadingPreview && tracks.length === 0 ? (
              <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center">
                <RefreshCw className="h-8 w-8 text-cyan-400 animate-spin mb-3" />
                <p>در حال دریافت اطلاعات و فایل‌های صوتی از کانال تلگرام...</p>
              </div>
            ) : filteredTracks.length === 0 ? (
              <div className="py-16 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
                <FileAudio className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p>هیچ فایل صوتی در این بخش یافت نشد.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTracks.map((track) => {
                  const isCurrentPlaying = playingTrack?.id === track.postId && isPlaying;
                  return (
                    <div
                      key={track.postId}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 transition-all shadow-md hover:shadow-cyan-950/20 flex flex-col justify-between"
                    >
                      <div>
                        {/* Header: Title, Performer, Post ID */}
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() =>
                                playAudio(
                                  track.postId,
                                  track.title,
                                  track.performer,
                                  track.audioUrl
                                )
                              }
                              className={`h-11 w-11 rounded-xl flex items-center justify-center transition-all ${
                                isCurrentPlaying
                                  ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/30'
                                  : 'bg-slate-800 hover:bg-slate-700 text-cyan-400'
                              }`}
                            >
                              {isCurrentPlaying ? (
                                <Pause className="h-5 w-5 fill-current" />
                              ) : (
                                <Play className="h-5 w-5 fill-current ml-0.5" />
                              )}
                            </button>
                            <div>
                              <h3 className="font-semibold text-white text-base line-clamp-1">
                                {track.title}
                              </h3>
                              <p className="text-xs text-cyan-400 font-medium">
                                {track.performer}
                              </p>
                            </div>
                          </div>

                          {/* Status Badge */}
                          {track.isUploaded ? (
                            <span className="flex items-center gap-1 text-[11px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="h-3 w-3" />
                              آپلود شده در S3
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-medium bg-amber-950/60 text-amber-400 border border-amber-800/80 px-2 py-0.5 rounded-full">
                              <Clock className="h-3 w-3" />
                              در انتظار همگام‌سازی
                            </span>
                          )}
                        </div>

                        {/* Message Preview Text */}
                        {track.messageSnippet && (
                          <p className="text-xs text-slate-400 bg-slate-950/50 p-2 rounded-lg my-2 line-clamp-2 leading-relaxed">
                            {track.messageSnippet}
                          </p>
                        )}

                        {/* Metadata row */}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono mt-2" dir="ltr">
                          <span>Post #{track.postId}</span>
                          {track.date && <span>• {new Date(track.date).toLocaleDateString()}</span>}
                          <span>• {track.filename}</span>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3 mt-3">
                        <a
                          href={track.postUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>مشاهده پست تلگرام</span>
                        </a>

                        {!track.isUploaded ? (
                          <button
                            onClick={() => handleUploadSingleTrack(track)}
                            className="flex items-center gap-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <CloudUpload className="h-3.5 w-3.5" />
                            <span>آپلود فوری به آروان</span>
                          </button>
                        ) : (
                          <span className="text-xs text-emerald-500 flex items-center gap-1 font-mono" dir="ltr">
                            <Check className="h-3.5 w-3.5" /> tracks/{track.filename}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ARVAN S3 BUCKET BROWSER */}
        {activeTab === 's3' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <div>
                <h3 className="font-bold text-white text-base">
                  لیست فایل‌های صوتی در پوشه tracks/
                </h3>
                <p className="text-xs text-slate-400">
                  فایل‌های با دسترسی عمومی (public-read) بارگذاری شده روی باکت{' '}
                  <span className="text-cyan-400 font-mono" dir="ltr">
                    {status?.s3Bucket || 'ARVAN_BUCKET_NAME'}
                  </span>
                </p>
              </div>
              <button
                onClick={fetchS3Items}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>بروزرسانی لیست S3</span>
              </button>
            </div>

            {s3Items.length === 0 ? (
              <div className="py-20 text-center text-slate-400 bg-slate-900/40 rounded-2xl border border-slate-800">
                <HardDrive className="h-12 w-12 text-slate-600 mx-auto mb-3" />
                <p className="font-medium text-slate-300">هنوز فایلی در باکت آپلود نشده است.</p>
                <p className="text-xs text-slate-500 mt-1">
                  می‌توانید با زدن دکمه «اسکرپ و آپلود فوری» فایل‌های جدید کانال را بارگذاری کنید.
                </p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-sm">
                    <thead className="bg-slate-950 text-slate-400 text-xs font-medium border-b border-slate-800">
                      <tr>
                        <th className="px-4 py-3">نام فایل</th>
                        <th className="px-4 py-3">اندازه</th>
                        <th className="px-4 py-3">تاریخ ایجاد</th>
                        <th className="px-4 py-3 text-center">پخش / تست</th>
                        <th className="px-4 py-3 text-left">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {s3Items.map((item) => {
                        const isCurrentPlaying =
                          playingTrack?.id === item.key && isPlaying;
                        return (
                          <tr key={item.key} className="hover:bg-slate-800/40 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <FileAudio className="h-4 w-4 text-cyan-400 shrink-0" />
                                <span className="font-mono text-xs text-white" dir="ltr">
                                  {item.filename}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400 font-mono" dir="ltr">
                              {(item.size / (1024 * 1024)).toFixed(2)} MB
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {item.lastModified
                                ? new Date(item.lastModified).toLocaleString('fa-IR')
                                : 'امروز'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {item.publicUrl ? (
                                <button
                                  onClick={() =>
                                    playAudio(
                                      item.key,
                                      item.filename,
                                      'Arvan S3 Storage',
                                      item.publicUrl!
                                    )
                                  }
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 inline-flex items-center justify-center"
                                  title="پخش مستقیم فایل صوتی"
                                >
                                  {isCurrentPlaying ? (
                                    <Pause className="h-4 w-4" />
                                  ) : (
                                    <Play className="h-4 w-4 ml-0.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="text-xs text-slate-600">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-left">
                              <div className="flex items-center justify-end gap-2">
                                {item.publicUrl && (
                                  <button
                                    onClick={() => copyToClipboard(item.publicUrl!, item.key)}
                                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                    title="کپی لینک عمومی فایل"
                                  >
                                    {copiedKey === item.key ? (
                                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                )}
                                <button
                                  onClick={() => handleDeleteS3Track(item.key)}
                                  className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-400 transition-colors"
                                  title="حذف از مخزن"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: GITHUB ACTIONS WORKFLOW SPEC & SECRETS GUIDE */}
        {activeTab === 'workflow' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400">
                  <GitBranch className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    ورکفلو GitHub Actions: Audio Sync Pipeline
                  </h3>
                  <p className="text-xs text-slate-400">
                    مسیر فایل:{' '}
                    <span className="font-mono text-cyan-400" dir="ltr">
                      .github/workflows/audio-sync.yml
                    </span>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold mb-1">
                    <Clock className="h-4 w-4" />
                    زمان‌بندی کرون (Cron)
                  </div>
                  <div className="font-mono text-base font-bold text-white" dir="ltr">
                    0 */4 * * *
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    اجرا خودکار هر ۴ ساعت یک‌بار روی گیت‌هاب
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold mb-1">
                    <Zap className="h-4 w-4" />
                    اجرای دستی (workflow_dispatch)
                  </div>
                  <div className="text-sm font-bold text-white">فعال</div>
                  <div className="text-xs text-slate-400 mt-1">
                    امکان فشردن دکمه Run Workflow در تب Actions گیت‌هاب
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-2 text-purple-400 text-xs font-semibold mb-1">
                    <Server className="h-4 w-4" />
                    محیط اجرا
                  </div>
                  <div className="font-mono text-sm font-bold text-white" dir="ltr">
                    ubuntu-latest (Python 3.11)
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    همگام‌سازی تاریخچه و کامیت خودکار
                  </div>
                </div>
              </div>

              {/* Secrets Checklist */}
              <div className="mb-6">
                <h4 className="font-semibold text-white text-sm mb-3">
                  سکرت‌های مورد نیاز در مخزن گیت‌هاب (Settings &gt; Secrets and variables &gt; Actions):
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      name: 'ARVAN_ENDPOINT',
                      desc: 'آدرس سرور S3 آروان (مثلاً https://s3.ir-thr-at1.arvanstorage.ir)',
                    },
                    {
                      name: 'ARVAN_ACCESS_KEY',
                      desc: 'شناسه کلید دسترسی (Access Key ID) در پنل ابر آروان',
                    },
                    {
                      name: 'ARVAN_SECRET_KEY',
                      desc: 'کلید محرمانه (Secret Access Key)',
                    },
                    {
                      name: 'ARVAN_BUCKET_NAME',
                      desc: 'نام باکت تعریف شده در فضای ذخیره‌سازی ابری آروان',
                    },
                  ].map((sec) => (
                    <div
                      key={sec.name}
                      className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-start gap-3"
                    >
                      <div className="h-6 w-6 rounded bg-slate-800 flex items-center justify-center text-xs text-cyan-400 font-bold shrink-0 mt-0.5">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <div className="font-mono font-semibold text-xs text-cyan-300" dir="ltr">
                          {sec.name}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{sec.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Workflow Code Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-mono">
                    .github/workflows/audio-sync.yml
                  </span>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `name: Audio Sync Pipeline\n\non:\n  schedule:\n    - cron: '0 */4 * * *'\n  workflow_dispatch:\n\njobs:\n  scrape-and-upload:\n    runs-on: ubuntu-latest\n...`,
                        'workflow'
                      )
                    }
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                  >
                    {copiedKey === 'workflow' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>کپی سورس ورکفلو</span>
                  </button>
                </div>
                <pre
                  className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed max-h-72"
                  dir="ltr"
                >
{`name: Audio Sync Pipeline

on:
  schedule:
    # اجرا هر ۴ ساعت یکبار به صورت خودکار
    - cron: '0 */4 * * *'
  # امکان اجرای دستی از تب Actions در گیتهاب
  workflow_dispatch:

jobs:
  scrape-and-upload:
    runs-on: ubuntu-latest

    steps:
      - name: بررسی سورس کد ریپازیتوری
        uses: actions/checkout@v4

      - name: راهاندازی پایتون
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: نصب کتابخانهها
        run: |
          pip install --upgrade pip
          pip install -r requirements.txt

      - name: اجرای اسکریپت دانلود و آپلود
        env:
          ARVAN_ENDPOINT: \${{ secrets.ARVAN_ENDPOINT }}
          ARVAN_ACCESS_KEY: \${{ secrets.ARVAN_ACCESS_KEY }}
          ARVAN_SECRET_KEY: \${{ secrets.ARVAN_SECRET_KEY }}
          ARVAN_BUCKET_NAME: \${{ secrets.ARVAN_BUCKET_NAME }}
        run: python scraper.py

      - name: ذخیره تاریخچه فایلها برای جلوگیری از تکرار
        run: |
          git config --global user.name "github-actions[bot]"
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git add uploaded_history.txt
          git diff --quiet && git diff --staged --quiet || (git commit -m "chore: بروزرسانی تاریخچه دانلود" && git push)`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: SYSTEM LOGS */}
        {activeTab === 'logs' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-cyan-400" />
                <h3 className="font-bold text-white text-base">کنسول لاگ‌های فرآیند اسکرپ و آپلود</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await fetch('/api/logs/clear', { method: 'POST' });
                    setLogs([]);
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  پاکسازی لاگ‌ها
                </button>
              </div>
            </div>

            <div
              className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-y-auto max-h-[500px] space-y-2 leading-relaxed"
              dir="ltr"
            >
              {logs.length === 0 ? (
                <div className="text-slate-600 text-center py-10">هنوز لاگی ثبت نشده است.</div>
              ) : (
                logs.map((log) => {
                  let badgeColor = 'text-slate-400 bg-slate-800';
                  if (log.level === 'info') badgeColor = 'text-blue-400 bg-blue-950/70 border border-blue-900';
                  if (log.level === 'success') badgeColor = 'text-emerald-400 bg-emerald-950/70 border border-emerald-900';
                  if (log.level === 'warn') badgeColor = 'text-amber-400 bg-amber-950/70 border border-amber-900';
                  if (log.level === 'error') badgeColor = 'text-rose-400 bg-rose-950/70 border border-rose-900';

                  return (
                    <div key={log.id} className="flex items-start gap-2 py-0.5 hover:bg-slate-900/60 rounded px-1">
                      <span className="text-slate-600 shrink-0 select-none">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase shrink-0 ${badgeColor}`}>
                        {log.level}
                      </span>
                      <span className="text-slate-300 break-all">{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 5: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2">تنظیمات کانال و ابر آروان (S3)</h3>
            <p className="text-xs text-slate-400 mb-6">
              می‌توانید اطلاعات اتصال به باکت ذخیره‌سازی ابری آروان یا کانال هدف را در این بخش تنظیم کنید.
            </p>

            {configSavedNotice && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                تنظیمات با موفقیت ذخیره و اعمال شد.
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  نام کانال تلگرام (بدون @ یا با @)
                </label>
                <input
                  type="text"
                  value={configForm.channel}
                  onChange={(e) => setConfigForm({ ...configForm, channel: e.target.value })}
                  placeholder="MajalesAlKhaqani"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  آدرس اندپوینت S3 ابر آروان (ARVAN_ENDPOINT)
                </label>
                <input
                  type="text"
                  value={configForm.endpoint}
                  onChange={(e) => setConfigForm({ ...configForm, endpoint: e.target.value })}
                  placeholder="https://s3.ir-thr-at1.arvanstorage.ir"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  نام باکت (ARVAN_BUCKET_NAME)
                </label>
                <input
                  type="text"
                  value={configForm.bucket}
                  onChange={(e) => setConfigForm({ ...configForm, bucket: e.target.value })}
                  placeholder="my-audio-bucket"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Access Key (ARVAN_ACCESS_KEY)
                  </label>
                  <input
                    type="password"
                    value={configForm.accessKey}
                    onChange={(e) => setConfigForm({ ...configForm, accessKey: e.target.value })}
                    placeholder="••••••••••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Secret Key (ARVAN_SECRET_KEY)
                  </label>
                  <input
                    type="password"
                    value={configForm.secretKey}
                    onChange={(e) => setConfigForm({ ...configForm, secretKey: e.target.value })}
                    placeholder="••••••••••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="submit"
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm px-5 py-2 rounded-lg transition-colors"
                >
                  ذخیره و تست اتصال
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      {/* Persistent Audio Bottom Bar */}
      {playingTrack && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-3 z-50 shadow-2xl">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-1/3">
              <button
                onClick={() => {
                  if (isPlaying) {
                    audioRef.current?.pause();
                    setIsPlaying(false);
                  } else {
                    audioRef.current?.play();
                    setIsPlaying(true);
                  }
                }}
                className="h-10 w-10 rounded-xl bg-cyan-500 text-slate-950 flex items-center justify-center shrink-0 hover:scale-105 transition-all shadow-md"
              >
                {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
              </button>
              <div className="overflow-hidden">
                <div className="font-semibold text-sm text-white truncate">
                  {playingTrack.title}
                </div>
                <div className="text-xs text-cyan-400 truncate">
                  {playingTrack.performer}
                </div>
              </div>
            </div>

            {/* Scrubber progress */}
            <div className="flex-1 flex items-center gap-3">
              <span className="text-[11px] font-mono text-slate-400" dir="ltr">
                {Math.floor(audioCurrentTime / 60)}:
                {String(Math.floor(audioCurrentTime % 60)).padStart(2, '0')}
              </span>
              <input
                type="range"
                min="0"
                max={audioDuration || 100}
                value={audioCurrentTime}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setAudioCurrentTime(val);
                  if (audioRef.current) audioRef.current.currentTime = val;
                }}
                className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
              <span className="text-[11px] font-mono text-slate-400" dir="ltr">
                {Math.floor(audioDuration / 60)}:
                {String(Math.floor(audioDuration % 60)).padStart(2, '0')}
              </span>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2 w-1/4 justify-end">
              <button
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.muted = !isMuted;
                    setIsMuted(!isMuted);
                  }
                }}
                className="text-slate-400 hover:text-white"
              >
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setVolume(val);
                  setIsMuted(false);
                  if (audioRef.current) {
                    audioRef.current.volume = val;
                    audioRef.current.muted = false;
                  }
                }}
                className="w-20 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setAudioCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setAudioDuration(audioRef.current.duration);
        }}
        onEnded={() => setIsPlaying(false)}
      />
    </div>
  );
}
