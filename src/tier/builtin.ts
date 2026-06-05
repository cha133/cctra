// 预留：4 个预定义 tier 的元数据（description / 用途说明）
import type { Tier } from "../types";

export const BUILTIN_TIERS: Record<string, Tier> = {
  cctra: { name: "cctra", target: "", description: "默认（中等质量、便宜）" },
  "cctra-pro": { name: "cctra-pro", target: "", description: "深度思考（慢但强）" },
  "cctra-flash": { name: "cctra-flash", target: "", description: "高速（小快灵）" },
  "cctra-vision": { name: "cctra-vision", target: "", description: "多模态" },
};
