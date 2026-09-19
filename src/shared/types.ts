// ---- content ⇄ background ----

export interface DirectDownloadRequest {
  type: 'download';
  mode: 'direct';
  url: string;
  filename: string;
}

/** 需要来源头的完整 MP4：在 offscreen 获取原文件，不重新封装。 */
export interface FileDownloadRequest {
  type: 'download';
  mode: 'fetch';
  url: string;
  filename: string;
  fileBytes: number | null;
}

/** 视频单轨 + 音频单轨的合并下载（remux，不转码），由 offscreen 页执行 */
export interface MuxDownloadRequest {
  type: 'download';
  mode: 'mux';
  filename: string;
  container: 'mp4' | 'webm';
  videoUrl: string;
  videoCodec: 'avc' | 'av1' | 'vp9' | 'hevc';
  audioUrl: string;
  audioCodec: 'aac' | 'opus';
  /** 各轨字节数（来自 player response 的 contentLength），用于按比例显示进度 */
  videoBytes: number | null;
  audioBytes: number | null;
}

export type BgRequest = DirectDownloadRequest | FileDownloadRequest | MuxDownloadRequest | MuxCancelRequest;

/** content → background：取消进行中的合并任务 */
export interface MuxCancelRequest {
  type: 'muxCancel';
  jobId: string;
}

export type DownloadResponse = { ok: boolean; error?: string; jobId?: string };

// ---- background ⇄ offscreen / content（进度链路） ----

/** 完整文件和合并共用现有 mux 进度、取消、完成消息及单任务槽位。 */
export interface FileStartMessage {
  type: 'fileStart';
  jobId: string;
  url: string;
  fileBytes: number | null;
}

export interface MuxStartMessage {
  type: 'muxStart';
  jobId: string;
  filename: string;
  container: 'mp4' | 'webm';
  videoUrl: string;
  videoCodec: MuxDownloadRequest['videoCodec'];
  audioUrl: string;
  audioCodec: MuxDownloadRequest['audioCodec'];
  videoBytes: number | null;
  audioBytes: number | null;
}

export interface MuxProgressMessage {
  type: 'muxProgress';
  jobId: string;
  percent: number;
}

export interface MuxDoneMessage {
  type: 'muxDone';
  jobId: string;
  blobUrl: string;
}

export interface MuxErrorMessage {
  type: 'muxError';
  jobId: string;
  error: string;
}

/** background → offscreen：中断指定任务（muxCancel 双向复用同一结构） */
export interface MuxCancelMessage {
  type: 'muxCancel';
  jobId: string;
}

/** offscreen → background：任务已取消（槽位可立即释放；与 muxError 区分，不弹错误） */
export interface MuxCancelledMessage {
  type: 'muxCancelled';
  jobId: string;
}

export interface MuxCleanupMessage {
  type: 'muxCleanup';
  jobId: string;
}

// content 收到的进度事件（由 background 从 offscreen 转发）
export type MuxClientMessage =
  | MuxProgressMessage
  | { type: 'muxComplete'; jobId: string }
  | { type: 'muxFailed'; jobId: string; error: string }
  | { type: 'muxCancelled'; jobId: string };
