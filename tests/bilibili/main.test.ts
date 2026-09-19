import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('MAIN 解析每次使用当前分 P 的 cid 与网页登录态，旧目标和 API 错误可重试', async () => {
  let receiver: (event: MessageEvent) => void = () => undefined;
  const postMessage = vi.fn();
  const windowMock = {
    addEventListener: (_name: string, callback: typeof receiver) => { receiver = callback; },
    postMessage,
  };
  const locationMock = { href: 'https://www.bilibili.com/video/BV1Synthetic/?p=1', origin: 'https://www.bilibili.com' };
  vi.stubGlobal('window', windowMock);
  vi.stubGlobal('location', locationMock);
  let deny = false;
  const fetchMock = vi.fn(async (url: URL) => ({
    ok: true,
    json: async () => deny ? { code: -101 } : {
      code: 0,
      data: url.pathname.endsWith('/view') ? {
        bvid: 'BV1Synthetic', title: '测试',
        pages: [{ cid: 101, page: 1, part: '一', duration: 10 }, { cid: 102, page: 2, part: '二', duration: 20 }],
      } : {
        quality: 80, dash: {
          video: [{ id: 80, codecs: 'avc1.640028', bandwidth: 1000, height: 1080, baseUrl: 'https://cdn.bilivideo.com/' + url.searchParams.get('cid') + '.m4s' }],
          audio: [{ id: 30280, codecs: 'mp4a.40.2', bandwidth: 100, baseUrl: 'https://cdn.bilivideo.com/a.m4s' }],
        },
      },
    },
  }));
  vi.stubGlobal('fetch', fetchMock);
  await import('../../src/platforms/bilibili/main');
  const request = (targetId: string, reqId: string) => receiver({
    source: windowMock, origin: locationMock.origin,
    data: { source: 'videodown:bilibili', type: 'resolve', targetId, reqId },
  } as unknown as MessageEvent);
  request('BV1Synthetic:p1', 'first');
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  expect(postMessage.mock.calls[0]![0].result.media.videos[0].id).toBe('BV1Synthetic:101');
  expect(fetchMock.mock.calls[1]![0].searchParams.get('cid')).toBe('101');
  expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: 'include' }));
  locationMock.href = 'https://www.bilibili.com/video/BV1Synthetic/?p=2';
  request('BV1Synthetic:p2', 'second');
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
  expect(postMessage.mock.calls[1]![0].result.media.videos[0].id).toBe('BV1Synthetic:102');
  request('BV1Synthetic:p1', 'stale');
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(3));
  expect(postMessage.mock.calls[2]![0].result.error).toContain('视频已切换');
  expect(fetchMock).toHaveBeenCalledTimes(4);
  deny = true;
  request('BV1Synthetic:p2', 'denied');
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(4));
  expect(postMessage.mock.calls[3]![0].result.error).toContain('登录');
  deny = false;
  request('BV1Synthetic:p2', 'retry');
  await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(5));
  expect(postMessage.mock.calls[4]![0].result.ok).toBe(true);
});
