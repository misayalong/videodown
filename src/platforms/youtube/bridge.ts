import { BRIDGE_SOURCE } from './types';
import type { BridgeResponse, SolveResult } from './types';

const TIMEOUT_MS = 25_000;

const pending = new Map<string, (res: SolveResult) => void>();
let seq = 0;

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const msg = event.data as BridgeResponse | undefined;
  if (!msg || msg.source !== BRIDGE_SOURCE || msg.type !== 'solveResult') return;
  const resolve = pending.get(msg.reqId);
  if (resolve) {
    pending.delete(msg.reqId);
    resolve(msg.ok ? { ok: true, payload: msg.payload } : { ok: false, error: msg.error });
  }
});

/** 向 MAIN world 请求解析；超时/无响应一律转为错误结果，绝不抛出 */
export function requestSolve(videoId: string): Promise<SolveResult> {
  const reqId = `r${++seq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      resolve({ ok: false, error: '解析超时，请重试' });
    }, TIMEOUT_MS);
    pending.set(reqId, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
    try {
      window.postMessage({ source: BRIDGE_SOURCE, type: 'solve', reqId, videoId }, window.location.origin);
    } catch {
      clearTimeout(timer);
      pending.delete(reqId);
      resolve({ ok: false, error: '无法连接解析器，请刷新页面重试' });
    }
  });
}
