/**
 * offscreen 页：完整 MP4 原样保存，或视频单轨 + 音频单轨 remux（不转码）。
 *
 * 阶段一：每条轨 **分段并发** 拉取（每路一个有界 Range，写盘时按序落盘）——
 *          2026-09-14 实测：GVS 对单连接限速约 0.7MB/s，而 4~8 路并发可达
 *          12~13MB/s（约 17 倍），且多路有界区间不会被 403（旧的「一 URL
 *          1~3 个请求」配额结论已不适用于 VISIONOS mint 的 URL）。
 *          段大小 8MB、按轮推进，内存占用与文件大小无关。
 *  阶段二：mediabunny 从本地 OPFS 文件解封装 → 编码包重组 MP4/WebM → OPFS 输出，
 *          全程零网络请求，随机访问无限制。
 * 输出经 blob URL 交 background 走 chrome.downloads。
 */
import {
  ALL_FORMATS,
  BlobSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
  type AudioCodec,
  type EncodedPacket,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoCodec,
} from 'mediabunny';
import type { FileStartMessage, MuxCancelMessage, MuxCleanupMessage, MuxStartMessage } from '../shared/types';

const PROGRESS_INTERVAL_MS = 800;
/** 错误仅包含主机和状态码，不显示带签名的流地址。 */
async function diagnoseFailure(url: string, res: Response): Promise<string> {
  return `拉流失败（HTTP ${res.status}，${new URL(url).hostname}），请重新解析后重试`;
}

/**
 * 当前任务。取消时同步置空，让新任务可以立刻接上（不等待旧任务的异步收尾）。
 */
interface ActiveRun {
  req: MuxStartMessage | FileStartMessage;
  controller: AbortController;
}
let activeRun: ActiveRun | null = null;

function report(msg: unknown): void {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

/** 已取消时抛出 AbortError：统一的中断信号，与真正的拉流/解码失败区分开 */
function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('任务已取消', 'AbortError');
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** 分段大小：8MB —— 兼顾并发收益与内存占用（每路最多缓存一段） */
const SEGMENT_BYTES = 8 * 1024 * 1024;
/** 单轨并发路数：实测 4~8 路即触及吞吐上限，再多无收益 */
const VIDEO_CONCURRENCY = 6;
const AUDIO_CONCURRENCY = 2;

/** 单轨分段并发下载到 OPFS；整段失败时整轮重试一次 */
async function downloadTrack(
  url: string,
  fileName: string,
  onBytes: (received: number) => void,
  totalHint: number | null,
  concurrency: number,
  signal: AbortSignal,
): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  let received = 0;
  try {
    // 总长度未知时退回单连接全量（仍可用，只是慢）
    if (!totalHint || totalHint <= 0) {
      const res = await fetch(url, { headers: { Range: 'bytes=0-' }, signal });
      if (!res.ok || !res.body) throw new Error(await diagnoseFailure(url, res));
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        throwIfCancelled(signal);
        await writable.write(value);
        received += value.length;
        onBytes(received);
      }
      await writable.close();
      return await handle.getFile();
    }

    const total = totalHint;
    const segments = Math.ceil(total / SEGMENT_BYTES);
    for (let start = 0; start < segments; ) {
      throwIfCancelled(signal);
      const batch = Math.min(concurrency, segments - start);
      const bufs = await Promise.all(
        Array.from({ length: batch }, (_, k) => fetchSegment(url, start + k, total, signal)),
      );
      // 按序落盘：段内已并发取回，写盘必须严格有序
      for (const buf of bufs) {
        throwIfCancelled(signal);
        await writable.write(buf);
        received += buf.byteLength;
        onBytes(received);
      }
      start += batch;
    }
    await writable.close();
    return await handle.getFile();
  } catch (err) {
    try {
      // 正常关闭时写入已落盘内容；取消时丢弃半成品
      await writable.abort();
    } catch {
      // 已关闭
    }
    try {
      await root.removeEntry(fileName);
    } catch {
      // 已删除
    }
    throw err instanceof Error ? err : new Error('拉流失败');
  }
}

/** 拉取单段（带一次重试）；失败时抛出带诊断的错误 */
async function fetchSegment(
  url: string,
  index: number,
  total: number,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const s = index * SEGMENT_BYTES;
  const e = Math.min(s + SEGMENT_BYTES - 1, total - 1);
  const range = `bytes=${s}-${e}`;
  let res = await fetch(url, { headers: { Range: range }, signal });
  if (!res.ok) {
    // 一次重试：CDN 抖动占多数，重试后仍失败才上报（避免整轮前功尽弃）
    try {
      await res.body?.cancel();
    } catch {
      // 已关闭
    }
    res = await fetch(url, { headers: { Range: range }, signal });
    if (!res.ok) throw new Error(await diagnoseFailure(url, res));
  }
  return new Uint8Array((await res.arrayBuffer()) as ArrayBuffer);
}

