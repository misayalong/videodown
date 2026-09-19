/** 抖音当前播放器 React 属性中的媒体字段；不读取账号或认证字段。 */
export type DouyinAddress = string | { src: string };

export interface DouyinRate {
  width: number;
  height: number;
  fps?: number;
  bitRate?: number;
  dataSize?: number;
  playAddr?: DouyinAddress[];
  isH265?: number | boolean;
  isH266?: number | boolean;
  codecType?: string;
  format?: string;
  videoFormat?: string;
}

export interface DouyinAweme {
  awemeId: string;
  desc?: string;
  itemTitle?: string;
  isSlides?: boolean;
  isAds?: boolean;
  video?: {
    width: number;
    height: number;
    duration: number;
    playAddr?: DouyinAddress[];
    playAddrSize?: number;
    playAddrH265?: DouyinAddress[];
    playAddrH265Size?: number;
    bitRateList?: DouyinRate[];
    bitRateAudioList?: Array<{ urlList?: DouyinAddress[]; size?: number; bitrate?: number }>;
  };
  download?: { url?: string; urlList?: string[]; dataSize?: number };
}
