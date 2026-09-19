export interface BilibiliVideo {
  bvid: string;
  title: string;
  pages: Array<{ cid: number; page: number; part: string; duration: number }>;
}

export interface BilibiliTrack {
  id: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  codecs: string;
  bandwidth: number;
  width?: number;
  height?: number;
}

export interface BilibiliPlay {
  quality: number;
  format?: string;
  timelength?: number;
  support_formats?: Array<{ quality: number; new_description?: string; display_desc?: string }>;
  dash?: { video?: BilibiliTrack[]; audio?: BilibiliTrack[] };
  durl?: Array<{ url: string; backup_url?: string[]; size?: number }>;
}
