/** 实际构建的后台与 offscreen 链路；网络及 OPFS 使用匿名内存数据。 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { parseDouyin } from '../src/platforms/douyin/parse';
import { parseBilibili } from '../src/platforms/bilibili/parse';

type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown;
const listeners: Listener[] = [];
const session = new Map<string, unknown>();
const files = new Map<string, Uint8Array>();
const blobs = new Map<string, Blob>();
const events: Array<{ type: string; jobId: string; error?: string; percent?: number }> = [];
const rules: chrome.declarativeNetRequest.Rule[] = [];
let payload = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);

function dispatch(message: unknown, sender = {}): Promise<unknown> {
  return new Promise((resolve) => {
    let asynchronous = false;
    for (const listener of listeners) {
      if (listener(message, sender, resolve) === true) asynchronous = true;
    }
    if (!asynchronous) resolve(undefined);
  });
}

const downloads = vi.fn(async ({ url }: { url: string; filename: string }) => {
  // 原生下载不能依靠 offscreen 的来源规则；原实现会在这里复现 CDN 拒绝。
  if (url.startsWith('https://v26-web.douyinvod.com/') || url.startsWith('https://upos.bilivideo.com/')) {
    throw new Error('SERVER_FORBIDDEN');
  }
  return 1;
});

async function mediaResponse(_url: string, options: RequestInit = {}) {
  const range = new Headers(options.headers).get('Range');
  const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? '');
  expect(match).not.toBeNull();
  const start = Number(match![1]);
  const end = match![2] ? Number(match![2]) : payload.length - 1;
  return new Response(payload.slice(start, end + 1), { status: 206, headers: {
    'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${payload.length}`,
  } });
}
const fetchMedia = vi.fn(mediaResponse);

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'abcdefghijklmnopabcdefghijklmnop',
      onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
      sendMessage: dispatch },
    storage: { session: {
      get: async (key: string) => ({ [key]: session.get(key) }),
      set: async (values: Record<string, unknown>) => { Object.entries(values).forEach(([k, v]) => session.set(k, v)); },
      remove: async (keys: string[]) => { keys.forEach(k => session.delete(k)); },
    } },
    declarativeNetRequest: { updateSessionRules: async (update: chrome.declarativeNetRequest.UpdateRuleOptions) => {
      rules.splice(0, rules.length, ...update.addRules!);
    } },
    offscreen: { hasDocument: async () => true },
    tabs: { sendMessage: async (_tab: number, message: typeof events[number]) => { events.push(message); } },
    downloads: { download: downloads },
  });
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({
    getFileHandle: async (name: string) => ({
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        files.set(name, new Uint8Array());
        return {
          write: async (chunk: Uint8Array) => { chunks.push(chunk.slice()); },
          close: async () => {
            const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            files.set(name, bytes);
          },
          abort: async () => { chunks.length = 0; },
        };
      },
      getFile: async () => new File([new Uint8Array(files.get(name)!)], name, { type: 'video/mp4' }),
    }),
    removeEntry: async (name: string) => { files.delete(name); },
  }) } });
  vi.stubGlobal('fetch', fetchMedia);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    if (!(blob instanceof Blob)) throw new Error('下载结果必须是完整文件');
    const url = `blob:test-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  await import('../dist/background.js');
  await import('../dist/offscreen.js');
});

beforeEach(() => {
  session.clear(); files.clear(); blobs.clear(); events.length = 0;
  downloads.mockClear(); fetchMedia.mockReset(); fetchMedia.mockImplementation(mediaResponse);
  payload = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
});

afterEach(async () => {
  const jobId = session.get('busy');
  if (jobId) await dispatch({ type: 'muxCancel', jobId });
  await vi.waitFor(() => expect(session.has('busy')).toBe(false));
});

function request(platform = 'douyin', size: number | null = payload.length) {
  if (platform === 'bilibili') return parseBilibili({ bvid: 'BVtest', title: '测试',
    pages: [{ page: 1, cid: 1, part: 'P1', duration: 1 }] }, {
    quality: 16, format: 'mp4', durl: [{ url: 'https://upos.bilivideo.com/test.mp4', size: size ?? undefined }],
  }, 1).videos[0]!.variants[0]!.download;
  return parseDouyin({ awemeId: '100000000000001', desc: '测试', video: {
    width: 640, height: 360, duration: 1000, bitRateList: [{ width: 640, height: 360, format: 'mp4',
      dataSize: size ?? undefined, playAddr: [{ src: 'https://v26-web.douyinvod.com/test.mp4' }] }],
  } }, '100000000000001').videos[0]!.variants[0]!.download;
}

async function start(download = request()) {
  return await dispatch(download, { tab: { id: 42 } }) as { ok: boolean; jobId?: string; error?: string };
}

async function completed(jobId: string) {
  await vi.waitFor(() => expect(events.some(e => e.type === 'muxComplete' && e.jobId === jobId)).toBe(true));
  const call = downloads.mock.calls.at(-1)![0];
  expect(call.url).toMatch(/^blob:/);
  expect(Buffer.compare(Buffer.from(await blobs.get(call.url)!.arrayBuffer()), Buffer.from(payload))).toBe(0);
  expect(session.has('busy')).toBe(false);
}

describe('完整 MP4 通过 offscreen 获取后原样保存', () => {
  it.each([
    ['v11-web-prime', 'https'], ['v26-web-prime', 'https'],
    ['v11-web-prime', 'blob'], ['v26-web-prime', 'blob'],
  ])('推荐流 %s / %s：MAIN 使用当前播放器处理的地址完成下载', async (host, playback) => {
    const id = '100000000000001';
    const url = `https://${host}.douyinvod.com/video.mp4?signature=synthetic%2Bvalue~&tk=synthetic`;
    const suffix = '&webid=synthetic-device&fid=synthetic-session';
    const video = { currentSrc: playback === 'blob' ? 'blob:https://www.douyin.com/synthetic' : url + suffix,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 640, bottom: 360 }) };
    const aweme = { awemeId: id, desc: '推荐流测试', video: {
      width: 640, height: 360, duration: 1000,
      bitRateList: [{ width: 640, height: 360, format: 'mp4', dataSize: payload.length,
        playAddr: [{ src: url }] }],
    } };
    const preProcessUrl = vi.fn((raw: string) => ({ url: raw + suffix }));
    const playerNode = { __reactFiber$player: { memoizedProps: {
      xgplayerConfig: { awemeInfo: aweme, preProcessUrl },
    } } };
    const container = {
      getAttribute: () => id, classList: ['video_' + id], querySelector: () => video,
      contains: (node: unknown): boolean => node === video || node === playerNode || node === container,
      __reactFiber$fixture: { memoizedProps: { item: aweme } },
    };
    Object.assign(video, { parentElement: playerNode });
    Object.assign(playerNode, { parentElement: container });
    Object.assign(playerNode.__reactFiber$player, { return: container.__reactFiber$fixture });
    let receive: (event: unknown) => void = () => undefined;
    const postMessage = vi.fn();
    const window = { addEventListener: (_name: string, listener: typeof receive) => { receive = listener; }, postMessage };
    const location = { origin: 'https://www.douyin.com', pathname: '/', search: '?recommend=1' };
    const context = createContext({ window, location, URL, URLSearchParams,
      document: { querySelectorAll: () => [container] }, innerWidth: 1024, innerHeight: 768 });
    runInContext(readFileSync('dist/douyin-main.js', 'utf8'), context);
    receive({ source: window, origin: location.origin,
      data: { source: 'videodown:douyin', type: 'resolve', targetId: id, reqId: 'feed-test' } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    const resolved = postMessage.mock.calls[0]![0].result;
    expect(resolved.ok).toBe(true);
    // 真实 prime CDN 的最小复现：缺少播放器追加的 webid 时，即使在网页中也返回 403。
    fetchMedia.mockImplementation(async (raw, options) => {
      if (new URL(raw).searchParams.get('webid') !== 'synthetic-device') return new Response(null, { status: 403 });
      return mediaResponse(raw, options);
    });
    const result = await start(resolved.media.videos[0].variants[0].download);
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(events.some(e => ['muxComplete', 'muxFailed'].includes(e.type))).toBe(true));
    expect(events.filter(e => ['muxComplete', 'muxFailed'].includes(e.type))).toEqual([
      { type: 'muxComplete', jobId: result.jobId },
    ]);
    await completed(result.jobId!);
    // 原始签名编码保留，使用网站函数的完整结果，不依赖 video.currentSrc。
    expect(fetchMedia.mock.calls[0]![0]).toBe(url + suffix);
    expect(preProcessUrl).toHaveBeenCalledWith(url, {});
  });

  it.each(['douyin', 'bilibili'])('%s 不直接下载 CDN URL，多段字节顺序和文件名保持一致', async (platform) => {
    // 跨越现有 8 MiB 分段边界，验证不会丢字节、重排或重复拼接。
    payload = Uint8Array.from({ length: 8 * 1024 * 1024 + 37 }, (_, i) => i % 251);
    const download = request(platform);
    const result = await start(download);
    expect(result.ok).toBe(true);
    expect(result.jobId).toBeTruthy();
    await completed(result.jobId!);
    expect(downloads.mock.calls[0]![0].filename).toBe(download.filename);
    expect(fetchMedia).toHaveBeenCalledTimes(2);
    expect(events.some(e => e.type === 'muxProgress' && e.percent === 99)).toBe(true);
    expect(rules.every(r => r.condition.initiatorDomains?.[0] === 'abcdefghijklmnopabcdefghijklmnop')).toBe(true);
  });

  it('HTTP 403 不保存错误页，反馈错误并释放槽位；重试可以成功', async () => {
    payload = new Uint8Array([0, 1, 2, 3]);
    fetchMedia.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    fetchMedia.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    const result = await start();
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(events.some(e => e.type === 'muxFailed' && e.jobId === result.jobId)).toBe(true));
    expect(events.find(e => e.type === 'muxFailed')!.error).toContain('HTTP 403');
    expect(downloads).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
    expect(session.has('busy')).toBe(false);
    const retry = await start();
    expect(retry.ok).toBe(true);
    await completed(retry.jobId!);
  });

  it('未知长度也保存完整文件；取消可中断读取、删除临时文件并重开', async () => {
    let aborted = false;
    fetchMedia.mockImplementationOnce(async (_url, options = {}) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        options.signal!.addEventListener('abort', () => {
          aborted = true;
          controller.error(new DOMException('cancelled', 'AbortError'));
        }, { once: true });
      },
    }), { status: 206 }));
    const result = await start(request('douyin', null));
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(fetchMedia).toHaveBeenCalled());
    await dispatch({ type: 'muxCancel', jobId: result.jobId });
    await vi.waitFor(() => expect(files.size).toBe(0));
    expect(aborted).toBe(true);
    expect(downloads).not.toHaveBeenCalled();
    expect(events.some(e => e.type === 'muxCancelled' && e.jobId === result.jobId)).toBe(true);
    const retry = await start(request('douyin', null));
    expect(retry.ok).toBe(true);
    await completed(retry.jobId!);
  });

  it('完整文件与合并共用一个槽位，YouTube/X 原生直链仍可同时下载', async () => {
    fetchMedia.mockImplementationOnce(async (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const mux = { type: 'download', mode: 'mux', filename: 'mux.mp4', container: 'mp4',
      videoUrl: 'https://media.googlevideo.com/video', audioUrl: 'https://media.googlevideo.com/audio',
      videoCodec: 'avc', audioCodec: 'aac', videoBytes: null, audioBytes: null };
    const results = await Promise.all([start(), dispatch(mux)]) as Array<{ ok: boolean; jobId?: string }>;
    expect(results.map(r => r.ok)).toEqual([true, false]);
    const second = await start(request('bilibili'));
    expect(second.ok).toBe(false);
    for (const url of ['https://video.twimg.com/video.mp4', 'https://media.googlevideo.com/video']) {
      expect(await dispatch({ type: 'download', mode: 'direct', filename: 'legacy.mp4', url })).toEqual({ ok: true });
    }
    expect(downloads).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(fetchMedia).toHaveBeenCalled());
    await dispatch({ type: 'muxCancel', jobId: results[0]!.jobId });
    await vi.waitFor(() => expect(session.has('busy')).toBe(false));
  });
});
