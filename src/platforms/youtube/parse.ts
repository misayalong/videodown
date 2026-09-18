import type { ParsedVideo, RawFormat, SolvePayload, VideoVariant } from './types';

export class ParseError extends Error {}

/** 低于此高度的单轨视频不提供（360p 有渐进式单文件覆盖，240p/144p 无意义） */
const MIN_MUX_HEIGHT = 480;

type VideoCodecName = 'avc' | 'av1' | 'vp9' | 'hevc';
type AudioCodecName = 'aac' | 'opus';

/**
 * 将 MAIN world 交付的格式清单整理成菜单项。
 *
 * - 渐进式（itag 18 = 360p）与 m4a 音频是直链下载；
 * - 480p~4K 是视频单轨，需要与音轨 remux 合并（不转码）：mp4 容器配 m4a，
 *   webm 容器配 opus；每个高度只保留一条，优先 mp4（avc1 优先于 av01）。
 */
export function parsePlayerPayload(payload: SolvePayload): ParsedVideo {
  const videoVariants = extractVideoVariants(payload.progressive, payload.adaptive);
  const audioVariants = extractAudioVariants(payload.adaptive);
  const variants = [...videoVariants, ...audioVariants];
  if (!variants.length) throw new ParseError('未找到可下载的格式（可能受版权保护或为直播）');
  return { ...payload.meta, variants };
}

function codecOf(mimeType: string): { container: 'mp4' | 'webm'; video: VideoCodecName | null; audio: AudioCodecName | null } {
  const container = mimeType.startsWith('video/webm') || mimeType.startsWith('audio/webm') ? 'webm' : 'mp4';
  const codec = /codecs="?([^";]+)"?/.exec(mimeType)?.[1] ?? '';
  const video = /(^|[,.])avc1|av01|vp9|vp09|hvc1|hev1/.test(codec) ? videoCodecOf(codec) : null;
  const audio = /mp4a|opus/.test(codec) ? (/opus/.test(codec) ? 'opus' : 'aac') : null;
  return { container, video, audio };
}

function videoCodecOf(codec: string): VideoCodecName | null {
  if (/avc1/i.test(codec)) return 'avc';
  if (/av01/i.test(codec)) return 'av1';
  if (/vp9|vp09/i.test(codec)) return 'vp9';
  if (/hvc1|hev1/i.test(codec)) return 'hevc';
  return null;
}

/** 每个音频容器保留一条码率最高的音轨（按 itag 去重，滤掉多语言重复项） */
function bestAudioByContainer(adaptive: RawFormat[]): { mp4: RawFormat | null; webm: RawFormat | null } {
  const best = (predicate: (f: RawFormat) => boolean): RawFormat | null => {
    const pool = new Map<number, RawFormat>();
    for (const f of adaptive) {
      if (!predicate(f)) continue;
      const key = f.itag ?? -1;
      const cur = pool.get(key);
      if (!cur || (f.bitrate ?? 0) > (cur.bitrate ?? 0)) pool.set(key, f);
    }
    return [...pool.values()].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ?? null;
  };
  return {
    mp4: best((f) => f.mimeType.startsWith('audio/mp4')),
    webm: best((f) => f.mimeType.startsWith('audio/webm')),
  };
}

