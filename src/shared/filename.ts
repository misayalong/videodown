const ILLEGAL_RE = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;

export function sanitizeFilename(name: string): string {
  return name
    .replace(ILLEGAL_RE, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .trim();
}

/** {标题}_{label}.{ext}，非法字符清洗，总长 180 上限（复用 XDown 的清洗规则） */
export function buildFilename(title: string, label: string, ext: string): string {
  const safeTitle = sanitizeFilename(title || 'video').replace(/[._]+$/, '') || 'video';
  const suffix = `_${label.toLowerCase()}.${ext}`;
  const maxTitle = Math.max(1, 180 - suffix.length);
  return `${safeTitle.slice(0, maxTitle)}${suffix}`;
}
