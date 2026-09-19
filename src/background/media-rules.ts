import { BILIBILI_MEDIA_DOMAINS, allowsBilibiliStream } from '../platforms/bilibili/policy';
import { DOUYIN_MEDIA_DOMAINS, allowsDouyinStream } from '../platforms/douyin/policy';

const RULE_IDS = [1001, 1002];
let ready: Promise<void> | null = null;

/** 仅匹配扩展自身发起的两站 CDN 请求，不修改网页浏览流量。 */
export function mediaRequestRules(extensionId: string): chrome.declarativeNetRequest.Rule[] {
  return [
    { id: RULE_IDS[0]!, domains: BILIBILI_MEDIA_DOMAINS, referer: 'https://www.bilibili.com/' },
    { id: RULE_IDS[1]!, domains: DOUYIN_MEDIA_DOMAINS, referer: 'https://www.douyin.com/' },
  ].map((site) => ({
    id: site.id, priority: 1,
    action: { type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [{ header: 'Referer', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: site.referer }] },
    condition: { initiatorDomains: [extensionId], requestDomains: site.domains,
      resourceTypes: ['xmlhttprequest', 'media', 'other'] as chrome.declarativeNetRequest.ResourceType[] },
  }));
}

export async function ensureMediaRequestRules(urls: string[]): Promise<void> {
  if (!urls.some((raw) => {
    const url = new URL(raw);
    return allowsBilibiliStream(url) || allowsDouyinStream(url);
  })) return;
  if (!ready) {
    ready = chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: RULE_IDS, addRules: mediaRequestRules(chrome.runtime.id),
    }).catch(() => {
      ready = null;
      throw new Error('无法设置媒体请求来源，请在 Chrome 扩展管理页刷新 VideoDown 后重试');
    });
  }
  await ready;
}
