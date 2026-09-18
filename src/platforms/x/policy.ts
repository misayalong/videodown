export function allowsXStream(url: URL): boolean {
  return url.hostname === 'video.twimg.com';
}
