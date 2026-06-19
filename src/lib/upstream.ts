// =============================================================================
// 上游 fetch 工具
//
// 统一负责：
//   1. 超时（默认 5s，AbortSignal.timeout）
//   2. 默认带 Referer / User-Agent（部分国内财经源没这俩会 403 / 空体）
//   3. GBK 解码（新浪 / 腾讯）
//   4. try/catch 兜底为 null（让调用方决定 502 还是降级）
//
// 用法：
//   const res = await safeFetch(url);                  // 超时 5s
//   const res = await safeFetch(url, {}, 8000);        // 超时 8s
//   const text = await fetchGbkText(url);              // 直接拿 GBK 解码后字符串
// =============================================================================

const DEFAULT_TIMEOUT_MS = 5000;

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 QuantTrade/0.1',
  'Referer': 'https://finance.sina.com.cn/',
};

export async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // AbortSignal.timeout 在 Node 18+/Edge runtime 都已就位
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init.headers ?? {}),
    },
    signal,
  });
}

/**
 * 拉 GBK 编码的文本响应（新浪/腾讯财经多用 GBK）
 */
export async function fetchGbkText(url: string, init?: RequestInit, timeoutMs?: number): Promise<string> {
  const res = await safeFetch(url, init, timeoutMs);
  if (!res.ok) {
    throw new Error(`upstream ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return new TextDecoder('gbk').decode(buf);
}

/**
 * 把任意错误归一为 { error, status } 形式
 * - AbortError / TimeoutError 归 504
 * - 网络错误归 502
 * - 其它归 502 + 原 message
 */
export function toUpstreamError(e: unknown): { error: string; status: number } {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { error: 'upstream timeout', status: 504 };
    }
    return { error: e.message, status: 502 };
  }
  return { error: String(e), status: 502 };
}