class ProgressReporter {
  private videoBytes = 0;
  private audioBytes = 0;
  private lastReport = 0;
  constructor(
    private readonly jobId: string,
    private readonly videoTotal: number | null,
    private readonly audioTotal: number | null,
  ) {}

  video(n: number): void {
    this.videoBytes = n;
    this.tick();
  }

  audio(n: number): void {
    this.audioBytes = n;
    this.tick();
  }

  private tick(): void {
    const now = Date.now();
    if (now - this.lastReport < PROGRESS_INTERVAL_MS) return;
    this.lastReport = now;
    report({ type: 'muxProgress', jobId: this.jobId, percent: this.percent() });
  }

  /** 下载完成后再进入合并阶段时，进度停在 99%，完成态由 muxDone 表达 */
  percent(): number {
    const vt = this.videoTotal ?? 0;
    const at = this.audioTotal ?? 0;
    // 完整文件没有独立音轨，audioTotal 为 0；未知长度仍用 null 表示。
    if (vt > 0 && this.audioTotal !== null && at >= 0) {
      return Math.min(99, Math.round(((this.videoBytes + this.audioBytes) / (vt + at)) * 100));
    }
    return 50; // 字节数未知时无法按比例，保持中间值直到完成
  }

  flush(): void {
    this.lastReport = 0;
    this.tick();
  }
}

async function pumpVideo(
  track: InputVideoTrack,
  source: EncodedVideoPacketSource,
  decoderConfig: VideoDecoderConfig,
  signal: AbortSignal,
): Promise<void> {
  const sink = new EncodedPacketSink(track);
  let packet: EncodedPacket | null = await sink.getFirstPacket();
  let first = true;
  while (packet) {
    // 阶段二（remux）无法真正中断 mediabunny 的读包，但每包检查一次可让取消
    // 在下一包就生效；实测 1080p 约 0.3s、240MB 的 2160p 也 <2s，感知不到延迟
    throwIfCancelled(signal);
    // 首包必须携带 decoderConfig（avcC 等封装所需的编解码私有数据）
    await source.add(packet, first ? { decoderConfig } : undefined);
    first = false;
    packet = await sink.getNextPacket(packet);
  }
}

async function pumpAudio(
  track: InputAudioTrack,
  source: EncodedAudioPacketSource,
  decoderConfig: AudioDecoderConfig,
  signal: AbortSignal,
): Promise<void> {
  const sink = new EncodedPacketSink(track);
  let packet: EncodedPacket | null = await sink.getFirstPacket();
  let first = true;
  while (packet) {
    throwIfCancelled(signal);
    await source.add(packet, first ? { decoderConfig } : undefined);
    first = false;
    packet = await sink.getNextPacket(packet);
  }
}

