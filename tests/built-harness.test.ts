/**
 * 构建产物测试台：mock chrome API，导入真实的 dist/background.js 与 dist/offscreen.js，
 * 按 Chrome 的消息语义（多播 + sendResponse 异步应答）走完整链路。
 * 校验点：合法 mux 请求能通过地址校验并启动合并；非法/缺失字段请求的错误带诊断信息。
 * 模块只导入一次（vitest 缓存模块实例，重复 import 不会重新注册 listener）。
 * 需先 npm run build（产物存在时才执行）。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => unknown;

const listeners: Listener[] = [];
const tabMessages: Array<{ tabId: number | null; msg: Record<string, unknown> }> = [];
const downloadCalls: Array<{ url: string; filename: string }> = [];
const sessionStore = new Map<string, unknown>();

// 按 Chrome 语义多播给所有 listener，第一个 sendResponse 生效
const dispatch = (message: unknown, sender: unknown = {}): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('dispatch 超时：没有任何 listener 调用 sendResponse'));
      }
    }, 3_000);
    for (const listener of [...listeners]) {
      listener(
        message,
        sender,
        (r: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(r);
          }
        },
      );
    }
  });

(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
    sendMessage: (msg: unknown) => dispatch(msg),
    getManifest: () => ({ version: '0.0.0-harness' }),
  },
  storage: {
    session: {
      get: async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (sessionStore.has(k)) out[k] = sessionStore.get(k);
        return out;
      },
      set: async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) sessionStore.set(k, v);
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(k);
      },
    },
  },
  offscreen: {
    hasDocument: async () => false,
    createDocument: async () => undefined,
  },
  tabs: {
    sendMessage: async (tabId: number, msg: unknown) => {
      tabMessages.push({ tabId, msg: msg as Record<string, unknown> });
    },
  },
  downloads: {
    download: async (opts: { url: string; filename: string }) => {
      downloadCalls.push(opts);
      return 1;
    },
  },
};

const distReady = existsSync(resolve(import.meta.dirname, '../dist/background.js'));

describe.skipIf(!distReady)('构建产物 × chrome 消息链路', () => {
  beforeAll(async () => {
    await import('../dist/background.js');
    await import('../dist/offscreen.js');
  });

  it('背景与离线页监听器均注册', () => {
    expect(listeners.length).toBe(2);
  });

  it('合法 mux 请求通过地址校验并启动流程（ok+jobId），失败经 muxError 回传到标签页', async () => {
    const res = (await dispatch(
      {
        type: 'download',
        mode: 'mux',
        filename: '测试视频_2160p60.mp4',
        container: 'mp4',
        videoUrl: 'https://rr4---sn-a5msen7s.googlevideo.com/videoplayback?expire=1789328392&n=abc&sig=x',
        videoCodec: 'av1',
        audioUrl: 'https://rr4---sn-a5msen7s.googlevideo.com/videoplayback?itag=140&n=abc',
        audioCodec: 'aac',
        videoBytes: 321_000_000,
        audioBytes: 13_000_000,
      },
      { tab: { id: 42 } },
    )) as { ok: boolean; jobId?: string };

    // 关键断言：URL 校验放行，合并流程启动
    expect(res.ok).toBe(true);
    expect(res.jobId).toBeTruthy();

    // Node 无 OPFS：offscreen 应走 muxError → background 转发 muxFailed 到标签页（错误链路完整性）
    await vi.waitFor(
      () =>
        expect(
          tabMessages.some((m) => m.tabId === 42 && m.msg.type === 'muxFailed'),
        ).toBe(true),
      { timeout: 5_000 },
    );
  }, 15_000);

  it('缺失 videoUrl 的 mux 请求被拒，错误带诊断字段名', async () => {
    const res = (await dispatch(
      { type: 'download', mode: 'mux', filename: 'x.mp4', container: 'mp4' },
      { tab: { id: 1 } },
    )) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('视频轨');
    expect(res.error).toContain('缺失');
  }, 15_000);

  it('取消进行中的合并任务：标签页收到 muxCancelled，槽位立即释放可重开新任务', async () => {
    const jobId = 'm-cancel-test';
    // 模拟 offscreen 正在跑（Node 无 OPFS，真实任务会立刻失败，故直接构造忙碌态）
    sessionStore.set('busy', jobId);
    sessionStore.set(jobId, { jobId, tabId: 42, filename: '取消测试.mp4' });
    tabMessages.length = 0;

    const res = (await dispatch({ type: 'muxCancel', jobId }, { tab: { id: 42 } })) as { ok: boolean };
    expect(res.ok).toBe(true);

    await vi.waitFor(
      () => expect(tabMessages.some((m) => m.tabId === 42 && m.msg.type === 'muxCancelled')).toBe(true),
      { timeout: 5_000 },
    );
    // 槽位释放：busy 与任务记录都要清掉
    expect(sessionStore.has('busy')).toBe(false);
    expect(sessionStore.has(jobId)).toBe(false);

    // 重复的取消回执（offscreen 收尾 + 3s 兜底）不得再打扰 UI；该消息无人应答，故不 await
    const after = tabMessages.length;
    void dispatch({ type: 'muxCancelled', jobId }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(tabMessages.length).toBe(after);

    // 释放后可立刻发起新任务（不被「已有合并任务进行中」拦截）
    const next = (await dispatch(
      {
        type: 'download',
        mode: 'mux',
        filename: '新任务.mp4',
        container: 'mp4',
        videoUrl: 'https://rr4---sn-a5msen7s.googlevideo.com/videoplayback?itag=401',
        videoCodec: 'av1',
        audioUrl: 'https://rr4---sn-a5msen7s.googlevideo.com/videoplayback?itag=140',
        audioCodec: 'aac',
      },
      { tab: { id: 42 } },
    )) as { ok: boolean; error?: string };
    expect(next.ok).toBe(true);
    // 清理：该任务在 Node 下会失败并自行收尾，这里只确保不残留忙碌标记
    await vi.waitFor(() => expect(sessionStore.has('busy')).toBe(false), { timeout: 5_000 });
  }, 15_000);

  it('合法直链请求走 chrome.downloads', async () => {
    const res = (await dispatch(
      {
        type: 'download',
        mode: 'direct',
        url: 'https://rr4---sn-a5msen7s.googlevideo.com/videoplayback?itag=18',
        filename: 'a_360p.mp4',
      },
      { tab: { id: 1 } },
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0]!.filename).toBe('a_360p.mp4');
  }, 15_000);
  it('X 直链也经同一个后台发起下载，不需要右键 API', async () => {
    const res = await dispatch({ type: 'download', mode: 'direct', url: 'https://video.twimg.com/test/video.mp4', filename: 'example.mp4' }) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(downloadCalls.at(-1)!.url).toBe('https://video.twimg.com/test/video.mp4');
  });

  it('忙碌合并任务不会阻塞直链，也不会被新合并请求覆盖', async () => {
    sessionStore.set('busy', 'existing');
    const res = await dispatch({ type: 'download', mode: 'mux', container: 'mp4', videoUrl: 'https://media.googlevideo.com/video', audioUrl: 'https://media.googlevideo.com/audio' }) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(sessionStore.get('busy')).toBe('existing');
    const direct = await dispatch({ type: 'download', mode: 'direct', url: 'https://video.twimg.com/test/video.mp4', filename: 'busy.mp4' }) as { ok: boolean };
    expect(direct.ok).toBe(true);
    sessionStore.delete('busy');
  });

  it('同时收到两个合并请求只接受一个', async () => {
    const request = { type: 'download', mode: 'mux', filename: 'concurrent.mp4', container: 'mp4', videoUrl: 'https://media.googlevideo.com/video', audioUrl: 'https://media.googlevideo.com/audio', videoCodec: 'avc', audioCodec: 'aac' };
    const results = await Promise.all([dispatch(request, { tab: { id: 1 } }), dispatch(request, { tab: { id: 2 } })]) as Array<{ ok: boolean }>;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    await vi.waitFor(() => expect(sessionStore.has('busy')).toBe(false));
  });

});
