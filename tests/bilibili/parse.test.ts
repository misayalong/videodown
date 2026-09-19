import { describe, expect, it } from 'vitest';
import { parseBilibili } from '../../src/platforms/bilibili/parse';
import { bilibiliTarget, parseBilibiliTarget } from '../../src/platforms/bilibili/target';
import type { BilibiliPlay, BilibiliTrack, BilibiliVideo } from '../../src/platforms/bilibili/types';

const video: BilibiliVideo = {
  bvid: 'BV1Synthetic', title: '示例课程',
  pages: [{ cid: 101, page: 1, part: '第一节', duration: 10 }, { cid: 102, page: 2, part: '第二节', duration: 20 }],
};
const track = (id: number, codecs = 'avc1.640033', height = 1080): BilibiliTrack => ({
  id, codecs, height, width: height * 16 / 9, bandwidth: 1000,
  baseUrl: 'https://unregistered.example/video',
  backupUrl: ['https://upos.example.bilivideo.com/' + id + '-' + codecs + '.m4s'],
});
const audio: BilibiliTrack = { ...track(30280, 'mp4a.40.2', 0), bandwidth: 192000 };
const play: BilibiliPlay = {
  quality: 116, support_formats: [
    { quality: 127, new_description: '8K 超高清' }, { quality: 120, new_description: '4K 超清' },
    { quality: 116, new_description: '1080P 60帧' }, { quality: 80, new_description: '1080P 高清' },
  ],
  dash: { video: [track(116, 'av01.0.08M'), track(116), track(80), track(120, 'hvc1.1.6', 2160)], audio: [audio] },
};

describe('B 站当前分 P 与可下载画质', () => {
  it('竖屏画质使用短边，避免将 360P 选项显示为 738p', () => {
    const result = parseBilibili(video, { quality: 16,
      support_formats: [{ quality: 16, new_description: '360P 流畅' }],
      dash: { video: [{ ...track(16), width: 360, height: 738 }], audio: [audio] },
    }, 2).videos[0]!.variants[0]!;
    expect(result.label).toBe('360P 流畅');
    expect(result.height).toBe(360);
  });
  it('只列出实际媒体轨，保留同分辨率的不同画质，优先 AVC 并为高画质标注 HEVC', () => {
    const result = parseBilibili(video, play, 1).videos[0]!;
    expect(result.variants.map(x => x.label)).toEqual(['4K 超清 · HEVC', '1080P 60帧', '1080P 高清']);
    expect(result.variants.every(x => x.download.mode === 'mux')).toBe(true);
    expect(result.variants[1]!.download).toMatchObject({ videoCodec: 'avc', audioCodec: 'aac', container: 'mp4' });
    expect(result.variants[0]!.download).toMatchObject({ videoCodec: 'hevc' });
    expect(result.variants[0]!.download).toHaveProperty('videoUrl', expect.stringContaining('.bilivideo.com/'));
  });
  it('分 P 的 ID 和文件名均不混用，即使共用 BV 号', () => {
    const p1 = parseBilibili(video, play, 1).videos[0]!;
    const p2 = parseBilibili(video, play, 2).videos[0]!;
    expect(p1.id).toBe('BV1Synthetic:101');
    expect(p2.id).toBe('BV1Synthetic:102');
    expect(p2.variants[0]!.download.filename).toContain('P2');
    expect(p1.variants[0]!.id).not.toBe(p2.variants[0]!.id);
    expect(() => parseBilibili(video, play, 3)).toThrow('分 P');
  });
  it('snake_case 地址及 AV1 轨保持原编码', () => {
    const t: BilibiliTrack = { id: 80, codecs: 'av01.0.08M', height: 1080, bandwidth: 1, base_url: 'https://cdn.bilivideo.cn/v.m4s' };
    const result = parseBilibili(video, { quality: 80, dash: { video: [t], audio: [audio] } }, 1);
    expect(result.videos[0]!.variants[0]!.download).toMatchObject({ mode: 'mux', videoCodec: 'av1' });
    expect(result.videos[0]!.variants[0]!.label).toContain('AV1');
  });
  it('缺少音轨、未授权 CDN 或只有 FLV 时不交付无声/伪 MP4', () => {
    for (const bad of [
      { quality: 80, dash: { video: [track(80)], audio: [] } },
      { quality: 80, dash: { video: [{ ...track(80), backupUrl: [] }], audio: [audio] } },
      { quality: 80, format: 'flv', durl: [{ url: 'https://cdn.bilivideo.com/a.flv' }] },
    ]) expect(() => parseBilibili(video, bad, 1)).toThrow('MP4 音视频');
  });
  it('单文件 MP4 采用离屏获取，保持文件大小用于进度', () => {
    const result = parseBilibili(video, { quality: 16, format: 'mp4', durl: [{ url: 'https://cdn.bilivideo.com/a.mp4', size: 123 }] }, 1);
    expect(result.videos[0]!.variants[0]!.download).toMatchObject({ mode: 'fetch', fileBytes: 123 });
  });
  it('播放页识别明确区分分 P，排除番剧和无效分 P', () => {
    expect(bilibiliTarget(new URL('https://www.bilibili.com/video/BV1Synthetic/?p=2'))).toBe('BV1Synthetic:p2');
    expect(bilibiliTarget(new URL('https://www.bilibili.com/video/av123'))).toBe('av123:p1');
    for (const path of ['/bangumi/play/ep123', '/video/BV1Synthetic?p=-1', '/video/BV1Synthetic?p=1.5']) {
      expect(bilibiliTarget(new URL(path, 'https://www.bilibili.com'))).toBeNull();
    }
    expect(parseBilibiliTarget('BV1Synthetic:p2')).toEqual({ video: 'BV1Synthetic', page: 2 });
    expect(() => parseBilibiliTarget('../account:p2')).toThrow();
  });
});
