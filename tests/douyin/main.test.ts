import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

const id = '100000000000001';
const otherId = '200000000000002';
const videoUrl = 'https://v11-web-prime.douyinvod.com/video.mp4?signature=synthetic%2Bvalue~';
const audioUrl = 'https://v26-web-prime.douyinvod.com/audio.mp4?signature=synthetic-audio';
type Processor = (url: string, options: Record<string, never>) => { url: unknown };

function player(targetId = id, format = 'mp4', process: Processor = (url) => ({ url })) {
  const preProcessUrl = vi.fn(process);
  const config = { awemeInfo: { awemeId: targetId, desc: '视频 ' + targetId,
    video: { width: 640, height: 360, duration: 1000,
      bitRateList: [{ width: 640, height: 360, format, playAddr: [{ src: videoUrl }] }],
      bitRateAudioList: [{ urlList: [{ src: audioUrl }] }],
    } }, preProcessUrl };
  const playerNode = { __reactFiber$player: { memoizedProps: { xgplayerConfig: config } } };
  const video = { currentSrc: 'blob:https://www.douyin.com/synthetic', parentElement: playerNode,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360 }) };
  const container = { getAttribute: () => targetId, classList: ['video_' + targetId],
    querySelector: () => video,
    contains: (node: unknown): boolean => node === video || node === playerNode || node === container,
    __reactFiber$outer: { memoizedProps: { item: config.awemeInfo } },
  };
  return { container, config, preProcessUrl };
}

function page(initial: ReturnType<typeof player>) {
  let current = initial;
  let receive: (event: unknown) => void = () => undefined;
  const postMessage = vi.fn();
  const window = { postMessage,
    addEventListener: (_name: string, listener: typeof receive) => { receive = listener; } };
  const location = { origin: 'https://www.douyin.com', pathname: '/', search: '?recommend=1' };
  const context = createContext({ window, location, URL, URLSearchParams,
    innerWidth: 1024, innerHeight: 768, document: { querySelectorAll: () => [current.container] } });
  runInContext(readFileSync('dist/douyin-main.js', 'utf8'), context);
  return {
    switchTo: (next: typeof initial) => { current = next; },
    resolve: async (targetId: string) => {
      postMessage.mockClear();
      receive({ source: window, origin: location.origin,
        data: { source: 'videodown:douyin', type: 'resolve', targetId, reqId: 'synthetic-request' } });
      await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
      return postMessage.mock.calls[0]![0].result;
    },
  };
}

it('MSE 的 DASH 视频和音频分别交给当前播放器处理，并保留各自签名编码', async () => {
  const suffix = '&webid=synthetic-current&fid=synthetic-session';
  const current = player(id, 'dash', (url) => ({ url: url + suffix }));
  const result = await page(current).resolve(id);
  expect(result).toMatchObject({ ok: true, media: { videos: [{ id, variants: [{ download: {
    mode: 'mux', videoUrl: videoUrl + suffix, audioUrl: audioUrl + suffix,
  } }] }] } });
  expect(current.preProcessUrl.mock.calls).toEqual([[videoUrl, {}], [audioUrl, {}]]);
});

it('推荐流切换作品后只调用新作品的播放器，不复用旧作品地址', async () => {
  const first = player(id, 'mp4', (url) => ({ url: url + '&webid=synthetic-first' }));
  const next = player(otherId, 'mp4', (url) => ({ url: url + '&webid=synthetic-next' }));
  const browser = page(first);
  expect((await browser.resolve(id)).media.videos[0].variants[0].download.url).toBe(videoUrl + '&webid=synthetic-first');
  browser.switchTo(next);
  expect(await browser.resolve(id)).toMatchObject({ ok: false, error: expect.stringContaining('视频已切换') });
  expect(await browser.resolve(otherId)).toMatchObject({ ok: true, media: { videos: [{ id: otherId,
    variants: [{ download: { url: videoUrl + '&webid=synthetic-next' } }] }] } });
  expect(first.preProcessUrl).toHaveBeenCalledTimes(1);
  expect(next.preProcessUrl).toHaveBeenCalledTimes(1);
});

it('播放器配置仍属于旧作品时不调用处理函数、不交付原始地址', async () => {
  const current = player();
  current.config.awemeInfo.awemeId = otherId;
  expect(await page(current).resolve(id)).toMatchObject({ ok: false, error: expect.stringContaining('视频数据尚未就绪') });
  expect(current.preProcessUrl).not.toHaveBeenCalled();
});

it.each([
  'https://douyinvod.com.evil.example/video.mp4',
  'https://v26-web-prime.douyinvod.com/video.mp4',
  'https://v11-web-prime.douyinvod.com/other.mp4',
  'http://v11-web-prime.douyinvod.com/video.mp4',
  'https://user:password@v11-web-prime.douyinvod.com/video.mp4',
  undefined,
])('拒绝播放器返回的无效地址或媒体替换：%s', async (url) => {
  const result = await page(player(id, 'mp4', () => ({ url }))).resolve(id);
  expect(result).toEqual({ ok: false, error: '播放器未能生成有效的下载地址，请开始播放后重新解析' });
});

it('播放器处理异常不向菜单泄露签名链接', async () => {
  const result = await page(player(id, 'mp4', () => { throw new Error(videoUrl); })).resolve(id);
  expect(result).toEqual({ ok: false, error: '播放器未能生成有效的下载地址，请开始播放后重新解析' });
});
