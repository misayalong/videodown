import { describe, expect, it } from 'vitest';
import { ParseError, parseTweetResponse } from '../../src/platforms/x/parse';
import fixture from './fixtures/fxtwitter-single-video.json';

describe('parseTweetResponse · 合成 fxtwitter 响应', () => {
  const tweet = parseTweetResponse(fixture);

  it('提取推文与作者信息', () => {
    expect(tweet.tweetId).toBe('1000000000000000001');
    expect(tweet.handle).toBe('example');
    expect(tweet.displayName).toBeTruthy();
  });

  it('只保留 video.twimg.com 的 mp4 直链，按分辨率降序', () => {
    expect(tweet.videos).toHaveLength(1);
    const video = tweet.videos[0]!;
    expect(video.variants.map((v) => v.label)).toEqual(['2160p', '1080p', '720p', '360p', '270p']);
    for (const v of video.variants) {
      expect(v.url.startsWith('https://video.twimg.com/')).toBe(true);
      expect(v.url).toMatch(/\.mp4\?/);
      expect(v.url).not.toContain('.m3u8');
    }
  });

  it('宽高与码率（来自 URL 路径段 / variants 字段）', () => {
    const video = tweet.videos[0]!;
    const top = video.variants[0]!;
    expect(top.width).toBe(3840);
    expect(top.height).toBe(2160);
    expect(top.bitrate).toBe(25128000);
  });

  it('时长与封面', () => {
    const video = tweet.videos[0]!;
    expect(video.durationMs).toBe(74774);
    expect(video.poster?.startsWith('https://pbs.twimg.com/')).toBe(true);
  });
});

describe('parseTweetResponse · 边界', () => {
  const vid = (url: string, extra: Record<string, unknown> = {}) => ({ url, ...extra });

  const withVideos = (videos: unknown[]) => ({
    code: 200,
    tweet: {
      id: '100',
      author: { screen_name: 'alice', name: 'Alice' },
      media: { videos },
    },
  });

  it('同分辨率多码率只保留最高码率', () => {
    const tweet = parseTweetResponse(
      withVideos([
        {
          variants: [
            vid('https://video.twimg.com/x/1280x720/low.mp4?tag=1', { bitrate: 500_000 }),
            vid('https://video.twimg.com/x/1280x720/high.mp4?tag=1', { bitrate: 2_000_000 }),
          ],
        },
      ]),
    );
    const variants = tweet.videos[0]!.variants;
    expect(variants).toHaveLength(1);
    expect(variants[0]!.url).toContain('high.mp4');
    expect(variants[0]!.label).toBe('720p');
  });

  it('无法解析宽高时标记为 MP4', () => {
    const tweet = parseTweetResponse(
      withVideos([{ variants: [vid('https://video.twimg.com/tweet_video/AbCdEf.mp4')] }]),
    );
    const variants = tweet.videos[0]!.variants;
    expect(variants[0]!.label).toBe('MP4');
    expect(variants[0]!.width).toBeNull();
    expect(variants[0]!.height).toBeNull();
    expect(variants[0]!.bitrate).toBeNull();
  });

  it('丢弃非 twimg、非 mp4 直链的候选', () => {
    const tweet = parseTweetResponse(
      withVideos([
        {
          variants: [
            vid('https://video.twimg.com/x/pl/main.m3u8?tag=12', { bitrate: 0 }),
            vid('https://pbs.twimg.com/media/abc.jpg'),
            vid('https://video.twimg.com/x/1280x720/ok.mp4?tag=12', { bitrate: 1000 }),
          ],
        },
      ]),
    );
    expect(tweet.videos[0]!.variants).toHaveLength(1);
    expect(tweet.videos[0]!.variants[0]!.url).toContain('ok.mp4');
  });

  it('videos 缺失时回退 media.all（GIF 本质是 mp4）', () => {
    const payload = {
      code: 200,
      tweet: {
        id: '200',
        author: { screen_name: 'bob', name: 'Bob' },
        media: {
          all: [
            {
              type: 'gif',
              variants: [vid('https://video.twimg.com/tweet_video/Em.mp4')],
            },
          ],
        },
      },
    };
    const tweet = parseTweetResponse(payload);
    expect(tweet.videos).toHaveLength(1);
    expect(tweet.videos[0]!.variants[0]!.label).toBe('MP4');
  });

  it('一条推文多个视频各自成组', () => {
    const tweet = parseTweetResponse(
      withVideos([
        { variants: [vid('https://video.twimg.com/x/1280x720/one.mp4?tag=1', { bitrate: 1 })] },
        { variants: [vid('https://video.twimg.com/x/640x360/two.mp4?tag=1', { bitrate: 1 })] },
      ]),
    );
    expect(tweet.videos).toHaveLength(2);
    expect(tweet.videos[0]!.variants[0]!.label).toBe('720p');
    expect(tweet.videos[1]!.variants[0]!.label).toBe('360p');
  });

  it('404 → 推文不存在或已被删除', () => {
    expect(() => parseTweetResponse({ code: 404, message: 'NOT_FOUND', tweet: null })).toThrow(
      new ParseError('推文不存在或已被删除'),
    );
  });

  it('没有任何可下载视频 → 明确报错', () => {
    expect(() => parseTweetResponse(withVideos([]))).toThrow(new ParseError('该推文中没有找到可下载的视频'));
  });

  it('payload 为空 → 异常数据报错', () => {
    expect(() => parseTweetResponse(null)).toThrow(new ParseError('解析服务返回了异常数据'));
  });
});
