import { ParseError, parseTweetResponse } from './parse';
import { toMedia } from './media';
import type { ResolveResponse } from '../../shared/media';

export async function resolveX(targetId: string): Promise<ResolveResponse> {
  if (!/^\d{5,25}$/.test(targetId)) return { ok: false, error: '未能定位到推文，请刷新页面后重试' };
  try {
    const response = await fetch(`https://api.fxtwitter.com/status/${targetId}`, {
      signal: AbortSignal.timeout(12_000), credentials: 'omit',
    });
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new ParseError(response.ok ? '解析服务返回了异常数据' : `解析服务错误（HTTP ${response.status}）`);
    }
    const tweet = parseTweetResponse(payload);
    if (tweet.tweetId !== targetId) throw new ParseError('解析服务返回了不匹配的推文');
    return { ok: true, media: toMedia(tweet) };
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: error.message };
    if (error instanceof Error && error.name === 'TimeoutError') return { ok: false, error: '解析超时，请重试' };
    return { ok: false, error: '网络错误，无法连接解析服务' };
  }
}
