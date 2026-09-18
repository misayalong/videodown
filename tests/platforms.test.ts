import { describe, expect, it, vi, afterEach } from 'vitest';
import { toMedia as xMedia } from '../src/platforms/x/media';
import { toMedia as youtubeMedia } from '../src/platforms/youtube/media';
import { parseTweetResponse } from '../src/platforms/x/parse';
import { isStreamUrl, resolveInBackground } from '../src/platforms/background';
import fixture from './x/fixtures/fxtwitter-single-video.json';

afterEach(() => vi.unstubAllGlobals());

describe('平台模块与公共下载契约', () => {
  it('X 多视频保留独立选项和文件名，使用公共直链请求', () => {
    const tweet = parseTweetResponse(fixture);
    tweet.videos.push(tweet.videos[0]!);
    const media = xMedia(tweet);
    expect(media.videos).toHaveLength(2);
    const first = media.videos[0]!.variants[0]!;
    const second = media.videos[1]!.variants[0]!;
    expect(first.id).not.toBe(second.id);
    expect(first.download.mode).toBe('direct');
    expect(first.download.filename).toBe('example_1000000000000000001_2160p_v1.mp4');
    expect(second.download.filename).toBe('example_1000000000000000001_2160p_v2.mp4');
  });

  it('YouTube 映射直链音频与合并轨道，保留编解码器和字节数', () => {
    const base = { label: '1080p', ext: 'mp4' as const, height: 1080, bitrate: null, contentLength: 120, mimeType: 'video/mp4' };
    const mux = { videoUrl: 'https://media.googlevideo.com/video', audioUrl: 'https://media.googlevideo.com/audio', container: 'mp4' as const, videoCodec: 'avc' as const, audioCodec: 'aac' as const, videoBytes: 100, audioBytes: 20 };
    const media = youtubeMedia({ videoId: 'example', title: 'Test', author: null, durationSeconds: 10, variants: [
      { ...base, kind: 'video', url: null, mux },
      { ...base, kind: 'audio', ext: 'm4a', label: 'M4A', height: null, url: mux.audioUrl, mux: null },
    ] });
    expect(media.videos[0]!.variants[0]!.download).toEqual({ type: 'download', mode: 'mux', filename: 'Test_1080p.mp4', ...mux });
    expect(media.videos[0]!.variants[1]!.download).toEqual({ type: 'download', mode: 'direct', filename: 'Test_audio.m4a', url: mux.audioUrl });
  });

  it.each(['https://media.googlevideo.com/video', 'https://media.gvt1.com/video', 'https://video.twimg.com/x.mp4'])('允许已注册平台流地址 %s', (url) => expect(isStreamUrl(url)).toBe(true));
  it.each(['https://video.twimg.com.evil.example/x.mp4', 'https://googlevideo.com.evil.example/video', 'file:///etc/passwd', 'javascript:alert(1)', 'https://example.com/video'])('拒绝未授权流地址 %s', (url) => expect(isStreamUrl(url)).toBe(false));

  it('X 后台解析返回统一结果，每次请求重新获取以支持菜单重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => fixture, ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const req = { type: 'resolve' as const, platform: 'x', targetId: fixture.tweet.id };
    expect((await resolveInBackground(req)).ok).toBe(true);
    expect((await resolveInBackground(req)).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.fxtwitter.com/status/${fixture.tweet.id}`);
  });

  it('无效平台与推文 ID 不发送网络请求', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const [platform, targetId] of [['other', '10000'], ['x', '../secrets'], ['toString', '10000']]) {
      expect((await resolveInBackground({ type: 'resolve', platform: platform!, targetId: targetId! })).ok).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('服务错误和错误目标不会变成可下载结果', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code: 429, message: 'rate limited' }) }));
    expect(await resolveInBackground({ type: 'resolve', platform: 'x', targetId: '10000' })).toEqual({ ok: false, error: '解析服务请求过于频繁，请稍后重试' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => fixture }));
    expect((await resolveInBackground({ type: 'resolve', platform: 'x', targetId: '10000' })).ok).toBe(false);
  });
});
