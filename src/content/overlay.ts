import type {
  BgRequest,
  DownloadResponse,
  MuxClientMessage,
} from '../shared/types';
import type { Platform, VideoTarget } from '../platforms/types';
import type { MediaCollection, DownloadOption } from '../shared/media';
import styles from './overlay.css?inline';

const BTN_SIZE = 34;
const BTN_MARGIN = 8;
let platform: Platform;
let currentTarget: VideoTarget | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;
// 鼠标移出后延迟隐藏：足够跨过按钮与菜单之间的间隙，也容忍手抖
const HOVER_HIDE_DELAY_MS = 250;
// 全屏时视频铺满视口，「移出区域」永不发生，改用静止时长判定
const FULLSCREEN_IDLE_MS = 3000;

const SVG_NS = 'http://www.w3.org/2000/svg';

function createIconButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'vd-btn';
  button.type = 'button';
  button.hidden = true;
  button.title = '下载此视频';
  button.setAttribute('aria-label', '下载此视频');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const stroke = document.createElementNS(SVG_NS, 'path');
  stroke.setAttribute('d', 'M12 3v10.5m0 0 4.5-4.5M12 13.5 7.5 9');
  stroke.setAttribute('stroke', 'currentColor');
  stroke.setAttribute('stroke-width', '2.2');
  stroke.setAttribute('stroke-linecap', 'round');
  stroke.setAttribute('stroke-linejoin', 'round');
  const baseline = document.createElementNS(SVG_NS, 'path');
  baseline.setAttribute('d', 'M4.5 19.5h15');
  baseline.setAttribute('stroke', 'currentColor');
  stroke.setAttribute('stroke-width', '2.2');
  stroke.setAttribute('stroke-linecap', 'round');
  svg.append(stroke, baseline);
  button.append(svg);
  return button;
}

let host: HTMLDivElement;
let btn: HTMLButtonElement;
let menu: HTMLDivElement;
let rafId = 0;
let openSeq = 0;
let currentVideoId: string | null = null;
// ---- 悬停显隐状态 ----
let pointerX = -1;
let pointerY = -1;
let lastMoveAt = 0;
let btnVisible = false;
let hideTimer = 0;
// 当前页面按平台目标 ID 缓存 30 分钟，重试时丢弃缓存。
const cache = new Map<string, { expires: number; parsed: MediaCollection }>();

function closeMenu(): void {
  openSeq++;
  menu.hidden = true;
}

function hideAll(): void {
  openSeq++;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = 0;
  }
  btnVisible = false;
  btn.classList.remove('vd-leaving');
  btn.hidden = true;
  menu.hidden = true;
}

function pointInRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * 按钮是否该显示。
 * 豁免项（必须常显）：合并任务进行中——活动条目就是取消入口，不可因鼠标移开而消失。
 * 菜单已打开时同样视为悬停，否则用户从按钮移向条目途中按钮会消失。
 */
function shouldShowButton(rect: DOMRect): boolean {
  if (muxJobId) return true;
  if (!menu.hidden) return true;
  if (pointerX < 0) return false;
  if (document.fullscreenElement && Date.now() - lastMoveAt > FULLSCREEN_IDLE_MS) return false;
  if (pointInRect(pointerX, pointerY, rect)) return true;
  return pointInRect(pointerX, pointerY, btn.getBoundingClientRect());
}

function applyButtonVisibility(want: boolean): void {
  if (want) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    btnVisible = true;
    btn.hidden = false;
    btn.classList.remove('vd-leaving');
    return;
  }
  if (!btnVisible || hideTimer) return;
  // 先淡出，延迟结束才真正 display:none，避免沿边缘划过时高频闪
  btn.classList.add('vd-leaving');
  hideTimer = window.setTimeout(() => {
    hideTimer = 0;
    btnVisible = false;
    btn.hidden = true;
  }, HOVER_HIDE_DELAY_MS);
}

function onPointerMove(e: PointerEvent): void {
  pointerX = e.clientX;
  pointerY = e.clientY;
  lastMoveAt = Date.now();
}

// 指针离开文档（移出窗口/切走）后不应继续判定为悬停
function onPointerOut(): void {
  pointerX = -1;
  pointerY = -1;
}

function startRaf(): void {
  if (rafId) return;
  rafId = requestAnimationFrame(tick);
}

