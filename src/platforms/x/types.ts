export interface VideoVariant {
  url: string;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  label: string;
}

export interface ParsedVideo {
  poster: string | null;
  durationMs: number | null;
  variants: VideoVariant[];
}

export interface ParsedTweet {
  tweetId: string;
  handle: string | null;
  displayName: string | null;
  videos: ParsedVideo[];
}

