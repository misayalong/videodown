import { allowsYouTubeStream } from './youtube/policy';
import { allowsXStream } from './x/policy';
import { resolveX } from './x/background';
import { allowsBilibiliStream } from './bilibili/policy';
import { allowsDouyinStream } from './douyin/policy';
import type { ResolveRequest, ResolveResponse } from '../shared/media';

const streamPolicies = [allowsYouTubeStream, allowsXStream, allowsBilibiliStream, allowsDouyinStream];
const resolvers: Record<string, (id: string) => Promise<ResolveResponse>> = { x: resolveX };

export function isStreamUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && streamPolicies.some((allows) => allows(url));
  } catch { return false; }
}

export async function resolveInBackground(request: ResolveRequest): Promise<ResolveResponse> {
  const resolve = Object.hasOwn(resolvers, request.platform) ? resolvers[request.platform] : undefined;
  if (!resolve || typeof request.targetId !== 'string') return { ok: false, error: '不支持的平台解析请求' };
  return resolve(request.targetId);
}
