export function bilibiliTarget(url: URL): string | null {
  const video = /^\/video\/(BV[A-Za-z0-9]+|av\d+)(?:\/|$)/.exec(url.pathname)?.[1];
  const page = Number(url.searchParams.get('p') || '1');
  return video && Number.isSafeInteger(page) && page > 0 ? video + ':p' + page : null;
}

export function parseBilibiliTarget(id: string): { video: string; page: number } {
  const match = /^(BV[A-Za-z0-9]+|av\d+):p([1-9]\d*)$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('无效的 B 站视频或分 P');
  return { video: match[1]!, page: Number(match[2]) };
}
