export function allowsYouTubeStream(url: URL): boolean {
  const h = url.hostname;
  return h === 'googlevideo.com' || h.endsWith('.googlevideo.com')
    || h === 'gvt1.com' || h.endsWith('.gvt1.com') || h.endsWith('.youtube.com');
}
