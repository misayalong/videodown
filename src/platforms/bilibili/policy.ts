export const BILIBILI_MEDIA_DOMAINS = ['bilivideo.com', 'bilivideo.cn'];

export function allowsBilibiliStream(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password &&
    BILIBILI_MEDIA_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain));
}

export function bilibiliStreamUrl(urls: Array<string | undefined>): string | null {
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
      if (allowsBilibiliStream(url)) return url.href;
    } catch { /* 非媒体地址不进入下载结果 */ }
  }
  return null;
}
