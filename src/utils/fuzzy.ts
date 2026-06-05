/**
 * 模糊匹配：大小写不敏感的子串匹配 + token 打分
 * 返回匹配得分，0 表示不匹配
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase().trim();

  if (!q) return 1;
  if (!t) return 0;

  // 完全匹配得分最高
  if (t === q) return 100;

  // 前缀匹配
  if (t.startsWith(q)) return 90;

  // 子串匹配
  if (t.includes(q)) return 70;

  // token 级匹配：query 按空格分词，每个词都要在 target 中出现
  const tokens = q.split(/\s+/);
  if (tokens.length > 1 && tokens.every((token) => t.includes(token))) {
    return 50 + tokens.length * 5;
  }

  // 单 token 子串匹配
  if (tokens.some((token) => token.length >= 2 && t.includes(token))) {
    return 30;
  }

  return 0;
}

/**
 * 在列表中模糊搜索，返回按得分排序的结果
 */
export function fuzzySearch<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): T[] {
  return items
    .map((item) => ({ item, score: fuzzyScore(query, getText(item)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
