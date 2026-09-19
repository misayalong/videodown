import { buildFilename } from '../../shared/filename';
import type { DownloadOption, MediaCollection } from '../../shared/media';
import { douyinStreamUrl } from './policy';
import type { DouyinAweme, DouyinRate } from './types';

function rateCodec(rate: DouyinRate): 'avc' | 'hevc' | 'av1' | null {
  if (rate.isH266 || rate.codecType === 'bytevc2') return null;
  if (rate.codecType === 'av1') return 'av1';
  return rate.isH265 ? 'hevc' : 'avc';
}

export function parseDouyin(aweme: DouyinAweme, targetId: string): MediaCollection {
  if (aweme.awemeId !== targetId) throw new Error('视频已切换，请重新打开下载菜单');
  const video = aweme.video;
  if (!video || aweme.isSlides || aweme.isAds) throw new Error('当前内容不是支持的普通视频');
  const title = aweme.desc || aweme.itemTitle || '抖音_' + targetId;
  const audio = video.bitRateAudioList?.filter((item) => douyinStreamUrl(item.urlList))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const audioUrl = audio && douyinStreamUrl(audio.urlList);
  const rates: DouyinRate[] = [...(video.bitRateList ?? [])];
  if (!rates.length) {
    // 当前页面没有多档列表时，播放地址仍是平台提供的单文件 MP4。
    rates.push({ width: video.width, height: video.height, playAddr: video.playAddr,
      dataSize: video.playAddrSize, format: 'mp4' });
    if (video.playAddrH265) rates.push({ width: video.width, height: video.height,
      playAddr: video.playAddrH265, dataSize: video.playAddrH265Size, format: 'mp4', isH265: true });
  }
  const order = { avc: 0, hevc: 1, av1: 2 };
  const usable = rates.filter((rate) => {
    const format = rate.format || rate.videoFormat;
    return Number.isFinite(rate.width) && rate.width > 0 && Number.isFinite(rate.height) && rate.height > 0 &&
      rateCodec(rate) && douyinStreamUrl(rate.playAddr) &&
      (format === 'mp4' || (format === 'dash' && audioUrl));
  }).sort((a, b) => order[rateCodec(a)!] - order[rateCodec(b)!] ||
    Number((a.format || a.videoFormat) === 'dash') - Number((b.format || b.videoFormat) === 'dash') ||
    (b.bitRate ?? 0) - (a.bitRate ?? 0));
  const seen = new Set<string>();
  const variants: DownloadOption[] = [];
  for (const rate of usable) {
    const height = Math.min(rate.width, rate.height);
    const fps = rate.fps && rate.fps >= 50 ? Math.round(rate.fps) : 0;
    const key = String(height) + ':' + fps;
    if (seen.has(key)) continue;
    seen.add(key);
    const codec = rateCodec(rate)!;
    const label = height + 'P' + (fps ? ' ' + fps + '帧' : '') +
      (codec === 'avc' ? '' : codec === 'hevc' ? ' · HEVC' : ' · AV1');
    const url = douyinStreamUrl(rate.playAddr)!;
    const filename = buildFilename(title, label, 'mp4');
    const mux = (rate.format || rate.videoFormat) === 'dash';
    variants.push({
      id: targetId + ':' + key, kind: 'video', label, ext: 'mp4', height,
      contentLength: rate.dataSize ? rate.dataSize + (mux ? audio?.size ?? 0 : 0) : null,
      download: mux ? {
        type: 'download', mode: 'mux', filename, container: 'mp4',
        videoUrl: url, videoCodec: codec, audioUrl: audioUrl!, audioCodec: 'aac',
        videoBytes: rate.dataSize ?? null, audioBytes: audio?.size ?? null,
      } : { type: 'download', mode: 'fetch', url, filename, fileBytes: rate.dataSize ?? null },
    });
  }
  // 播放源优先；只剩平台下载源时明确标注，绝不把它标成无水印。
  if (!variants.length) {
    const download = aweme.download;
    const url = douyinStreamUrl(download?.urlList ?? (download?.url ? [download.url] : undefined));
    if (url) {
      const height = Math.min(video.width, video.height);
      const label = height + 'P · 可能带平台水印';
      variants.push({
        id: targetId + ':watermarked', kind: 'video', label, ext: 'mp4', height,
        contentLength: download?.dataSize ?? null,
        download: { type: 'download', mode: 'fetch', url, filename: buildFilename(title, label, 'mp4'),
          fileBytes: download?.dataSize ?? null },
      });
    }
  }
  if (!variants.length) throw new Error('未取得可下载的 MP4 音视频，请确认视频可以播放后重试');
  variants.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.label.localeCompare(a.label));
  return { title, videos: [{ id: targetId, title, durationSeconds: video.duration / 1000, variants }] };
}
