import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it.each(['bilibili', 'douyin'])('%s MAIN 经典脚本不向网站暴露内部全局变量', (platform) => {
  const context = createContext({ window: { addEventListener: vi.fn() } });
  const before = Object.keys(context);
  runInContext(readFileSync(`dist/${platform}-main.js`, 'utf8'), context);
  expect(Object.keys(context)).toEqual(before);
});

it('B 站网页定义同名函数后，构建产物仍通过当前分 P 接口解析媒体', async () => {
  let receive: (event: unknown) => void = () => undefined;
  const postMessage = vi.fn();
  const window = {
    addEventListener: (_name: string, listener: typeof receive) => { receive = listener; },
    postMessage,
  };
  const fetch = vi.fn(async (url: URL) => ({
    ok: true,
    json: async () => ({ code: 0, data: url.pathname.endsWith('/view') ? {
      bvid: 'BV1Synthetic', title: '测试视频',
      pages: [{ page: 1, cid: 101, part: '第一集', duration: 10 }],
    } : {
      quality: 80, dash: {
        video: [{ id: 80, height: 1080, codecs: 'avc1.640028', bandwidth: 1000, baseUrl: 'https://cdn.bilivideo.com/video.m4s' }],
        audio: [{ id: 30280, codecs: 'mp4a.40.2', bandwidth: 100, baseUrl: 'https://cdn.bilivideo.com/audio.m4s' }],
      },
    } }),
  }));
  const location = { href: 'https://www.bilibili.com/video/BV1Synthetic/', origin: 'https://www.bilibili.com' };
  const context = createContext({ window, location, fetch, URL, URLSearchParams, AbortSignal });
  runInContext(readFileSync('dist/bilibili-main.js', 'utf8'), context);
  // 真实页面会在 document_start 之后加载自己的脚本；旧构建的 f 被它覆盖。
  runInContext('var f = function websiteBundle() { return {}; };', context);
  receive({ source: window, origin: location.origin,
    data: { source: 'videodown:bilibili', type: 'resolve', targetId: 'BV1Synthetic:p1', reqId: 'test' } });
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  expect(postMessage.mock.calls[0]![0].result).toMatchObject({ ok: true,
    media: { videos: [{ id: 'BV1Synthetic:101', variants: [{ download: { mode: 'mux' } }] }] } });
  expect(fetch).toHaveBeenCalledTimes(2);
});
