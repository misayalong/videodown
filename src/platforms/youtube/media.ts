import { buildFilename } from '../../shared/filename';
import type { MediaCollection } from '../../shared/media';
import type { ParsedVideo } from './types';

export function toMedia(video: ParsedVideo): MediaCollection {
  return {
    title: video.title,
    videos: [{
      id: video.videoId,
      title: video.title,
      durationSeconds: video.durationSeconds,
      variants: video.variants.map((variant, index) => {
        const filename = buildFilename(video.title, variant.kind === 'audio' ? 'audio' : variant.label, variant.ext);
        if (!variant.mux && !variant.url) throw new Error('视频选项缺少下载地址');
        return {
          id: `${video.videoId}:${index}`,
          kind: variant.kind, label: variant.label, ext: variant.ext,
          height: variant.height, contentLength: variant.contentLength,
          download: variant.mux
            ? { type: 'download', mode: 'mux', filename, ...variant.mux }
            : { type: 'download', mode: 'direct', filename, url: variant.url! },
        };
      }),
    }],
  };
}
