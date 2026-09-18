/**
 * 解析编排：拿到当前视频的可下载格式清单。
 *
 * 主路径（2026-09-14 修正后实测可用）：扩展在 MAIN world 自 POST innertube
 * /youtubei/v1/player，VISIONOS → ANDROID → IOS 客户端，返回全部明文 URL ——
 * 无解密、无 n 参、无 PO token。WEB 页面的 player response 自 SABR 迁移后已不下发
 * 流 URL，且 player JS 中解密代码已被移除，故不再有解密兜底路径。
 *
 * 关键点一：fetch 必须 credentials: 'omit'。页面上下文的同源请求默认携带浏览器
 * 登录 Cookie，而手机客户端不支持账号会话——登录态会触发 GVS 的 PO Token
 * 强制校验，表现为自适应流（480p+）全部 403、仅渐进式 itag 18 幸存。
 *
 * 关键点二：必须携带页面 ytcfg 的 visitorData（context.client.visitorData +
 * X-Goog-Visitor-Id 头）。2026-09 起 YouTube 对 innertube 请求执行 visitor 会话
 * 校验：裸调（无 visitorData）的 VISIONOS/VR 系客户端直接 LOGIN_REQUIRED；
 * ANDROID 虽返回 URL，但对自动配音（多音轨 xtags）/SABR 强制类视频，其 URL 在
 * GVS 侧全部 403（itag 18 豁免）——这类流只有 VISIONOS + visitorData 的 mint
 * 才能全量拉取（与 vd-dlp 行为一致：先抓页面、带 visitorData 调 API）。
 * VISIONOS（vd-dlp 当前默认首选）无 PO Token 要求，放在客户端链首位。
 */
import type { RawFormat, SolveResult, SolvePayload } from '../types';
import { getCaptured, readGlobalPlayerResponse } from './capture';

interface ClientDef {
  clientName: string;
  headerName: string;
  headerVersion: string;
  extra: Record<string, unknown>;
}

// clientVersion 会随时间失效（YouTube 拒绝过旧版本），失效时在 CLIENTS 里升版本即可。
// VISIONOS 必须放在首位：ANDROID/IOS 对多音轨（xtags）/SABR 强制类视频返回的
// URL 是 GVS 死链（见文件头注释），且无 visitorData 时 VISIONOS 会 LOGIN_REQUIRED。
const CLIENTS: ClientDef[] = [
  {
    clientName: 'VISIONOS',
    headerName: '101',
    headerVersion: '1.02',
    extra: { deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471' },
  },
  {
    clientName: 'ANDROID',
    headerName: '3',
    headerVersion: '20.10.38',
    extra: { androidSdkVersion: 35, osName: 'Android', osVersion: '15' },
  },
  {
    clientName: 'IOS',
    headerName: '5',
    headerVersion: '20.10.4',
    extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  },
];

const VIDEO_ID_RE = /^[\w-]{6,20}$/;
const FETCH_TIMEOUT_MS = 8_000;

export async function handleSolve(videoId: string): Promise<SolveResult> {
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
    return { ok: false, error: '未能定位到视频，请刷新页面后重试' };
  }

  for (const client of CLIENTS) {
    const pr = await fetchViaClient(videoId, client).catch(() => null);
    const payload = pr ? payloadFromPlayerResponse(pr) : null;
    if (payload) {
      // VISIONOS 不下发 itag18（360p 渐进式单文件）；ANDROID 的 itag18 URL 不受
      // 新流策略影响（实测仍可全量 GET），用它补齐 360p 下载项
      if (client.clientName !== 'ANDROID' && !payload.progressive.some((f) => f.itag === 18)) {
        const android = CLIENTS.find((c) => c.clientName === 'ANDROID');
        const prA = android ? await fetchViaClient(videoId, android).catch(() => null) : null;
        const itag18 = prA
          ? payloadFromPlayerResponse(prA)?.progressive.find((f) => f.itag === 18)
          : null;
        if (itag18) payload.progressive = [...payload.progressive, itag18];
      }
      return { ok: true, payload };
    }
  }

  return { ok: false, error: describeFailure(videoId) };
}

/**
 * 读取页面 ytcfg 的 VISITOR_DATA。MAIN world 运行在 youtube.com 上，ytcfg 必然存在；
 * 解析请求带上它（context.client.visitorData + X-Goog-Visitor-Id）才能通过
 * innertube 的 visitor 会话校验，否则 VISIONOS 直接 LOGIN_REQUIRED、
 * ANDROID 对新策略视频返回 GVS 死链。取不到时返回 null（老视频或页面异常仍可尝试）。
 */
