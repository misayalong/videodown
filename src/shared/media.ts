import type { DirectDownloadRequest, MuxDownloadRequest } from './types';

/** 平台模块交付给公共菜单的下载选项；文件命名规则由平台决定。 */
export interface DownloadOption {
  id: string;
  kind: 'video' | 'audio';
  label: string;
  ext: string;
  height: number | null;
  contentLength: number | null;
  download: DirectDownloadRequest | MuxDownloadRequest;
}

export interface MediaVideo {
  id: string;
  title: string;
  durationSeconds: number | null;
  variants: DownloadOption[];
}

export interface MediaCollection {
  title: string;
  videos: MediaVideo[];
}

export type ResolveResponse = { ok: true; media: MediaCollection } | { ok: false; error: string };
export interface ResolveRequest {
  type: 'resolve';
  platform: string;
  targetId: string;
}
