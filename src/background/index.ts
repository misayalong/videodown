import { isStreamUrl, resolveInBackground } from '../platforms/background';
import type { ResolveRequest } from '../shared/media';
import { sanitizeFilename } from '../shared/filename';
import type {
  BgRequest,
  DirectDownloadRequest,
  DownloadResponse,
  MuxCancelMessage,
  MuxCancelRequest,
  MuxCancelledMessage,
  MuxCleanupMessage,
  MuxDoneMessage,
  MuxDownloadRequest,
  MuxErrorMessage,
  MuxProgressMessage,
  MuxStartMessage,
} from '../shared/types';

function hostOf(raw: unknown): string {
  try {
    return new URL(String(raw)).hostname;
  } catch {
    return '无法解析';
  }
}

function rejectStreamUrl(label: string, raw: unknown): DownloadResponse {
  // 主机名写进文案与 SW 控制台：CDN 域名变体（gvt1/新节点）出现时可直接定位
  const host = typeof raw === 'string' && raw ? hostOf(raw) : '缺失';
  console.error(`[VideoDown] ${label} 未通过白名单校验，host=${host}`);
  return { ok: false, error: `视频地址无效（${label}: ${host}）` };
}

interface MuxJob {
  jobId: string;
  tabId: number | null;
  filename: string;
}

// storage.session 兜底：SW 中途被杀重启后仍能完成 muxDone → 下载 的交接
async function loadJob(jobId: string): Promise<MuxJob | null> {
  const store = await chrome.storage.session.get(jobId);
  return (store[jobId] as MuxJob | undefined) ?? null;
}

async function saveJob(job: MuxJob): Promise<void> {
  await chrome.storage.session.set({ [job.jobId]: job, busy: job.jobId });
}

async function clearJob(jobId: string): Promise<void> {
  await chrome.storage.session.remove([jobId, 'busy']);
}

async function getBusyJobId(): Promise<string | null> {
  const store = await chrome.storage.session.get('busy');
  return (store['busy'] as string | undefined) ?? null;
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: '合并视频与音频轨道（remux）',
  });
}

function toOffscreen(req: MuxStartMessage | MuxCleanupMessage | MuxCancelMessage): void {
  void chrome.runtime.sendMessage(req).catch(() => undefined);
}

