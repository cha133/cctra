import type { CanonicalRequest, CanonicalContentBlock } from "../../canonical/types";
import { ensureBlocks, extractText } from "./content-blocks";

/** 把 Canonical 顶级 system 转成字符串（用于 OpenAI Chat 的 messages[0].role=system） */
export function systemToString(system: CanonicalRequest["system"]): string | undefined {
  if (system === undefined) return undefined;
  if (typeof system === "string") return system;
  return extractText(ensureBlocks(system));
}

/** 把字符串 system 转成 Canonical 顶级 system（block 形式） */
export function stringToSystem(s: string | undefined): CanonicalContentBlock[] | undefined {
  if (!s) return undefined;
  return [{ type: "text", text: s }];
}
