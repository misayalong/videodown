import type { DouyinAddress } from './types';

export const DOUYIN_MEDIA_DOMAINS = ['douyinvod.com'];

export function allowsDouyinStream(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password &&
    DOUYIN_MEDIA_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain));
}

export function douyinStreamUrl(urls: DouyinAddress[] | undefined): string | null {
  for (const address of urls ?? []) {
    try {
      const raw = typeof address === 'string' ? address : address.src;
      const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
      if (allowsDouyinStream(url)) return url.href;
    } catch { /* 忽略非媒体链接 */ }
  }
  return null;
}
