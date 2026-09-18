import { sanitizeFilename } from '../../shared/filename';

export interface FilenameOptions {
  handle: string | null;
  tweetId: string;
  label: string;
  videoNumber?: number;
}

export function buildFilename(opts: FilenameOptions): string {
  const handle = (opts.handle ?? 'x').replace(/^@+/, '').trim() || 'x';
  let base = `${handle}_${opts.tweetId}_${opts.label.toLowerCase()}`;
  if (opts.videoNumber != null) base += `_v${opts.videoNumber}`;
  let name = sanitizeFilename(`${base}.mp4`);
  if (name.length > 180) name = `${name.slice(0, 176)}.mp4`;
  return name;
}
