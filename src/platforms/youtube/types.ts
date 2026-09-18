import type { MuxDownloadRequest } from '../../shared/types';
// MAIN world ⇄ isolated content script 的 postMessage 桥接命名空间
export const BRIDGE_SOURCE = 'videodown-bridge-v1';

/** MAIN world 交付给隔离世界的格式（URL 已可直接下载） */
export interface RawFormat {
  itag: number | null;
  mimeType: string;
  url: string;
  bitrate: number | null;
  contentLength: number | null;
  qualityLabel: string | null;
  width: number | null;
  height: number | null;
  audioSampleRate: number | null;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  author: string | null;
  durationSeconds: number | null;
}

export interface SolvePayload {
  meta: VideoMeta;
  /** 音视频合一的渐进式格式（player response 的 streamingData.formats） */
  progressive: RawFormat[];
  /** 自适应单轨格式（streamingData.adaptiveFormats，含视频单轨与音频单轨） */
  adaptive: RawFormat[];
}

export type SolveResult = { ok: true; payload: SolvePayload } | { ok: false; error: string };

export interface BridgeRequest {
  source: typeof BRIDGE_SOURCE;
  type: 'solve';
  reqId: string;
  videoId: string;
}

export interface BridgeSuccess {
  source: typeof BRIDGE_SOURCE;
  type: 'solveResult';
  reqId: string;
  ok: true;
  payload: SolvePayload;
}

export interface BridgeFailure {
  source: typeof BRIDGE_SOURCE;
  type: 'solveResult';
  reqId: string;
  ok: false;
  error: string;
}

export type BridgeResponse = BridgeSuccess | BridgeFailure;

// ---- 菜单展示用的变体 ----

export interface VideoVariant {
  kind: 'video' | 'audio';
  label: string;
  ext: 'mp4' | 'm4a' | 'webm';
  height: number | null;
  bitrate: number | null;
  /** 直链项：文件大小；mux 项：视频轨+音频轨之和 */
  contentLength: number | null;
  mimeType: string;
  /** 直链下载的 URL（kind='audio' 或渐进式视频项） */
  url: string | null;
  /** 需要合并音视频才能成片的项目（720p+ 单轨流） */
  mux: null | {
    videoUrl: string;
    videoCodec: MuxDownloadRequest['videoCodec'];
    audioUrl: string;
    audioCodec: MuxDownloadRequest['audioCodec'];
    container: 'mp4' | 'webm';
    videoBytes: number | null;
    audioBytes: number | null;
  };
}

export interface ParsedVideo extends VideoMeta {
  variants: VideoVariant[];
}