function getVisitorData(): string | null {
  try {
    const ytcfg = (window as unknown as { ytcfg?: { get?: (k: string) => unknown; data_?: Record<string, unknown> } }).ytcfg;
    if (!ytcfg) return null;
    const direct = ytcfg.get?.('VISITOR_DATA');
    if (typeof direct === 'string' && direct) return direct;
    const ctx = asRecord(ytcfg.data_?.INNERTUBE_CONTEXT);
    const client = asRecord(ctx?.client);
    const nested = client?.visitorData;
    return typeof nested === 'string' && nested ? nested : null;
  } catch {
    return null;
  }
}

async function fetchViaClient(videoId: string, client: ClientDef): Promise<Record<string, unknown> | null> {
  const visitorData = getVisitorData();
  const body = {
    context: {
      client: {
        clientName: client.clientName,
        clientVersion: client.headerVersion,
        hl: 'en',
        gl: 'US',
        utcOffsetMinutes: 0,
        ...(visitorData ? { visitorData } : {}),
        ...client.extra,
      },
    },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    // 必须显式剔除凭据：同源默认 'same-origin' 会带上浏览器登录 Cookie，
    // 登录态的 ANDROID/IOS 请求会触发 PO Token 校验，自适应流全部 403
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': client.headerName,
      'X-YouTube-Client-Version': client.headerVersion,
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  if (playabilityStatus(json) !== 'OK') return null;
  const sd = json.streamingData as Record<string, unknown> | undefined;
  if (!sd) return null;
  return json;
}

function payloadFromPlayerResponse(pr: Record<string, unknown>): SolvePayload | null {
  const det = asRecord(pr.videoDetails);
  const sd = asRecord(pr.streamingData);
  if (!det || !sd) return null;
  const videoId = typeof det.videoId === 'string' ? det.videoId : null;
  if (!videoId) return null;

  const progressive = asArray(sd.formats)
    .map((f) => normalizeFormat(asRecord(f)))
    .filter((f): f is RawFormat => f != null);
  const adaptive = asArray(sd.adaptiveFormats)
    .map((f) => normalizeFormat(asRecord(f)))
    .filter((f): f is RawFormat => f != null);
  if (!progressive.length && !adaptive.length) return null;

  return { meta: metaFromPlayerResponse(pr, videoId), progressive, adaptive };
}

/** client 路径的格式 URL 是明文 https 直链，其他形态一律丢弃 */
function normalizeFormat(f: Record<string, unknown> | null): RawFormat | null {
  if (!f) return null;
  const mimeType = typeof f.mimeType === 'string' ? f.mimeType : '';
  if (!mimeType) return null;
  if (typeof f.url !== 'string' || !f.url.startsWith('https://')) return null;
  return {
    itag: typeof f.itag === 'number' ? f.itag : null,
    mimeType,
    url: f.url,
    bitrate: num(f.bitrate) ?? num(f.averageBitrate),
    contentLength: num(f.contentLength),
    qualityLabel: typeof f.qualityLabel === 'string' && f.qualityLabel ? f.qualityLabel : null,
    width: num(f.width),
    height: num(f.height),
    audioSampleRate: num(f.audioSampleRate),
  };
}

function metaFromPlayerResponse(pr: Record<string, unknown>, videoId: string): SolvePayload['meta'] {
  const det = asRecord(pr.videoDetails) ?? {};
  const lengthSeconds = num(det.lengthSeconds);
  return {
    videoId,
    title: typeof det.title === 'string' && det.title ? det.title : 'video',
    author: typeof det.author === 'string' && det.author ? det.author : null,
    durationSeconds: lengthSeconds,
  };
}

/** 页面自身数据（捕获/内联的 WEB player response）仅用于给出可读的失败原因 */
function describeFailure(videoId: string): string {
  try {
    const pr = asRecord(getCaptured(videoId) ?? readGlobalPlayerResponse(videoId));
    const status = pr ? playabilityStatus(pr) : null;
    const reason = pr ? String(asRecord(pr.playabilityStatus)?.reason ?? '') : '';
    if (status === 'LIVE_STREAM' || /live stream/i.test(reason)) return '直播内容暂不支持下载';
    if (status === 'LOGIN_REQUIRED') return '该视频需要登录或年龄验证，无法下载';
    if ((status === 'UNPLAYABLE' || status === 'ERROR') && reason) return `视频不可播放：${reason}`;
  } catch {
    // 落到通用文案
  }
  return '未能获取视频流，YouTube 可能已更新策略，请稍后重试';
}

// ---- 小工具 ----

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v && /^\d+(\.\d+)?$/.test(v)) return Number(v);
  return null;
}

function playabilityStatus(pr: Record<string, unknown>): string | null {
  const ps = asRecord(pr.playabilityStatus);
  return typeof ps?.status === 'string' ? ps.status : null;
}
