import { buildFilename } from '../../shared/filename';
import type { DownloadOption, MediaCollection } from '../../shared/media';
import type { MuxDownloadRequest } from '../../shared/types';
import { bilibiliStreamUrl } from './policy';
import type { BilibiliPlay, BilibiliTrack, BilibiliVideo } from './types';

function codec(track: BilibiliTrack): MuxDownloadRequest['videoCodec'] | null {
  if (track.codecs?.startsWith('avc')) return 'avc';
  if (/^(hvc|hev)/.test(track.codecs)) return 'hevc';
  if (track.codecs?.startsWith('av01')) return 'av1';
  return null;
}

function stream(track: BilibiliTrack): string | null {
  return bilibiliStreamUrl([track.baseUrl, track.base_url, ...(track.backupUrl ?? track.backup_url ?? [])]);
}

export function parseBilibili(video: BilibiliVideo, play: BilibiliPlay, pageNumber: number): MediaCollection {
  const page = video.pages?.find((item) => item.page === pageNumber);
  if (!page) throw new Error('当前分 P 不存在，请刷新页面后重试');
  const id = video.bvid + ':' + page.cid;
  const title = video.pages.length > 1 ? video.title + ' · P' + pageNumber + ' ' + page.part : video.title;
  const variants: DownloadOption[] = [];
  const audio = play.dash?.audio?.filter((track) => track.codecs?.startsWith('mp4a') && stream(track))
    .sort((a, b) => b.bandwidth - a.bandwidth)[0];
  const audioUrl = audio && stream(audio);
  const codecOrder = { avc: 0, hevc: 1, av1: 2, vp9: 3 };
  const tracks = (play.dash?.video ?? []).filter((track) => codec(track) && stream(track))
    .sort((a, b) => codecOrder[codec(a)!] - codecOrder[codec(b)!] || b.bandwidth - a.bandwidth);
  const qualities = new Set<number>();
  if (audioUrl) for (const track of tracks) {
    if (qualities.has(track.id)) continue;
    qualities.add(track.id);
    const videoCodec = codec(track)!;
    const format = play.support_formats?.find((format) => format.quality === track.id);
    const height = track.height == null ? null : Math.min(track.width ?? track.height, track.height);
    const quality = format?.new_description || format?.display_desc || String(height) + 'P';
    const label = quality + (videoCodec === 'avc' ? '' : videoCodec === 'hevc' ? ' · HEVC' : ' · AV1');
    variants.push({
      id: id + ':' + track.id, kind: 'video', label, ext: 'mp4',
      height, contentLength: null,
      download: {
        type: 'download', mode: 'mux', filename: buildFilename(title, label, 'mp4'),
        container: 'mp4', videoUrl: stream(track)!, audioUrl, videoCodec, audioCodec: 'aac',
        videoBytes: null, audioBytes: null,
      },
    });
  }
  // 普通投稿仍可能返回单文件 MP4；分段 FLV 不属于本次支持范围。
  if (!play.dash && play.format?.includes('mp4') && play.durl?.length === 1) {
    const file = play.durl[0]!;
    const url = bilibiliStreamUrl([file.url, ...(file.backup_url ?? [])]);
    if (url) {
      const label = play.support_formats?.find((f) => f.quality === play.quality)?.new_description || 'MP4';
      variants.push({
        id: id + ':' + play.quality, kind: 'video', label, ext: 'mp4', height: null,
        contentLength: file.size ?? null,
        download: { type: 'download', mode: 'fetch', url, filename: buildFilename(title, label, 'mp4'),
          fileBytes: file.size ?? null },
      });
    }
  }
  if (!variants.length) throw new Error('当前账号未取得可下载的 MP4 音视频，请确认视频可以播放后重试');
  variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) ||
    Number(b.id.split(':').at(-1)) - Number(a.id.split(':').at(-1)));
  return { title, videos: [{ id, title, durationSeconds: page.duration, variants }] };
}
