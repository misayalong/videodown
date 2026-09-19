import { describe, expect, it } from 'vitest';
import { parseDouyin } from '../../src/platforms/douyin/parse';
import { douyinStreamUrl } from '../../src/platforms/douyin/policy';
import type { DouyinAweme, DouyinRate } from '../../src/platforms/douyin/types';

const rate = (height: number, format = 'mp4', isH265 = false): DouyinRate => ({
  width: height * 16 / 9, height, format, isH265, fps: 30, bitRate: 1000, dataSize: 100,
  playAddr: ['https://v26-web.douyinvod.com/' + height + '-' + format + '.mp4'],
});
function aweme(rates: DouyinRate[]): DouyinAweme {
  return {
    awemeId: '100000000000001', desc: '示例视频',
    video: { width: 1920, height: 1080, duration: 10000, bitRateList: rates,
      bitRateAudioList: [{ bitrate: 64000, size: 20, urlList: ['https://v26-web.douyinvod.com/audio.mp4'] }] },
    download: { urlList: ['https://v26-web.douyinvod.com/watermarked.mp4'], dataSize: 200 },
  };
}
const id = '100000000000001';
describe('抖音播放源、编码及水印选择', () => {
  it.each(['mp4', 'dash'])('读取实际播放器的 {src} 地址：%s 不误退到带水印下载源', (format) => {
    const data = {
      awemeId: id, desc: '对象地址示例',
      video: { width: 1920, height: 1080, duration: 10000,
        bitRateList: [{ ...rate(1080, format), playAddr: [
          { src: 'https://douyinvod.com.evil.example/video.mp4' },
          { src: 'https://v26-web.douyinvod.com/play.mp4' },
        ] }],
        bitRateAudioList: [{ bitrate: 64000, size: 20,
          urlList: [{ src: 'https://v26-web.douyinvod.com/audio.mp4' }] }],
      },
      download: { url: 'https://v26-web.douyinvod.com/watermarked.mp4' },
    };
    const item = parseDouyin(data, id).videos[0]!.variants[0]!;
    expect(item.label).toBe('1080P');
    expect(item.download).toMatchObject(format === 'mp4'
      ? { mode: 'fetch', url: 'https://v26-web.douyinvod.com/play.mp4', fileBytes: 100 }
      : { mode: 'mux', videoUrl: 'https://v26-web.douyinvod.com/play.mp4',
        audioUrl: 'https://v26-web.douyinvod.com/audio.mp4' });
  });
  it('同画质优先 AVC 完整 MP4，高画质保留 HEVC，不重复列出同档 DASH 和多个码率', () => {
    const data = aweme([rate(1080, 'dash'), rate(1080, 'mp4', true), rate(1080),
      { ...rate(2160, 'mp4', true), fps: 60 }, { ...rate(1080), bitRate: 2000 }]);
    const variants = parseDouyin(data, id).videos[0]!.variants;
    expect(variants.map(v => v.label)).toEqual(['2160P 60帧 · HEVC', '1080P']);
    expect(variants.every(v => v.download.mode === 'fetch')).toBe(true);
    expect(variants.every(v => !v.label.includes('水印'))).toBe(true);
  });
  it('只有 DASH 时必须带 AAC 音轨交给合并流程，字节数来自真实字段', () => {
    const item = parseDouyin(aweme([rate(1080, 'dash')]), id).videos[0]!.variants[0]!;
    expect(item.download).toMatchObject({ mode: 'mux', container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', videoBytes: 100, audioBytes: 20 });
    expect(item.contentLength).toBe(120);
  });
  it('DASH 视频与音轨保留各自原有签名，交由 MAIN 的当前播放器处理', () => {
    const data = aweme([{ ...rate(720, 'dash'),
      playAddr: ['https://v11-web-prime.douyinvod.com/video.mp4?signature=synthetic-video'] }]);
    data.video!.bitRateAudioList = [{ urlList: [
      'https://v26-web-prime.douyinvod.com/audio.mp4?signature=synthetic-audio',
    ], size: 20 }];
    const item = parseDouyin(data, id).videos[0]!.variants[0]!;
    expect(item.download).toMatchObject({ mode: 'mux',
      videoUrl: 'https://v11-web-prime.douyinvod.com/video.mp4?signature=synthetic-video',
      audioUrl: 'https://v26-web-prime.douyinvod.com/audio.mp4?signature=synthetic-audio' });
  });
  it('没有可用播放源时明确标注平台下载源的水印', () => {
    const data = aweme([]);
    const item = parseDouyin(data, id).videos[0]!.variants[0]!;
    expect(item.label).toBe('1080P · 可能带平台水印');
    expect(item.download).toMatchObject({ mode: 'fetch', url: data.download!.urlList![0], fileBytes: 200 });
  });
  it('没有音轨的 DASH、H266 和非平台地址不会伪装为可下载无水印视频', () => {
    const data = aweme([rate(1080, 'dash'), { ...rate(720), isH266: true },
      { ...rate(576), playAddr: ['https://douyinvod.com.evil.example/video'] }]);
    data.video!.bitRateAudioList = [];
    delete data.download;
    expect(() => parseDouyin(data, id)).toThrow('MP4 音视频');
  });
  it('竖屏分辨率使用短边，保持 60 帧与普通帧率两个可用档位', () => {
    const data = aweme([{ ...rate(1920), width: 1080 }, { ...rate(1920), width: 1080, fps: 60 }]);
    const result = parseDouyin(data, id);
    expect(result.videos[0]!.variants.map(x => x.height)).toEqual([1080, 1080]);
    expect(result.videos[0]!.variants.some(x => x.label === '1080P 60帧')).toBe(true);
  });
  it('拒绝错误作品、图文和广告，避免旧数据被用于当前作品', () => {
    expect(() => parseDouyin(aweme([rate(1080)]), '200000000000002')).toThrow('视频已切换');
    expect(() => parseDouyin({ ...aweme([]), isSlides: true }, id)).toThrow('普通视频');
    expect(() => parseDouyin({ ...aweme([]), isAds: true }, id)).toThrow('普通视频');
  });
});

describe('抖音媒体地址筛选', () => {
  it('保留媒体地址已有的参数', () => {
    const url = 'https://v11-web-prime.douyinvod.com/video.mp4?webid=synthetic-original';
    expect(douyinStreamUrl([url])).toBe(url);
  });
  it('普通详情页 CDN 地址保持原样', () => {
    const url = 'https://v26-web.douyinvod.com/video.mp4?signature=synthetic%2Bvalue~';
    expect(douyinStreamUrl([url])).toBe(url);
  });
  it('拒绝伪造平台域名及带账号密码的地址', () => {
    expect(douyinStreamUrl(['https://douyinvod.com.evil.example/video.mp4'])).toBeNull();
    expect(douyinStreamUrl(['https://user:password@v11-web-prime.douyinvod.com/video.mp4'])).toBeNull();
  });
});
