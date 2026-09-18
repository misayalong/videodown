import type { MediaCollection } from '../shared/media';

export interface VideoTarget {
  id: string;
  element: HTMLElement;
  rect: DOMRect;
}

/** 页面定位与解析属于平台；菜单、缓存和下载执行属于公共层。 */
export interface Platform {
  id: string;
  matches(hostname: string): boolean;
  minPlayerSize: { width: number; height: number };
  locate(pointer: { x: number; y: number }, current: VideoTarget | null, menuOpen: boolean): VideoTarget | null;
  resolve(targetId: string): Promise<MediaCollection>;
}