function extractVideoVariants(progressive: RawFormat[], adaptive: RawFormat[]): VideoVariant[] {
  const audio = bestAudioByContainer(adaptive);
  const audioFor = (container: 'mp4' | 'webm'): RawFormat | null => (container === 'mp4' ? audio.mp4 : audio.webm);

  // 渐进式（音视频合一）：同一高度直接用单文件，不再提供 mux 项
  const progressiveHeights = new Map<number, RawFormat>();
  for (const f of progressive) {
    if (!f.mimeType.startsWith('video/mp4')) continue;
    const key = f.height ?? f.itag ?? 0;
    const cur = progressiveHeights.get(key);
    if (!cur || (f.bitrate ?? 0) > (cur.bitrate ?? 0)) progressiveHeights.set(key, f);
  }

  // 视频单轨按高度分组，容器偏好：mp4（avc1 > av01 > hevc）→ webm（vp9）
  const byHeight = new Map<number, RawFormat[]>();
  for (const f of adaptive) {
    if (!f.mimeType.startsWith('video/')) continue;
    if ((f.height ?? 0) < MIN_MUX_HEIGHT) continue;
    const list = byHeight.get(f.height!) ?? [];
    list.push(f);
    byHeight.set(f.height!, list);
  }

  const pick = (list: RawFormat[]): RawFormat | null => {
    const score = (f: RawFormat): number => {
      const { container, video } = codecOf(f.mimeType);
      if (container === 'mp4' && video === 'avc') return 4;
      if (container === 'mp4' && video === 'av1') return 3;
      if (container === 'mp4' && video === 'hevc') return 2;
      if (container === 'webm' && video === 'vp9') return 1;
      return 0; // 不支持的编码组合
    };
    let best: RawFormat | null = null;
    let bestScore = 0;
    for (const f of list) {
      const s = score(f);
      if (s === 0) continue;
      if (s > bestScore) {
        best = f;
        bestScore = s;
      } else if (s === bestScore && best && (f.bitrate ?? 0) > (best.bitrate ?? 0)) {
        best = f;
      }
    }
    return best;
  };

  const variants: VideoVariant[] = [];
  const heights = new Set<number>([...byHeight.keys(), ...progressiveHeights.keys()]);
  for (const height of [...heights].sort((a, b) => b - a)) {
    const prog = progressiveHeights.get(height);
    if (prog) {
      variants.push({
        kind: 'video',
        label: prog.qualityLabel ?? `${height}p`,
        ext: 'mp4',
        height,
        bitrate: prog.bitrate,
        contentLength: prog.contentLength,
        mimeType: prog.mimeType,
        url: prog.url,
        mux: null,
      });
      continue;
    }
    const candidates = byHeight.get(height) ?? [];
    const video = pick(candidates);
    if (!video) continue;
    const { container, video: videoCodec } = codecOf(video.mimeType);
    const audioTrack = audioFor(container);
    if (!videoCodec || !audioTrack) continue;
    const audioCodec = codecOf(audioTrack.mimeType).audio;
    if (!audioCodec) continue;
    variants.push({
      kind: 'video',
      label: video.qualityLabel ?? `${height}p`,
      ext: container,
      height,
      bitrate: video.bitrate,
      contentLength:
        video.contentLength != null && audioTrack.contentLength != null
          ? video.contentLength + audioTrack.contentLength
          : (video.contentLength ?? audioTrack.contentLength),
      mimeType: video.mimeType,
      url: null,
      mux: {
        videoUrl: video.url,
        videoCodec,
        audioUrl: audioTrack.url,
        audioCodec,
        container,
        videoBytes: video.contentLength,
        audioBytes: audioTrack.contentLength,
      },
    });
  }

  // 竖屏视频（Shorts）的 height 是长边：608×1080 与 480×854 的 qualityLabel 同为 "480p"，
  // 但 height 不同 → 会产出两个同名档位。按显示名去重，同名只留码率最高的一条。
  const byLabel = new Map<string, VideoVariant>();
  for (const v of variants) {
    const cur = byLabel.get(v.label);
    if (!cur || (v.bitrate ?? 0) > (cur.bitrate ?? 0)) byLabel.set(v.label, v);
  }
  return [...byLabel.values()];
}

function extractAudioVariants(adaptive: RawFormat[]): VideoVariant[] {
  const m4a = adaptive.filter((f) => f.mimeType.startsWith('audio/mp4'));
  // 同一 itag 可能因多语言音轨出现多条，按 itag 去重取码率最高的一条
  const best = new Map<number, RawFormat>();
  for (const f of m4a) {
    const key = f.itag ?? -1;
    const cur = best.get(key);
    if (!cur || (f.bitrate ?? 0) > (cur.bitrate ?? 0)) best.set(key, f);
  }
  return [...best.values()]
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
    .slice(0, 2)
    .map((f) => ({
      kind: 'audio' as const,
      label: '音频',
      ext: 'm4a' as const,
      height: null,
      bitrate: f.bitrate,
      contentLength: f.contentLength,
      mimeType: f.mimeType,
      url: f.url,
      mux: null,
    }));
}