function tick(): void {
  rafId = requestAnimationFrame(tick);

  currentTarget = platform.locate({ x: pointerX, y: pointerY }, currentTarget, !menu.hidden);
  const videoId = currentTarget?.id ?? null;
  if (videoId !== currentVideoId) {
    currentVideoId = videoId;
    closeMenu();
  }

  // 显示期间每帧守护：若宿主被页面 CSS 重新隐藏则立即恢复
  if (getComputedStyle(host).display === 'none') hardenHostStyle();

  if (!currentTarget) {
    hideAll();
    return;
  }
  const rect = currentTarget.rect;
  const tiny =
    rect.width < platform.minPlayerSize.width || rect.height < platform.minPlayerSize.height;
  const offscreen = rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth;
  if (tiny || offscreen) {
    hideAll();
    return;
  }
  syncPositions(rect);
  applyButtonVisibility(shouldShowButton(rect));
}

function syncPositions(rect: DOMRect): void {
  const left = Math.round(Math.min(Math.max(8, rect.right - BTN_SIZE - BTN_MARGIN), innerWidth - BTN_SIZE - 8));
  const top = Math.round(Math.min(Math.max(8, rect.top + BTN_MARGIN), innerHeight - BTN_SIZE - 8));
  btn.style.left = `${left}px`;
  btn.style.top = `${top}px`;
  positionMenu(rect);
}

function positionMenu(rect?: DOMRect): void {
  if (menu.hidden) return;
  const playerRect = rect ?? currentTarget?.rect;
  if (!playerRect) return;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = playerRect.right - mw;
  let top = playerRect.top + BTN_MARGIN + BTN_SIZE + 6;
  if (top + mh > innerHeight - 8) {
    top = playerRect.top - mh - 6;
    if (top < 8) top = Math.max(8, innerHeight - mh - 8);
  }
  left = Math.min(Math.max(8, left), innerWidth - mw - 8);
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function statusEl(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'vd-status';
  el.textContent = text;
  return el;
}

function formatSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)}GB`;
  if (mb >= 1) return `${mb.toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function durationText(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function titleRow(video: { title: string; durationSeconds?: number | null }): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'vd-title';
  const label = document.createElement('span');
  const parts = [video.title, durationText(video.durationSeconds ?? null)].filter(Boolean);
  label.textContent = `VideoDown · ${parts.join(' · ')}`;
  label.title = video.title;
  // 版本号常驻菜单：远程排查时一眼确认浏览器里跑的是哪个构建
  let version = '';
  try {
    version = chrome.runtime.getManifest().version;
  } catch {
    // 忽略
  }
  const ver = document.createElement('span');
  ver.className = 'vd-ver';
  ver.textContent = version ? `v${version}` : '';
  const close = document.createElement('button');
  close.className = 'vd-close';
  close.type = 'button';
  close.textContent = '✕';
  close.setAttribute('aria-label', '关闭');
  close.addEventListener('click', () => closeMenu());
  row.append(label, ver, close);
  return row;
}

function sectionEl(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'vd-section';
  el.textContent = text;
  return el;
}

function variantSub(variant: DownloadOption): string {
  const bits: string[] = [variant.ext.toUpperCase()];
  if (variant.kind === 'video' && variant.height != null) {
    bits.push(`${variant.height}p`);
  }
  const size = formatSize(variant.contentLength);
  if (size) bits.push(size);
  if (variant.download.mode === 'mux') bits.push('合并音视频');
  return bits.join(' · ');
}

function variantItem(variant: DownloadOption): HTMLButtonElement {
  const item = document.createElement('button');
  item.className = 'vd-item';
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  item.dataset.label = variant.label;
  item.dataset.optionId = variant.id;
  item.dataset.mode = variant.download.mode;
  const main = document.createElement('div');
  main.className = 'vd-main';
  main.textContent = variant.label;
  item.append(main);
  const sub = variantSub(variant);
  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'vd-sub';
    subEl.textContent = sub;
    item.append(subEl);
  }
  item.addEventListener('click', () => void startDownload(variant, item));
  return item;
}

function renderParsed(media: MediaCollection): void {
  lastRendered = media;
  const frag = document.createDocumentFragment();
  frag.append(titleRow({ title: media.title, durationSeconds: media.videos.length === 1 ? media.videos[0]?.durationSeconds : null }));
  for (const video of media.videos) {
    if (media.videos.length > 1) frag.append(sectionEl([video.title, durationText(video.durationSeconds)].filter(Boolean).join(' · ')));
    for (const variant of video.variants.filter((v) => v.kind === 'video')) frag.append(variantItem(variant));
    const audio = video.variants.filter((v) => v.kind === 'audio');
    if (audio.length) frag.append(sectionEl('音频'));
    for (const variant of audio) frag.append(variantItem(variant));
  }
  menu.replaceChildren(frag);
  restoreMuxState();
  positionMenu();
}
function renderError(message: string): void {
  const box = document.createElement('div');
  box.className = 'vd-error';
  box.textContent = message;
  const retry = document.createElement('button');
  retry.className = 'vd-retry';
  retry.type = 'button';
  retry.textContent = '重试';
  retry.addEventListener('click', () => void openMenu(true));
  menu.replaceChildren(box, retry);
  positionMenu();
}

