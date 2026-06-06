// ============================================================================
// Per-protocol extras helpers
// 在 inbound 时把已知字段剥离，剩余未识别字段塞进对应协议桶
// 在 outbound 时按目标协议把桶 spread 回对象
// ============================================================================
import type { ProtocolExtras } from "../../canonical/types";

/** 把 obj 中 knownKeys 之外的字段剥出来，组成对应协议的 extras 桶 */
export function splitKnownAndExtras<T extends Record<string, unknown>>(
  obj: T,
  knownKeys: ReadonlySet<keyof T>,
  protocol: keyof ProtocolExtras,
): { known: T; extras: ProtocolExtras } {
  const known = {} as T;
  const extrasBag: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (knownKeys.has(k as keyof T)) {
      (known as Record<string, unknown>)[k] = v;
    } else {
      extrasBag[k] = v;
    }
  }
  const extras: ProtocolExtras = {};
  if (Object.keys(extrasBag).length > 0) {
    extras[protocol] = extrasBag;
  }
  return { known, extras };
}

/** 把 extras 中目标协议桶的字段 spread 进 target；防御性：target 已知字段优先 */
export function mergeExtras<T extends Record<string, unknown>>(
  target: T,
  extras: ProtocolExtras | undefined,
  protocol: keyof ProtocolExtras,
): T {
  if (!extras?.[protocol]) return target;
  return { ...target, ...extras[protocol] } as T;
}
