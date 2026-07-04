// 机械去重：纯脚本，0 token。
// 三层去重 + 时间窗过滤，在送 LLM 之前把数据砍干净。

/** 创建一个稳定的短 hash（FNV-1a 32bit，无需 crypto 依赖） */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const urlHash = (url) => hash('u:' + url);
export const titleHash = (title) => hash('t:' + title.toLowerCase().replace(/\s+/g, ''));

/** Jaccard 相似度（基于字符 bigram），用于标题近似去重 */
function titleSimilarity(a, b) {
  const bi = (s) => {
    const set = new Set();
    const t = s.toLowerCase().replace(/\s+/g, '');
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = bi(a), B = bi(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * 多层去重 + 过滤。返回保留的条目（带 urlHash/titleHash 字段）。
 * @param {Array} items         原始条目
 * @param {number} windowMs     时间窗（毫秒），早于 now-windowMs 的丢弃
 * @param {object} seen         { urls:{}, titles:{} } 跨日已发布记录（value=YYYY-MM-DD）
 * @param {string} [today]      今天日期（YYYY-MM-DD，北京时间）。seen 里 == today 的记录
 *                              视为"今天同批次已处理"，跨报告不去重（保留）；
 *                              < today 的才是真正跨天重复，过滤掉。
 *                              不传则全部过滤（旧行为，向后兼容）。
 */
export function dedupe(items, windowMs, seen, today) {
  const cutoff = Date.now() - windowMs;
  const keep = [];
  const seenUrlKeys = new Set();
  const seenTitleKeys = new Set();

  /** seen 记录是否为跨天重复（< today 才过滤；== today 是同报告批次的，保留） */
  const isStaleSeen = (dateStr) => {
    if (!dateStr) return false;
    return today ? dateStr < today : true;
  };

  // 先按日期降序，保证多源同一事件保留最新那条
  const sorted = [...items].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  for (const it of sorted) {
    // 时间窗过滤：无日期的保留（保守），有日期且过旧则丢
    if (it.date && it.date.getTime() < cutoff) continue;
    if (!it.title || it.title.length < 4) continue;

    const uh = urlHash(it.link);
    const th = titleHash(it.title);

    // 第一层：URL 精确去重（跨源转载同一 URL）
    if (uh && isStaleSeen(seen.urls?.[uh])) continue;
    if (seenUrlKeys.has(uh)) continue;
    // 本批次内 URL 去重
    if (uh) seenUrlKeys.add(uh);

    // 第二层：标题精确 hash 去重
    if (isStaleSeen(seen.titles?.[th])) continue;
    if (seenTitleKeys.has(th)) continue;
    seenTitleKeys.add(th);

    // 第三层：标题相似度去重（同事件不同措辞）
    let dup = false;
    for (const k of keep) {
      if (titleSimilarity(it.title, k.title) > 0.7) {
        dup = true;
        // 保留信息更全的（摘要更长的）
        if ((it.summary?.length || 0) > (k.summary?.length || 0)) {
          Object.assign(k, it, { urlHash: uh, titleHash: th });
        }
        break;
      }
    }
    if (!dup) keep.push({ ...it, urlHash: uh, titleHash: th });
  }

  const dropped = items.length - keep.length;
  console.log(`  去重：${items.length} → ${keep.length}（丢弃 ${dropped} 条过旧/重复）`);
  return keep;
}