async function runDownload(req: MuxStartMessage | FileStartMessage, controller: AbortController): Promise<void> {
  const signal = controller.signal;
  // root 在 try 内获取：OPFS 不可用等环境性失败也必须走 muxError，不能变成无响应
  let root: FileSystemDirectoryHandle | null = null;
  const outName = `videodown-${req.jobId}.${req.type === 'fileStart' ? 'mp4' : req.container}`;
  const videoName = `videodown-${req.jobId}-v.bin`;
  const audioName = `videodown-${req.jobId}-a.bin`;
  const tempNames = [outName, videoName, audioName];
  let outWritable: FileSystemWritableFileStream | null = null;
  const cleanup = async (): Promise<void> => {
    try {
      await outWritable?.abort();
    } catch {
      // 已关闭
    }
    outWritable = null;
    if (!root) return;
    for (const name of tempNames) {
      try {
        await root.removeEntry(name);
      } catch {
        // 已删除
      }
    }
  };

  try {
    root = await navigator.storage.getDirectory();
    if (req.type === 'fileStart') {
      // offscreen 的 fetch 可命中限定扩展 initiator 的来源规则；原始文件不经过 remux。
      const progress = new ProgressReporter(req.jobId, req.fileBytes, 0);
      report({ type: 'muxProgress', jobId: req.jobId, percent: 0 });
      const file = await downloadTrack(req.url, outName, (n) => progress.video(n), req.fileBytes, VIDEO_CONCURRENCY, signal);
      progress.flush();
      throwIfCancelled(signal);
      report({ type: 'muxDone', jobId: req.jobId, blobUrl: URL.createObjectURL(file) });
      return;
    }
    // 阶段一：双轨并行，各一个流式连接顺序落盘（配额内）
    const progress = new ProgressReporter(req.jobId, req.videoBytes, req.audioBytes);
    report({ type: 'muxProgress', jobId: req.jobId, percent: 0 });
    const [videoFile, audioFile] = await Promise.all([
      downloadTrack(req.videoUrl, videoName, (n) => progress.video(n), req.videoBytes, VIDEO_CONCURRENCY, signal),
      downloadTrack(req.audioUrl, audioName, (n) => progress.audio(n), req.audioBytes, AUDIO_CONCURRENCY, signal),
    ]);
    progress.flush();
    throwIfCancelled(signal);

    // 阶段二：本地解封装 → 重组（零网络请求）
    const videoInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(videoFile) });
    const audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioFile) });
    const videoTrack = await videoInput.getPrimaryVideoTrack();
    const audioTrack = await audioInput.getPrimaryAudioTrack();
    if (!videoTrack || !audioTrack) throw new Error('视频流中缺少可用的视频或音频轨');

    outWritable = await (await root.getFileHandle(outName, { create: true })).createWritable();
    const output = new Output({
      format: req.container === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
      target: new StreamTarget(outWritable),
    });
    const videoSource = new EncodedVideoPacketSource(req.videoCodec as VideoCodec);
    const audioSource = new EncodedAudioPacketSource(req.audioCodec as AudioCodec);
    output.addVideoTrack(videoSource);
    output.addAudioTrack(audioSource);
    await output.start();

    const [videoDecoderConfig, audioDecoderConfig] = await Promise.all([
      videoTrack.getDecoderConfig(),
      audioTrack.getDecoderConfig(),
    ]);
    if (!videoDecoderConfig || !audioDecoderConfig) throw new Error('无法获取流的编解码配置');

    await Promise.all([
      pumpVideo(videoTrack, videoSource, videoDecoderConfig, signal),
      pumpAudio(audioTrack, audioSource, audioDecoderConfig, signal),
    ]);
    throwIfCancelled(signal);

    await output.finalize();
    // StreamTarget 在 _finalize() 内部已取得 writer 并 close() 该 WritableStream，
    // 此处不可再 close()（会抛 "Cannot close a locked/already-closed stream"）。
    outWritable = null;
    // finalize 之后仍可能被取消：此时结果直接丢弃，不交给浏览器下载
    throwIfCancelled(signal);

    const file = await (await root.getFileHandle(outName)).getFile();
    const blobUrl = URL.createObjectURL(file);
    report({ type: 'muxDone', jobId: req.jobId, blobUrl });
  } catch (err) {
    // 取消不是错误：静默清理，走 muxCancelled 让后台立即释放槽位
    if (isCancelled(err)) {
      await cleanup();
      report({ type: 'muxCancelled', jobId: req.jobId });
      return;
    }
    console.error('[VideoDown] 下载失败：', err);
    await cleanup();
    report({ type: 'muxError', jobId: req.jobId, error: err instanceof Error ? err.message : '下载失败' });
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as Partial<MuxStartMessage | FileStartMessage | MuxCleanupMessage | MuxCancelMessage>;
  if (typeof msg?.jobId === 'string' &&
    ((msg.type === 'muxStart' && typeof msg.videoUrl === 'string') ||
      (msg.type === 'fileStart' && typeof msg.url === 'string'))) {
    const req = msg as MuxStartMessage | FileStartMessage;
    if (activeRun) {
      report({ type: 'muxError', jobId: req.jobId, error: '已有下载任务进行中，请稍候' });
      return undefined;
    }
    const controller = new AbortController();
    activeRun = { req, controller };
    void runDownload(req, controller).finally(() => {
      // 只有仍是自己这一轮才清空：取消时 activeRun 已被置空并可能换成新任务
      if (activeRun?.req === req) activeRun = null;
    });
    return undefined;
  }
  if (msg?.type === 'muxCancel' && typeof msg.jobId === 'string') {
    const run = activeRun;
    if (run && run.req.jobId === msg.jobId) {
      // 同步让位：新任务无需等待旧任务的异步收尾（清理仍在后台进行）
      activeRun = null;
      run.controller.abort();
    }
    // 无论是否真的在跑都回执，让 background 释放槽位（它可能已结束或从未开始）
    report({ type: 'muxCancelled', jobId: msg.jobId });
    return undefined;
  }
  if (msg?.type === 'muxCleanup' && typeof msg.jobId === 'string') {
    // 下载已接管 blob URL，延迟回收，避免过早 revoke
    const jobId = msg.jobId;
    setTimeout(() => {
      void (async () => {
        try {
          const root = await navigator.storage.getDirectory();
          for (const name of [nameFor(jobId, 'mp4'), nameFor(jobId, 'webm'), nameFor(jobId, 'v.bin'), nameFor(jobId, 'a.bin')]) {
            try {
              await root.removeEntry(name);
            } catch {
              // 不存在
            }
          }
        } catch {
          // 忽略
        }
      })();
    }, 60_000);
    return undefined;
  }
  return undefined;
});

function nameFor(jobId: string, suffix: string): string {
  if (suffix === 'v.bin' || suffix === 'a.bin') return `videodown-${jobId}-${suffix}`;
  return `videodown-${jobId}.${suffix}`;
}

console.info('[VideoDown] offscreen mux page ready');
