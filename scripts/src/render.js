// 渲染：把工作流产物 → Hugo markdown，严格对齐现有 daily-brief schema。
// 现有 schema 见 content/news/2025-07-03-daily-brief.md：
//   frontmatter: title / date / description / tags / tldr(数组)
//   正文: ## {category} + 无序列表
// layouts/single.html 用 .Params.tldr 渲染 TL;DR aside，.Content 渲染正文。

/** YAML 安全字符串：含特殊字符则双引号包裹并转义内部引号 */
function yamlStr(s) {
  s = String(s);
  if (/[:#\[\]{}&!*|>'"%@`,"\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** 收集所有已处理条目的 _rawItems（供 state 写 hash，含多源） */
export function collectProcessed(ctx) {
  const out = [];
  for (const items of Object.values(ctx.summarized)) {
    for (const it of items) if (it._rawItems) out.push(...it._rawItems);
  }
  return out;
}

/** 渲染单条正文列表项：标题做成链接 + 摘要 + 来源 */
function renderListItem(it) {
  const sources = it.sources?.length ? `（${it.sources.join('、')}）` : '';
  // 标题整体可点击跳原文，比单独的图标/徽章都干净
  const title = it.link
    ? `[**${it.title}**](${it.link})`
    : `**${it.title}**`;
  return `- ${title}：${it.summary}${sources}`;
}

/**
 * @param {object} ctx
 * @returns {{ path: string, content: string, processed: Array }}
 */
export function render(ctx) {
  const { job, date, summarized, tldr } = ctx;
  const path = job.output.replace('{date}', date.str);

	  const title = `每日晚报：${date.str}`;
	  const description = (job.description || '每日晚报：{date}').replace('{date}', date.str);
  const tags = job.tags || ['时事'];

  // frontmatter
  const fm = [
    '---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  if (tldr.length) {
    fm.push('tldr:');
    for (const t of tldr) fm.push(`  - ${yamlStr(t)}`);
  } else {
    fm.push('tldr: []');
  }
  fm.push('---');

  // 正文：按 categories 顺序输出分节
  const body = [];
  for (const cat of job.categories) {
    const items = summarized[cat] || [];
    body.push(`## ${cat}\n`);
    if (items.length === 0) {
      body.push('- 本日无重大新闻。\n');
    } else {
      for (const it of items) body.push(renderListItem(it));
      body.push(''); // 分节间空行
    }
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(ctx) };
}