function toTab(tabId: number | null, message: unknown): void {
  if (tabId == null) return;
  void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

/** offscreen 无响应（被系统回收 / 卡在不可中断的合并上）时的强制释放延迟 */
const CANCEL_FALLBACK_MS = 3000;

chrome.runtime.onMessage.addListener((message: ResolveRequest | BgRequest | MuxProgressMessage | MuxDoneMessage | MuxErrorMessage | MuxCancelledMessage, sender, sendResponse) => {
  if (message?.type === 'resolve') {
    void resolveInBackground(message).then(sendResponse);
    return true;
  }
  // ---- 来自 offscreen 的进度链路 ----
  if (message?.type === 'muxProgress') {
    const msg = message as MuxProgressMessage;
    void loadJob(msg.jobId).then((job) => toTab(job?.tabId ?? null, msg));
    return undefined;
  }
  if (message?.type === 'muxDone') {
    const msg = message as MuxDoneMessage;
    void handleMuxDone(msg).catch(() => undefined);
    return undefined;
  }
  if (message?.type === 'muxError') {
    const msg = message as MuxErrorMessage;
    // 诊断信息同步落 SW 控制台（chrome://extensions → Service Worker），UI 只显示精简文案
    console.error(`[VideoDown] 合并失败 job=${msg.jobId}:`, msg.error);
    void loadJob(msg.jobId)
      .then((job) => {
        toTab(job?.tabId ?? null, { type: 'muxFailed', jobId: msg.jobId, error: msg.error });
      })
      .finally(() => clearJob(msg.jobId));
    return undefined;
  }

  if (message?.type === 'muxCancelled') {
    const msg = message as MuxCancelledMessage;
    void releaseJob(msg.jobId, 'muxCancelled');
    return undefined;
  }

  // ---- 来自 content 的下载请求 ----
  if (message?.type === 'download') {
    // 按字段形态而非 mode 字段分流：带 videoUrl 的一定是合并请求，
    // 防止任何形态的 mode 丢失把合并请求误送进直链分支（直链分支会因无 url 报"视频地址无效"）
    const isMux = message.mode === 'mux' || typeof (message as unknown as MuxDownloadRequest).videoUrl === 'string';
    if (isMux) {
      void handleMuxDownload(message as MuxDownloadRequest, sender.tab?.id ?? null).then(sendResponse);
      return true;
    }
    void handleDirectDownload(message as DirectDownloadRequest).then(sendResponse);
    return true;
  }
  if (message?.type === 'muxCancel') {
    const req = message as MuxCancelRequest;
    void handleMuxCancel(req.jobId).then(sendResponse);
    return true;
  }
  return undefined;
});

/**
 * 取消合并任务：能中断的立即中断（offscreen 的 fetch 走 AbortController），
 * 中断不了的由 offscreen 完成后丢弃结果。槽位释放以 muxCancelled 回执为准，
 * 另设 3s 兜底，避免 offscreen 失联导致永久占用。
 */
async function handleMuxCancel(jobId: string): Promise<DownloadResponse> {
  if (typeof jobId !== 'string' || !jobId) return { ok: false, error: '无效的取消请求' };
  if ((await getBusyJobId()) !== jobId) return { ok: true }; // 任务已结束，视为取消成功
  try {
    await ensureOffscreen();
    toOffscreen({ type: 'muxCancel', jobId });
  } catch {
    // offscreen 起不来时直接走兜底释放
  }
  setTimeout(() => void releaseJob(jobId, 'muxCancelled'), CANCEL_FALLBACK_MS);
  return { ok: true };
}

/** 释放槽位并通知发起标签页；幂等（busy 不匹配说明任务已正常结束） */
async function releaseJob(jobId: string, event: 'muxCancelled'): Promise<void> {
  if ((await getBusyJobId()) !== jobId) return;
  const job = await loadJob(jobId);
  await clearJob(jobId);
  toOffscreen({ type: 'muxCleanup', jobId });
  toTab(job?.tabId ?? null, { type: event, jobId });
}

async function handleDirectDownload(req: DirectDownloadRequest): Promise<DownloadResponse> {
  if (!isStreamUrl(req.url)) {
    return rejectStreamUrl('直链', req.url);
  }
  const filename = sanitizeFilename(String(req.filename ?? '')) || 'videodown.mp4';
  try {
    const id = await chrome.downloads.download({ url: req.url, filename, saveAs: false });
    return id !== undefined ? { ok: true } : { ok: false, error: '浏览器拒绝开始下载' };
  } catch {
    return { ok: false, error: '下载失败，视频链接可能已过期，请重新解析' };
  }
}

let startingMux = false;

async function handleMuxDownload(req: MuxDownloadRequest, tabId: number | null): Promise<DownloadResponse> {
  if (!isStreamUrl(req.videoUrl)) {
    return rejectStreamUrl('视频轨', req.videoUrl);
  }
  if (!isStreamUrl(req.audioUrl)) {
    return rejectStreamUrl('音频轨', req.audioUrl);
  }
  if (req.container !== 'mp4' && req.container !== 'webm') {
    return { ok: false, error: '不支持的封装格式' };
  }
  if (startingMux) return { ok: false, error: '已有合并任务进行中，请等待其完成' };
  startingMux = true;
  try {
    const busy = await getBusyJobId();
    if (busy) return { ok: false, error: '已有合并任务进行中，请等待其完成' };

    const jobId = `m${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    await saveJob({ jobId, tabId, filename: sanitizeFilename(String(req.filename ?? '')) || `videodown.${req.container}` });
    try {
      await ensureOffscreen();
      const start: MuxStartMessage = {
        type: 'muxStart',
        jobId,
        filename: (await loadJob(jobId))!.filename,
        container: req.container,
        videoUrl: req.videoUrl,
        videoCodec: req.videoCodec,
        audioUrl: req.audioUrl,
        audioCodec: req.audioCodec,
        videoBytes: typeof req.videoBytes === 'number' ? req.videoBytes : null,
        audioBytes: typeof req.audioBytes === 'number' ? req.audioBytes : null,
      };
      toOffscreen(start);
      return { ok: true, jobId };
    } catch {
      await clearJob(jobId);
      return { ok: false, error: '无法启动合并模块，请重试' };
    }
  } finally {
    startingMux = false;
  }
}

async function handleMuxDone(msg: MuxDoneMessage): Promise<void> {
  const job = await loadJob(msg.jobId);
  if (!job) {
    toOffscreen({ type: 'muxCleanup', jobId: msg.jobId });
    return;
  }
  try {
    const id = await chrome.downloads.download({ url: msg.blobUrl, filename: job.filename, saveAs: false });
    toTab(job.tabId, id !== undefined ? { type: 'muxComplete', jobId: msg.jobId } : { type: 'muxFailed', jobId: msg.jobId, error: '浏览器拒绝开始下载' });
  } catch {
    toTab(job.tabId, { type: 'muxFailed', jobId: msg.jobId, error: '下载失败，请重试' });
  } finally {
    toOffscreen({ type: 'muxCleanup', jobId: msg.jobId });
    await clearJob(msg.jobId);
  }
}
