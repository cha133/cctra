// ============================================================================
// SSE keepalive：在 inner 流空闲时每 intervalMs 插入 ": keepalive\n\n" 注释行
// 防止中间网络设备（nginx / proxy / CDN）超时断流
// ============================================================================

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * 包装一个 SSE ReadableStream，定期插入 keepalive 注释行
 * 下游 cancel() 会清掉 timer，避免泄漏
 */
export function wrapWithKeepalive(
  inner: ReadableStream<Uint8Array>,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const keepaliveBytes = encoder.encode(": keepalive\n\n");

  let timer: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (cancelled) return;
        try {
          controller.enqueue(keepaliveBytes);
        } catch {
          stopTimer();
        }
      }, intervalMs);

      // 后台 pump：用 for-await 兼容 Bun + web stream 类型
      void (async () => {
        try {
          for await (const chunk of inner as unknown as AsyncIterable<Uint8Array>) {
            if (cancelled) break;
            controller.enqueue(chunk);
          }
        } catch (e) {
          if (!cancelled) controller.error(e);
        } finally {
          stopTimer();
          try { controller.close(); } catch { /* 已关 */ }
        }
      })();
    },
    cancel(reason) {
      cancelled = true;
      stopTimer();
      // 不主动 cancel inner：for-await 已隐式锁了 reader，再 cancel 会报 "ReadableStream is locked"
      // pump 会因为 inner 自然结束（fetch abort / source close）退出，或 controller.enqueue 失败时退出
      void reason;
    },
  });
}