async function openMenu(bustCache = false): Promise<void> {
  const videoId = currentVideoId;
  if (!videoId) return;
  const seq = ++openSeq;
  menu.hidden = false;
  menu.replaceChildren(statusEl('解析中…'));
  positionMenu();

  // 重试必须作废缓存：否则拿到的是同一批（可能已失效的）链接，重试永远无效
  if (bustCache) cache.delete(videoId);
  const hit = cache.get(videoId);
  if (hit && hit.expires > Date.now()) {
    if (seq !== openSeq) return;
    renderParsed(hit.parsed);
    return;
  }

  try {
    const parsed = await platform.resolve(videoId);
    if (seq !== openSeq || videoId !== currentVideoId) return;
    cache.set(videoId, { expires: Date.now() + CACHE_TTL_MS, parsed });
    renderParsed(parsed);
  } catch (err) {
    if (seq !== openSeq) return;
    renderError(err instanceof Error ? err.message : '解析失败，请重试');
  }
}

async function requestBg(req: BgRequest): Promise<DownloadResponse | { ok: false; error: string }> {
  try {
    return (await chrome.runtime.sendMessage(req)) as DownloadResponse;
  } catch {
    return { ok: false, error: '与后台服务通信失败，请重试' };
  }
}

// ---- mux 进度状态 ----

let muxJobId: string | null = null;
let muxPercent = 0;
let muxLabel: string | null = null;
let muxOptionId: string | null = null;
/** 已发出取消请求、等待后台确认的中间态（此间禁止开始新任务） */
let muxCancelling = false;
let activeMuxItem: HTMLButtonElement | null = null;
/** 最近一次渲染的解析结果：取消后用它重建菜单，把条目文案恢复原样 */
let lastRendered: MediaCollection | null = null;
let cancelGuard = 0;

function muxMainText(label: string): string {
  if (!muxJobId) return label;
  if (muxCancelling) return `${label} · 取消中…`;
  return `${label} · 合并中 ${muxPercent}%`;
}

function muxSubText(): string {
  return muxCancelling ? '正在中断并清理临时文件' : '点击取消下载';
}

/** 菜单重建（开关菜单会重绘条目）后，把进行中的任务状态重新挂回对应条目 */
function restoreMuxState(): void {
  if (!muxJobId || !muxLabel || !muxOptionId) return;
  activeMuxItem = null;
  const item = menu.querySelector<HTMLButtonElement>(`.vd-item[data-option-id="${CSS.escape(muxOptionId)}"]`);
  if (item) setMuxItem(item, muxLabel);
}

function setMuxItem(item: HTMLButtonElement, label: string): void {
  activeMuxItem = item;
  item.classList.add('vd-active');
  const main = item.querySelector('.vd-main');
  if (main) main.textContent = muxMainText(label);
  // 副标题直接说明「再点一次即取消」，无需额外按钮
  let sub = item.querySelector('.vd-sub');
  if (!sub) {
    sub = document.createElement('div');
    sub.className = 'vd-sub';
    item.append(sub);
  }
  sub.textContent = muxSubText();
  item.classList.toggle('vd-cancelling', muxCancelling);
  menu.classList.add('vd-busy');
}

function updateMuxItem(): void {
  if (activeMuxItem?.isConnected) setMuxItem(activeMuxItem, activeMuxItem.dataset.label ?? muxLabel ?? '');
}

function resetMuxState(): void {
  muxJobId = null;
  muxPercent = 0;
  muxLabel = null;
  muxOptionId = null;
  muxCancelling = false;
  activeMuxItem = null;
  menu.classList.remove('vd-busy');
}

/** 取消后把菜单恢复成全部可选（条目文案在下载期间被改写过，必须整体重绘） */
function restoreMenuAfterCancel(): void {
  resetMuxState();
  if (lastRendered) renderParsed(lastRendered);
}

function onMuxClientMessage(msg: MuxClientMessage): void {
  if (!msg || typeof msg.jobId !== 'string' || msg.jobId !== muxJobId) return;
  if (msg.type === 'muxProgress') {
    // 取消已发出：不再让迟到的进度覆盖「取消中」提示
    if (muxCancelling) return;
    muxPercent = msg.percent;
    // 条目可能因菜单重绘而失效：先尝试重新挂回，再刷新百分比
    if (!activeMuxItem?.isConnected) restoreMuxState();
    const main = activeMuxItem?.isConnected ? activeMuxItem.querySelector('.vd-main') : null;
    if (main && activeMuxItem) main.textContent = muxMainText(activeMuxItem.dataset.label ?? '');
  } else if (msg.type === 'muxComplete') {
    resetMuxState();
    hideAll();
  } else if (msg.type === 'muxFailed') {
    const error = msg.error;
    resetMuxState();
    renderError(error);
  } else if (msg.type === 'muxCancelled') {
    restoreMenuAfterCancel();
  }
}

