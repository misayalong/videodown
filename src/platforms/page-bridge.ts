import type { MediaCollection, ResolveResponse } from '../shared/media';

/** 两个新平台在页面上下文中使用已有登录态，只向扩展交付媒体结果。 */
export function requestPageMedia(platform: string, targetId: string): Promise<MediaCollection> {
  const source = 'videodown:' + platform;
  const reqId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const finish = (result: ResolveResponse): void => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (result.ok) resolve(result.media);
      else reject(new Error(result.error));
    };
    const receive = (event: MessageEvent): void => {
      const data = event.data;
      if (event.source !== window || event.origin !== location.origin ||
          data?.source !== source || data?.type !== 'result' || data?.reqId !== reqId) return;
      finish(data.result as ResolveResponse);
    };
    const timer = setTimeout(() => finish({ ok: false, error: '解析超时，请刷新页面后重试' }), 20_000);
    window.addEventListener('message', receive);
    window.postMessage({ source, type: 'resolve', reqId, targetId }, location.origin);
  });
}

export function servePageMedia(platform: string, resolve: (id: string) => Promise<MediaCollection>): void {
  const source = 'videodown:' + platform;
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin ||
        data?.source !== source || data?.type !== 'resolve' ||
        typeof data.reqId !== 'string' || typeof data.targetId !== 'string') return;
    void resolve(data.targetId).then(
      (media): ResolveResponse => ({ ok: true, media }),
      (error): ResolveResponse => ({ ok: false, error: error instanceof Error ? error.message : '解析失败，请重试' }),
    ).then((result) => {
      window.postMessage({ source, type: 'result', reqId: data.reqId, result }, location.origin);
    });
  });
}
