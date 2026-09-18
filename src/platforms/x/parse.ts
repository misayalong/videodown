import type { ParsedTweet, ParsedVideo, VideoVariant } from './types';

export class ParseError extends Error {}

// fxtwitter 返回的 variant 不带宽高字段，宽高通常编码在 URL 路径的 /1280x720/ 段里
const DIMS_IN_URL_RE = /\/(\d{2,5})x(\d{2,5})\//;
const TWIMG_MP4_RE = /^https?:\/\/video\.twimg\.com\/[^\s?#]+\.mp4(\?|$)/i;

interface Candidate {
  url: string;
  width: number | null;
  height: number | null;
  bitrate: number | null;
}

type Obj = Record<string, unknown>;

function asArray(value: unknown): Obj[] {
  return Array.isArray(value)
    ? value.filter((x): x is Obj => x != null && typeof x === 'object')
    : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function dimsFromUrl(url: string): { width: number | null; height: number | null } {
  const m = url.match(DIMS_IN_URL_RE);
  if (!m || !m[1] || !m[2]) return { width: null, height: null };
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return { width: null, height: null };
  return { width, height };
}

function collectCandidates(video: Obj): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (raw: Obj): void => {
    const url = str(raw.url);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const dims = dimsFromUrl(url);
    out.push({
      url,
      width: num(raw.width) ?? dims.width,
      height: num(raw.height) ?? dims.height,
      bitrate: num(raw.bitrate),
    });
  };
  for (const f of asArray(video.formats)) push(f);
  for (const v of asArray(video.variants)) push(v);
  if (str(video.url)) push(video);
  return out;
}

function extractVariants(candidates: Candidate[]): VideoVariant[] {
  const mp4 = candidates.filter((c) => TWIMG_MP4_RE.test(c.url));
  // 同一分辨率可能有多个码率，只保留码率最高的那个
  const best = new Map<string, Candidate>();
  for (const c of mp4) {
    const key = c.height != null ? String(c.height) : 'x';
    const cur = best.get(key);
    if (!cur || (c.bitrate ?? 0) > (cur.bitrate ?? 0)) best.set(key, c);
  }
  return [...best.values()]
    .sort((a, b) => (b.height ?? -1) - (a.height ?? -1))
    .map((c) => ({
      url: c.url,
      width: c.width,
      height: c.height,
      bitrate: c.bitrate,
      label: c.height != null ? `${c.height}p` : 'MP4',
    }));
}

function describeFailure(code: number | null, message: string): string {
  if (code === 404 || /not\s*found/i.test(message)) return '推文不存在或已被删除';
  if (code === 401 || code === 403) return '无法访问该推文（可能仅登录可见或来自受保护账号）';
  if (code === 429) return '解析服务请求过于频繁，请稍后重试';
  if (code != null && code >= 500) return '解析服务暂时不可用，请稍后重试';
  return message ? `解析失败：${message}` : '解析失败：未知错误';
}

export function parseTweetResponse(payload: unknown): ParsedTweet {
  if (payload == null || typeof payload !== 'object') throw new ParseError('解析服务返回了异常数据');
  const body = payload as Obj;
  const code = typeof body.code === 'number' ? body.code : null;
  const tweet = body.tweet != null && typeof body.tweet === 'object' ? (body.tweet as Obj) : null;
  if (!tweet) throw new ParseError(describeFailure(code, str(body.message) ?? ''));

  const tweetId = str(tweet.id) ?? '';
  if (!/^\d+$/.test(tweetId)) throw new ParseError('解析服务返回了异常数据');

  const author = tweet.author != null && typeof tweet.author === 'object' ? (tweet.author as Obj) : null;
  const handle = str(author?.screen_name);
  const displayName = str(author?.name);

  const media = tweet.media != null && typeof tweet.media === 'object' ? (tweet.media as Obj) : {};
  const rawVideos = asArray(media.videos).length
    ? asArray(media.videos)
    : asArray(media.all).filter(
        (m) => m.type === 'video' || m.type === 'gif' || 'formats' in m || 'variants' in m,
      );

  const videos: ParsedVideo[] = [];
  for (const raw of rawVideos) {
    const variants = extractVariants(collectCandidates(raw));
    if (!variants.length) continue;
    const durationSec = num(raw.duration);
    videos.push({
      poster: str(raw.thumbnail_url),
      durationMs: durationSec != null ? Math.round(durationSec * 1000) : null,
      variants,
    });
  }
  if (!videos.length) throw new ParseError('该推文中没有找到可下载的视频');

  return { tweetId, handle, displayName, videos };
}
