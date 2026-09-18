import { BRIDGE_SOURCE } from '../types';
import type { BridgeRequest, BridgeResponse } from '../types';
import { installCapture } from './capture';
import { handleSolve } from './solve';

// document_start 注入：先装 hook 再让页面脚本跑，保证 innertube 响应不漏
installCapture();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const msg = event.data as BridgeRequest | undefined;
  if (!msg || msg.source !== BRIDGE_SOURCE || msg.type !== 'solve') return;
  void handleSolve(msg.videoId).then((result) => {
    const res: BridgeResponse = {
      source: BRIDGE_SOURCE,
      type: 'solveResult',
      reqId: msg.reqId,
      ...result,
    };
    try {
      window.postMessage(res, window.location.origin);
    } catch {
      // 页面正在卸载等情况，忽略
    }
  });
});

console.info('[VideoDown] main world 已注入');
