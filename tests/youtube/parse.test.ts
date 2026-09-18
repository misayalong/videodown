import { describe, expect, it } from 'vitest';
import { ParseError, parsePlayerPayload } from '../../src/platforms/youtube/parse';
import type { RawFormat, SolvePayload } from '../../src/platforms/youtube/types';

let seq = 0;

function video(over: Partial<RawFormat>): RawFormat {
  const merged: RawFormat = {
    itag: 137,
    mimeType: 'video/mp4; codecs="avc1.640028"',
    url: '',
    bitrate: 2_000_000,
    contentLength: 50_000_000,
    qualityLabel: '1080p',
    width: 1920,
    height: 1080,
    audioSampleRate: null,
    ...over,
  };
  merged.url = `https://x.googlevideo.com/v?itag=${merged.itag}&v=${seq++}`;
  return merged;
}

function audio(over: Partial<RawFormat>): RawFormat {
  const merged: RawFormat = {
    itag: 140,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    url: '',
    bitrate: 129_000,
    contentLength: 3_400_000,
    qualityLabel: null,
    width: null,
    height: null,
    audioSampleRate: 44_100,
    ...over,
  };
  merged.url = `https://x.googlevideo.com/a?itag=${merged.itag}&a=${seq++}`;
  return merged;
}

const basePayload: SolvePayload = {
  meta: { videoId: 'gQRnAoAdwfA', title: 'Test Video', author: 'Channel', durationSeconds: 863 },
  progressive: [
    { ...video({ itag: 18, height: 360, qualityLabel: '360p', contentLength: 29_546_745, bitrate: 380_000 }), mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"' },
  ],
  adaptive: [
    // 2160p：av01-mp4 应优先于 vp9-webm
    video({ itag: 401, mimeType: 'video/mp4; codecs="av01.0.13M.08"', height: 2160, qualityLabel: '2160p60', bitrate: 2_900_000, contentLength: 320_907_249 }),
    video({ itag: 313, mimeType: 'video/webm; codecs="vp9"', height: 2160, qualityLabel: '2160p60', bitrate: 6_200_000, contentLength: 681_838_657 }),
    // 1440p：只有 webm 时用 vp9+opus
    video({ itag: 271, mimeType: 'video/webm; codecs="vp9"', height: 1440, qualityLabel: '1440p60', bitrate: 2_500_000, contentLength: 276_565_031 }),
    // 1080p：avc1 优先于 av01，且取码率更高的一条
    video({ itag: 299, mimeType: 'video/mp4; codecs="avc1.64002a"', height: 1080, qualityLabel: '1080p60', bitrate: 1_500_000, contentLength: 155_416_938 }),
    video({ itag: 399, mimeType: 'video/mp4; codecs="av01.0.09M.08"', height: 1080, qualityLabel: '1080p60', bitrate: 700_000, contentLength: 62_751_763 }),
    // 720p
    video({ itag: 298, mimeType: 'video/mp4; codecs="avc1.640020"', height: 720, qualityLabel: '720p60', bitrate: 900_000, contentLength: 86_660_181 }),
    // 480p
    video({ itag: 135, mimeType: 'video/mp4; codecs="avc1.4d401f"', height: 480, qualityLabel: '480p', bitrate: 500_000, contentLength: 31_826_533 }),
    // 360p 单轨：应被渐进式 itag 18 取代
    video({ itag: 134, mimeType: 'video/mp4; codecs="avc1.4d401e"', height: 360, qualityLabel: '360p', bitrate: 400_000, contentLength: 18_751_954 }),
    // 240p：低于阈值不提供
    video({ itag: 133, mimeType: 'video/mp4; codecs="avc1.4d4015"', height: 240, qualityLabel: '240p', bitrate: 200_000, contentLength: 10_409_543 }),
    // 多语言音轨重复项应被去重
    audio({}),
    audio({ url: 'https://x.googlevideo.com/a?itag=140&track=de' }),
    audio({ itag: 139, bitrate: 69_000, contentLength: 1_800_000, audioSampleRate: 22_050 }),
    // webm opus（给 1440p 的 webm 项配对）
    audio({ itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160_000, contentLength: 13_349_581 }),
  ],
};

describe('parsePlayerPayload', () => {
  it('产出全部高度：2160p/1440p/1080p/720p/480p(mux) + 360p(直链) + 2 条音频', () => {
    const parsed = parsePlayerPayload(basePayload);
    const videos = parsed.variants.filter((v) => v.kind === 'video');
    expect(videos.map((v) => v.label)).toEqual(['2160p60', '1440p60', '1080p60', '720p60', '480p', '360p']);
    const audios = parsed.variants.filter((v) => v.kind === 'audio');
    expect(audios).toHaveLength(2);
    expect(audios[0]!.bitrate).toBe(129_000);
  });

  it('2160p 优先 av01-mp4 容器，配 m4a 音轨，大小为音视频之和', () => {
    const parsed = parsePlayerPayload(basePayload);
    const v4k = parsed.variants.find((v) => v.label === '2160p60')!;
    expect(v4k.ext).toBe('mp4');
    expect(v4k.mux).toBeTruthy();
    expect(v4k.mux!.videoCodec).toBe('av1');
    expect(v4k.mux!.audioCodec).toBe('aac');
    expect(v4k.mux!.container).toBe('mp4');
    expect(v4k.mux!.videoUrl).toContain('itag=401');
    expect(v4k.contentLength).toBe(320_907_249 + 3_400_000);
    expect(v4k.url).toBeNull();
  });

  it('仅有 webm 的高度配 opus 音轨、输出 webm', () => {
    const parsed = parsePlayerPayload(basePayload);
    const v1440 = parsed.variants.find((v) => v.label === '1440p60')!;
    expect(v1440.ext).toBe('webm');
    expect(v1440.mux!.videoCodec).toBe('vp9');
    expect(v1440.mux!.audioCodec).toBe('opus');
    expect(v1440.mux!.audioUrl).toContain('itag=251');
  });

  it('1080p 在同高度内选 avc1（容器偏好高于码率）', () => {
    const parsed = parsePlayerPayload(basePayload);
    const v1080 = parsed.variants.find((v) => v.label === '1080p60')!;
    expect(v1080.mux!.videoUrl).toContain('itag=299');
  });

  it('360p 走渐进式直链，无 mux', () => {
    const parsed = parsePlayerPayload(basePayload);
    const v360 = parsed.variants.find((v) => v.label === '360p')!;
    expect(v360.mux).toBeNull();
    expect(v360.url).toContain('itag=18');
    expect(v360.ext).toBe('mp4');
  });

  it('完全无可用格式时抛 ParseError', () => {
    expect(() => parsePlayerPayload({ ...basePayload, progressive: [], adaptive: [] })).toThrow(ParseError);
  });

  it('没有可配音轨的容器高度被跳过，其余高度保留', () => {
    // 只有 m4a 音轨：webm 高度（需 opus）无法配对被跳过，mp4 高度正常
    const payload: SolvePayload = {
      ...basePayload,
      progressive: [],
      adaptive: [
        video({ itag: 298, height: 720, qualityLabel: '720p60', contentLength: 86_660_181 }),
        video({ itag: 271, mimeType: 'video/webm; codecs="vp9"', height: 1440, qualityLabel: '1440p60', bitrate: 2_500_000, contentLength: 276_565_031 }),
        audio({}),
      ],
    };
    const parsed = parsePlayerPayload(payload);
    const videos = parsed.variants.filter((v) => v.kind === 'video');
    expect(videos.map((v) => v.label)).toEqual(['720p60']);
  });
});