async function cancelMux(): Promise<void> {
  const jobId = muxJobId;
  if (!jobId || muxCancelling) return;
  // 先给即时反馈（后台中断与清理是异步的），再发取消请求
  muxCancelling = true;
  updateMuxItem();
  // 兜底：后台失联（SW 重启丢了会话状态）时也要把 UI 恢复可用
  clearTimeout(cancelGuard);
  cancelGuard = window.setTimeout(() => {
    if (muxCancelling) restoreMenuAfterCancel();
  }, 5000);
  await requestBg({ type: 'muxCancel', jobId });
}

async function startDownload(variant: DownloadOption, item: HTMLButtonElement): Promise<void> {
  if (variant.download.mode === 'mux' && muxJobId) {
    if (item === activeMuxItem) void cancelMux();
    return;
  }
  item.disabled = true;
  const res = await requestBg(variant.download);
  item.disabled = false;
  if (!res.ok) {
    renderError(res.error || '下载失败，请重试');
    return;
  }
  if (variant.download.mode === 'mux') {
    muxJobId = res.jobId ?? null;
    muxPercent = 0;
    muxLabel = variant.label;
    muxOptionId = variant.id;
    setMuxItem(item, variant.label);
  } else {
    hideAll();
  }
}

function onDocPointerDown(e: PointerEvent): void {
  // 触屏没有 hover：轻点画面即视为悬停，顺带记录坐标
  onPointerMove(e);
  const target = e.target;
  if (target instanceof Node && (host.contains(target) || (target === host as Node))) return;
  if (!menu.hidden) closeMenu();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !menu.hidden) {
    closeMenu();
    e.stopPropagation();
  }
}

function attachHost(): void {
  document.documentElement.append(host);
}

// 全屏（top layer）会遮住页面级元素：把宿主搬进全屏元素内部即可继续显示
function onFullscreenChange(): void {
  try {
    const fsEl = document.fullscreenElement;
    if (fsEl) {
      if (!fsEl.contains(host)) fsEl.append(host);
    } else if (host.parentElement !== document.documentElement) {
      attachHost();
    }
  } catch {
    // 忽略
  }
}

// 页面脚本可能移除我们的宿主节点，被移除时自动重挂。
// 全屏状态下宿主被搬进了全屏元素（isConnected 仍为 true），不会与 observer 打架。
const rehostObserver = new MutationObserver(() => {
  if (host && !host.isConnected) {
    attachHost();
    hardenHostStyle();
  }
});

// 广告拦截器会用装饰性 CSS 规则隐藏命中 id 的元素。对策：随机 id + 内联 !important。
function hardenHostStyle(): void {
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('visibility', 'visible', 'important');
  host.style.setProperty('opacity', '1', 'important');
}

function mountOverlay(selectedPlatform: Platform): void {
  platform = selectedPlatform;
  try {
    host = document.createElement('div');
    host.id = `ytd${Math.random().toString(36).slice(2, 10)}`;
    host.dataset.videodown = 'host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    hardenHostStyle();
    let shadow: ShadowRoot;
    try {
      shadow = host.attachShadow({ mode: 'closed' });
    } catch {
      shadow = host.attachShadow({ mode: 'open' });
    }
    const style = document.createElement('style');
    style.textContent = styles;
    btn = createIconButton();
    btn.addEventListener('click', () => void openMenu());
    menu = document.createElement('div');
    menu.className = 'vd-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    shadow.append(style, btn, menu);
    attachHost();
    rehostObserver.observe(document.documentElement, { childList: true });

    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    // 注意：pointerleave 不冒泡但仍走捕获阶段，这里绝不能加 capture，
    // 否则页面内任何元素的 leave 都会被误判成「指针离开文档」。
    document.addEventListener('pointerleave', onPointerOut);
    window.addEventListener('blur', onPointerOut);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((msg: MuxClientMessage) => {
        onMuxClientMessage(msg);
        return undefined;
      });
    }


    startRaf();
    console.info('[VideoDown] content script 已注入，视频悬浮下载已启用');
  } catch (err) {
    console.error('[VideoDown] 初始化失败：', err);
  }
}

export { mountOverlay };
