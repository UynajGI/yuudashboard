// Agent 工具：金融新闻查询（v2，基本不变）。

export const getFinanceNewsDef = {
  type: 'function',
  function: {
    name: 'get_finance_news',
    description: '查询当日金融要闻。可按关键词过滤（如 "美元"、"BTC"、"美联储"），不传关键词返回全部。',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '过滤关键词（可选）' },
        limit: { type: 'integer', description: '最多返回几条（默认 8）', default: 8 },
      },
    },
  },
};

export function makeGetFinanceNews(ctx) {
  return ({ keyword, limit = 8 }) => {
    let items = ctx.items?.['要闻'] || [];
    if (keyword) {
      const kw = keyword.toLowerCase();
      items = items.filter((it) => (it.title + ' ' + (it.summary || '')).toLowerCase().includes(kw));
    }
    const out = items.slice(0, limit).map((it) => ({ title: it.title, source: it.source, summary: it.summary?.slice(0, 120) }));
    return { keyword: keyword || null, total: items.length, returned: out.length, items: out };
  };
}
