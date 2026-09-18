/**
 * 捕获页面自身的 innertube player 响应（WEB 路径兜底数据源之一）。
 * hook 必须极薄：任何异常都吞掉，绝不能影响页面自身行为。
 */

const captured = new Map<string, unknown>();
const MAX_CAPTURES = 4;

function remember(pr: unknown): void {
  try {
    const det = (pr as { videoDetails?: { videoId?: unknown } })?.videoDetails;
    const videoId = det?.videoId;
    const sd = (pr as { streamingData?: unknown })?.streamingData;
    if (typeof videoId === 'string' && videoId && sd) {
      captured.delete(videoId);
      captured.set(videoId, pr);
      while (captured.size > MAX_CAPTURES) {
        const oldest = captured.keys().next().value;
        if (oldest === undefined) break;
        captured.delete(oldest);
      }
    }
  } catch {
    // 非 player 响应或异常结构，忽略
  }
}

export function installCapture(): void {
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (this: unknown, ...args: Parameters<typeof origFetch>) {
        const res = origFetch.apply(this, args);
        try {
          const input = args[0];
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request)?.url ?? '';
          if (url.includes('/youtubei/v1/player')) {
            void res
              .then((r) => {
                try {
                  void r
                    .clone()
                    .json()
                    .then(remember)
                    .catch(() => undefined);
                } catch {
                  // 忽略
                }
              })
              .catch(() => undefined);
          }
        } catch {
          // 忽略
        }
        return res;
      };
    }
  } catch {
    // 忽略
  }

  try {
    const proto = XMLHttpRequest.prototype as unknown as {
      open: (...args: unknown[]) => unknown;
    };
    const origOpen = proto.open;
    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const url = String(args[1] ?? '');
        if (url.includes('/youtubei/v1/player')) {
          this.addEventListener('load', () => {
            try {
              remember(JSON.parse(this.responseText));
            } catch {
              // 忽略
            }
          });
        }
      } catch {
        // 忽略
      }
      return origOpen.apply(this, args);
    };
  } catch {
    // 忽略
  }
}

export function getCaptured(videoId: string): unknown | null {
  return captured.get(videoId) ?? null;
}

/** 读页面内联的 window.ytInitialPlayerResponse（仅 videoId 匹配时有效） */
export function readGlobalPlayerResponse(videoId: string): unknown | null {
  try {
    const pr = (window as unknown as { ytInitialPlayerResponse?: { videoDetails?: { videoId?: unknown } } })
      .ytInitialPlayerResponse;
    if (pr?.videoDetails?.videoId === videoId && (pr as { streamingData?: unknown }).streamingData) return pr;
  } catch {
    // 忽略
  }
  return null;
}
