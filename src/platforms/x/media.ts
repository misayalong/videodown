import { buildFilename } from './filename';
import type { ParsedTweet } from './types';
import type { MediaCollection } from '../../shared/media';

export function toMedia(tweet: ParsedTweet): MediaCollection {
  return {
    title: tweet.handle ? `@${tweet.handle}` : 'X 视频',
    videos: tweet.videos.map((video, index) => ({
      id: `${tweet.tweetId}:${index}`,
      title: `视频 ${index + 1}`,
      durationSeconds: video.durationMs == null ? null : video.durationMs / 1000,
      variants: video.variants.map((variant, variantIndex) => ({
        id: `${tweet.tweetId}:${index}:${variantIndex}`,
        kind: 'video', label: variant.label, ext: 'mp4',
        height: variant.height, contentLength: null,
        download: {
          type: 'download', mode: 'direct', url: variant.url,
          filename: buildFilename({
            handle: tweet.handle, tweetId: tweet.tweetId, label: variant.label,
            videoNumber: tweet.videos.length > 1 ? index + 1 : undefined,
          }),
        },
      })),
    })),
  };
}
