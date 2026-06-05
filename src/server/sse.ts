// ============================================================================
// SSE 工具：把 ReadableStream<Uint8Array> 解析成异步事件迭代器
// 支持跨行 data: 字段（[data: ...\n data: ...] → 拼成一个事件）
// UTF-8 安全
// ============================================================================

export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
}

export async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let dataLines: string[] = [];
  let eventName: string | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);

      if (line === "") {
        // 空行：分发事件
        if (dataLines.length > 0) {
          yield { event: eventName, data: dataLines.join("\n"), id: undefined };
          dataLines = [];
          eventName = undefined;
        }
      } else if (line.startsWith(":")) {
        // 注释行
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("id:")) {
        // 暂不实现
      }
    }
  }

  // 收尾：如果 buffer 还有内容
  if (buffer.length > 0) {
    if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
    if (dataLines.length > 0) {
      yield { event: eventName, data: dataLines.join("\n"), id: undefined };
    }
  }
}

/** 把字符串包成 SSE data 行 */
export function sseDataLine(data: string): string {
  return `data: ${data}\n\n`;
}
