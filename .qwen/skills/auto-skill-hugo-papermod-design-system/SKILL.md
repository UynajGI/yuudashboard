---
name: hugo-papermod-design-system
description: Hugo PaperMod 模板覆盖优先级与统一 CSS 设计系统架构 — 解决根级模板覆盖失效、CSS token 冲突、暗色模式兼容三大问题，含首页侧栏+全文流布局
source: auto-skill
extracted_at: '2026-07-03T16:41:29.000Z'
---

# Hugo PaperMod 统一设计系统

在 PaperMod 主题上构建自定义视觉系统时，会遇到三个典型问题。这套方案经过实测验证。**更新于 2026-07-03**。

## 问题 0：`uglyurls = true` 下的链接生成

当设置 `uglyurls = true` 时，路径以 `.html` 结尾（如 `/news/index.html`），`relLangURL "/news/"` 会错误生成 `/news/` 导致 404。

### 规则

```go-html-template
{{- /* 获取 page 对象，用 RelPermalink */}}
{{- $newsPage := site.GetPage "news" }}
<a href="{{ $newsPage.RelPermalink }}">时事</a>

{{- /* 首页 */}}
<a href="{{ site.Home.RelPermalink }}">首页</a>

{{- /* 任意 page 对象（包括 about.md） */}}
<a href="{{ (site.GetPage "about.md").RelPermalink }}">关于</a>

{{- /* ❌ 错误：relLangURL/absLangURL 在 uglyurls 下丢 /yuudashboard/ 路径 */}}
<a href="{{ "/news/" | relLangURL }}">时事</a>
<a href="{{ "/about.html" | absLangURL }}">关于</a>
```

`relLangURL` 会按 baseURL 重新拼接路径，但在 uglyurls 模式下 `.GetPage.RelPermalink` 自动加 `.html` 后缀，更可靠。

## 问题 1：模板覆盖不生效

PaperMod 有根级 `layouts/single.html`、`layouts/taxonomy.html`，**优先级高于** `layouts/_default/single.html`。

### 规则

```
# 检查 PaperMod 是否有根级同名模板
ls themes/hugo-PaperMod/layouts/single.html  # 存在 → 必须放 layouts/single.html
ls themes/hugo-PaperMod/layouts/list.html     # 不存在→可以放 layouts/_default/list.html
```

| 模板 | PaperMod 根级？ | 项目应放位置 |
|------|----------------|-------------|
| single | 有 (`layouts/single.html`) | `layouts/single.html` |
| taxonomy | 有 (`layouts/taxonomy.html`) | `layouts/taxonomy.html` |
| list | 无 | `layouts/_default/list.html` 或 `section.html` |
| term | 无 | `layouts/_default/term.html` |
| index | 无关 | `layouts/index.html` |

**Why:** PaperMod 的根级 `single.html` / `taxonomy.html` 被 Hugo 优先匹配，`_default/` 下的同名文件会被忽略。

## 问题 2：CSS token 冲突

三个 CSS 文件分别定义自己的变量（`--apple-bg`, `--apple-card`, `--apple-section-max`），导致页面风格不一致。

### 解决方案：单一 token 源

**dashboard.css** 定义所有设计 token：

```css
:root {
  --dash-max: 1180px;
  --dash-gap: 28px;
  --dash-radius: 20px;
  --dash-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --accent-blue: #4facfe;
}
```

**apple-single.css** 只写布局，不复定义 token：

```css
.apple-layout {
  width: min(var(--dash-max), calc(100% - 48px));
  margin: 16px auto 64px;
}
```

**apple-section.css** 同理：

```css
.apple-card-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--dash-gap);
}
```

所有文件通过 `assets/css/extended/` 目录被 PaperMod 自动合并打包。

## 问题 3：暗色模式不响应 PaperMod 手动切换

PaperMod 用 `data-theme="dark"` 属性（不是 `prefers-color-scheme` 媒体查询）。只写 `@media (prefers-color-scheme: dark)` 会导致手动切换主题按钮失效。

### 解决方案：双覆盖

```css
/* 系统偏好（备选） */
@media (prefers-color-scheme: dark) { ... }

/* PaperMod 手动切换（必须加） */
html[data-theme="dark"] {
  --apple-bg: #000000;
}
html[data-theme="dark"] .apple-card,
html[data-theme="dark"] .apple-tldr {
  box-shadow: 0 1px 3px rgba(0,0,0,.15);
}
```

## Token 参考

```
--dash-max: 1180px        主页面最大宽度
--dash-gap: 28px          卡片间距
--dash-radius: 20px       卡片圆角
--dash-radius-lg: 28px    大圆角
--dash-shadow: ...        默认阴影（浅）
--dash-shadow-hover: ...  hover 阴影（深）
--dash-ease: cubic-bezier(0.16, 1, 0.3, 1)  缓动函数
```

## Panel 通用结构

所有卡片统一：

```css
.panel, .apple-card, .apple-tldr, .apple-content-shell {
  position: relative;
  background: var(--entry);
  border-radius: var(--dash-radius);
  overflow: hidden;
  border: 1px solid var(--border);
  animation: panel-rise 0.6s var(--dash-ease) both;
  transition: transform 0.35s var(--dash-ease), box-shadow 0.35s var(--dash-ease);
}

/* 顶部 3px 渐变条 */
.panel::before, .apple-card::before, .home-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
}

/* Hover 统一 */
.panel:hover, .apple-card:hover, .home-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--dash-shadow-hover);
}
```

## 全站统一导航：左侧 sidebar partial

所有页面共享同一套左侧 sticky 导航。提取为 `layouts/partials/sidebar.html`：

```go-html-template
<aside class="home-sidebar">
  <nav class="home-nav">
    <a href="{{ site.Home.RelPermalink }}" class="home-nav-item{{ if .IsHome }} active{{ end }}">首页</a>
    {{- $current := .Section }}
    <a href="{{ (site.GetPage "news").RelPermalink }}" class="home-nav-item{{ if eq $current "news" }} active{{ end }}">时事</a>
    <a href="{{ (site.GetPage "finance").RelPermalink }}" class="home-nav-item{{ if eq $current "finance" }} active{{ end }}">金融</a>
    <a href="{{ (site.GetPage "research").RelPermalink }}" class="home-nav-item{{ if eq $current "research" }} active{{ end }}">科研</a>
    <a href="{{ (site.GetPage "tags").RelPermalink }}" class="home-nav-item{{ if eq .Kind "taxonomy" }} active{{ end }}">标签</a>
    <a href="{{ (site.GetPage "about.md").RelPermalink }}" class="home-nav-item{{ if eq .RelPermalink (site.GetPage "about.md").RelPermalink }} active{{ end }}">关于</a>
  </nav>
</aside>
```

在所有页面模板中调用：`{{ partial "sidebar.html" . }}`，配合 `.home-layout` 两栏 grid。

顶部导航通过删除 `hugo.toml` 中的 `[[menu.main]]` 禁用到。

## Turbo 平滑页面切换

引入 `@hotwired/turbo`（Turbo Drive）拦截链接点击，用 AJAX 加载新页面实现无刷新过渡：

```html
<script src="https://cdn.jsdelivr.net/npm/@hotwired/turbo@8/dist/turbo.es2017-umd.min.js"></script>
```

Turbo 自动拦截所有 `<a>` 链接，仅替换 `<body>` 内容，保留 `<head>` 中的 CSS/JS 避免重复加载。配合 Lenis 平滑滚动效果最佳。Turbo 兼容 Lenis——Lenis 在 `DOMContentLoaded` 时初始化，Turbo 每次渲染后触发 `turbo:render` 事件（可在此重新初始化 Lenis）。

## LP Lenis 平滑滚动

```html
<script src="https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1/dist/lenis.min.js"></script>
<script>
document.addEventListener("DOMContentLoaded",function(){
  var lenis=new Lenis({duration:0.6,easing:function(t){return 1-Math.pow(1-t,3)},smoothWheel:true});
  function raf(t){lenis.raf(t);requestAnimationFrame(raf)}
  requestAnimationFrame(raf);
});
</script>
```

参数：`duration: 0.6`（滚动时长，越小越快），`easing` 用三次缓出。需要配合 Turbo 时在 `turbo:render` 事件中重新创建 Lenis 实例。

## 首页布局：左侧悬浮导航 + 右侧全文流

```html
<div class="home-layout">
  <aside class="home-sidebar">   <!-- sticky, top: 96px -->
    <nav class="home-nav">
      <a href="...">首页</a>
      <a href="...">时事</a>
      <a href="...">金融</a>
      <a href="...">科研</a>
      <a href="...">标签</a>
      <a href="...">关于</a>
    </nav>
  </aside>
  <section class="home-feed">
    <article class="home-card">  <!-- 全文展开 {{ .Content }} -->
      ...
    </article>
  </section>
</div>
```

关键实现：

```css
.home-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--dash-gap);
  width: min(var(--dash-max), calc(100% - 48px));
  margin: 32px auto 64px;
  align-items: start;
}
.home-sidebar { position: sticky; top: 96px; }

@media (max-width: 860px) {
  .home-layout { grid-template-columns: 1fr; }
  .home-sidebar { position: static; order: -1; }
  .home-nav { flex-direction: row; flex-wrap: wrap; }
}
```

顶部导航栏通过删除 `hugo.toml` 中的 `[[menu.main]]` 禁用到。

## TL;DR 位置

TL;DR 作为全宽 panel 放在 hero 和正文之间（不是侧栏）：

```html
<section class="apple-hero">...</section>
<section class="apple-layout">
  {{ with .Params.tldr }}
    <aside class="apple-tldr">...</aside>
  {{ end }}
  <article class="apple-content-shell">{{ .Content }}</article>
</section>
```

## 验证命令

```bash
# 确认所有页面 200
for url in "/" "/news/" "/tags/" "/tags/xxx.html" "/article-slug.html"; do
  curl -s -o /dev/null -w '%{http_code}' "http://localhost:1313${url}" && echo " $url"
done

# 确认首页使用新布局（无旧三栏 panel 类名）
curl -s http://localhost:1313/ | grep -c 'home-layout'   # >0
curl -s http://localhost:1313/ | grep -c 'dashboard'      # 0（旧类名已清理）
```

## 简报内容按 Section 差异化卡片化

三种简报（时事/金融/科研）各自有独立的内容卡片样式。通过 `post-apple-{section}` 类名区分。

### 原理

`single.html` 生成 `<main class="post-apple post-apple-{{ .Section }}">`，CSS 用该 class 差异化渲染 h2/ul/table。首页 `index.html` 为 `home-card-body` 也加上 `post-apple-{{ .Section }}` 类，使首页与详情页样式一致。

### 时事卡片：h2 红标题栏 + 编号圆圈

```css
.post-apple-news .apple-content h2,
.home-card-body.post-apple-news h2 {
  padding: 14px 18px;
  border-radius: var(--dash-radius) var(--dash-radius) 0 0;
  background: rgba(238,90,36,.08);
}
.post-apple-news .apple-content ul,
.home-card-body.post-apple-news ul {
  padding: 12px 18px 14px;
  background: var(--entry);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--dash-radius) var(--dash-radius);
  counter-reset: news-item;
}
.post-apple-news .apple-content li::before,
.home-card-body.post-apple-news li::before {
  content: counter(news-item);
  counter-increment: news-item;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: rgba(238,90,36,.12);
  color: var(--accent-news);
}
```

### 金融卡片：绿标题栏 + 数据表格

```css
.post-apple-finance .apple-content h2,
.home-card-body.post-apple-finance h2 {
  border-radius: var(--dash-radius) var(--dash-radius) 0 0;
  background: rgba(32,191,107,.08);
}
.post-apple-finance .apple-content table,
.home-card-body.post-apple-finance table {
  width: 100%;
  background: var(--entry);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--dash-radius) var(--dash-radius);
}
.post-apple-finance .apple-content .up  { color: var(--accent-finance); }
.post-apple-finance .apple-content .down{ color: #e53935; }
```

### 科研卡片：蓝标题栏 + 论文条目

```css
.post-apple-research .apple-content h2,
.home-card-body.post-apple-research h2 {
  border-radius: var(--dash-radius) var(--dash-radius) 0 0;
  background: rgba(79,172,254,.08);
}
.post-apple-research .apple-content li strong,
.home-card-body.post-apple-research li strong { display: block; }
```

### 卡片填满 panel 全宽

h2 / table / ul 用负 margin 延伸至 panel 边缘：

```css
.post-apple-finance .apple-content h2,
.post-apple-finance .apple-content table,
.post-apple-finance .apple-content ul,
.post-apple-news .apple-content h2,
.post-apple-news .apple-content ul,
.post-apple-research .apple-content h2,
.post-apple-research .apple-content ul {
  margin-left: -28px;
  margin-right: -28px;
}
```

其中 `28px` 是 `.apple-content-shell` 和 `.home-card` 的 `padding` 值。

### 金融简报骨架

每份金融简报包含 4 个固定栏目：

```
## 指数              → 表格卡片
## 商品              → 表格卡片
## 金融要闻          → 条目卡片
## BTC 日内走势      → chart.xkcd 图表 + <script>
```

### 科研简报骨架

```
## 人工智能           → 论文卡片
## 系统与网络         → 论文卡片
## 数学与理论         → 论文卡片
```

## 第三方库集成

通过 `layouts/partials/extend_head.html` 加载，完整内容：

```go-html-template
{{- /* 自定义 SCSS 编译并注入 */ -}}
{{- $custom_scss := resources.Get "_custom.scss" }}
{{- if $custom_scss }}
  {{- $custom_css := $custom_scss | css.Sass | resources.Minify | resources.Fingerprint }}
  <link crossorigin="anonymous" href="{{ $custom_css.RelPermalink }}" integrity="{{ $custom_css.Data.Integrity }}" rel="stylesheet">
{{- end }}
<script src="https://cdn.jsdelivr.net/npm/chart.xkcd@1/dist/chart.xkcd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1/dist/lenis.min.js"></script>
<link href="https://cdn.jsdelivr.net/npm/gridjs/dist/theme/mermaid.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/gridjs/dist/gridjs.umd.js"></script>
<script>
document.addEventListener("DOMContentLoaded",function(){
  var lenis=new Lenis({duration:0.6,easing:function(t){return 1-Math.pow(1-t,3)},smoothWheel:true});
  function raf(t){lenis.raf(t);requestAnimationFrame(raf)}
  requestAnimationFrame(raf);
});
</script>
```

### chart.xkcd 在 markdown 中的用法

在文章内容中直接嵌入 SVG + script：

```html
<svg class="xkcd-chart" id="my-chart" style="width:100%;max-width:600px;display:block;margin:0 auto"></svg>
<script>
(function(){
  var c=document.getElementById("my-chart");
  if(!c||!window.chartXkcd)return;
  new chartXkcd.Line(c,{
    title:"标题", xLabel:"x轴", yLabel:"y轴",
    data:{labels:["1","2","3"], datasets:[{label:"系列", data:[1,2,3]}]},
    options:{yTickCount:4, dotSize:.6, dataColors:["#20bf6b"]}
  });
})();
</script>
```

支持 `chartXkcd.Line` / `chartXkcd.Bar` / `chartXkcd.Pie` / `chartXkcd.Radar` 四种类型。

### Grid.js 在 markdown 中的用法

```html
<div id="my-grid"></div>
<script>
setTimeout(function(){
  if(typeof gridjs==="undefined") return;
  new gridjs.Grid({
    columns:["名称","值","涨幅"],
    data:[["A",100,"+1%"],["B",200,"-2%"]],
    sort:true,
    pagination:true
  }).render(document.getElementById("my-grid"));
}, 500);
</script>
```
注：Grid.js 需要通过 `setTimeout` 确保 DOM 加载完成。
```

## 常见 CSS 冲突排查方法论

遇到布局 bug（表格不撑满、元素太贴边、hover 不生效等）时，**不要靠肉眼调 CSS**。按以下步骤定位根因：

### 步骤

1. **定位渲染源** — 找出渲染该元素的 Hugo 模板（grep 内容关键字定位 content，再找对应 layout）
2. **查主题 CSS reset** — PaperMod `themes/hugo-PaperMod/assets/css/core/reset.css` 包含大量全局 `display` 覆盖
3. **查主题内容 CSS** — `themes/hugo-PaperMod/assets/css/common/md-content.css` 控制文章正文样式
4. **查自定义 CSS** — `assets/css/extended/` 下的覆盖文件
5. **确定具体 CSS 选择器和优先级** — 用浏览器 DevTools 或 `rg` 搜索类名

### 完整的追查例子：表格不撑满 panel 宽度

用户报告说"金融的表格在 card 里只占左边一小条，右边大片空白"。

**第一步：定位渲染源**

```bash
# 查找哪个内容文件有"上证综指"数据
rg "上证综指" content/
# → content/finance/2025-07-03-market.md

# 这个内容在哪些模板被渲染？
# 首页：layouts/index.html → {{ .Content }}
# 详情页：layouts/single.html → {{ .Content }}
```

**第二步：查 PaperMod CSS cascade**

PaperMod 三层 CSS 层层叠加，理解这个链路是关键：

```
reset.css (全局 reset)
    ↓ 被所有页面继承
md-content.css (文章正文)
    ↓ 作用域: .md-content table
extended/*.css (自定义)
    ↓ 通过 specificity 覆盖
```

**第三步：定位罪魁祸首**

```bash
# 逐层查 table 的 display 属性
rg "table\s*{" themes/hugo-PaperMod/assets/css/core/reset.css
# → reset.css:45 table { display: block; }
# → reset.css:82 table { width: 100%; border-collapse: collapse; ... }

# 查 md-content
rg "table" themes/hugo-PaperMod/assets/css/common/md-content.css
# → 只有边框/内边距样式，没有 display 覆盖

# 查自定义 CSS
rg "display.*table|table-layout" assets/css/extended/
```

**第四步：根因分析**

PaperMod `reset.css` 第 45 行 `table { display: block; }` 是所有 table 问题的根本原因。当 table 被设为 `display: block` 时：

- `table-layout: fixed` → 不生效（只对 `display: table` 有效）
- `border-collapse: collapse` → 不生效
- `width: 100%` → 实际按内容宽度收缩
- `thead/tr/th/td` 的行为 → 被破坏

自定义 CSS 中写的 `table-layout: fixed`、`width: 100%` 全部静默失效，表格按内容 width 收缩，右侧留空。

**第五步：修复 — 指定 selectors 加 `display: table`**

不是所有地方都需要改，找到**实际作用在这张表上的最具体选择器**，只在那儿加：

```css
/* 金融 section 的表格：详情页 + 首页卡片 */
.post-apple-finance .apple-content table,
.home-card-body.post-apple-finance table {
  display: table;               /* ← 覆盖 reset 的 display: block */
  width: 100%;
  min-width: 520px;
  table-layout: fixed;
  border-collapse: collapse;
  /* ... 其他样式保持 */
}

/* 通用文章表格（非金融 section 的 table） */
.apple-content table {
  display: table;               /* ← 同样需要覆盖 */
  width: 100%;
  border-collapse: collapse;
}

/* 首页通用卡片 table */
.home-card-body table {
  display: table;
  width: 100%;
  border-collapse: collapse;
}
```

关键是 `display: table` 要跟具体的 table 选择器写在一起，让 specificity 够高覆盖 reset。

### 已知 PaperMod CSS 陷阱

#### 1. `table { display: block; }`（reset.css 第 45 行）

PaperMod 为了移动端表格滚动，全局设置了：

```css
table { display: block; }
```

这导致所有表格失去 table layout 行为：`table-layout: fixed`、`border-collapse: collapse`、`width: 100%` 全部无效，表格只收缩到内容宽度。

**【注意】** `overflow-x: auto`（reset.css 第 86 行）和 `display: block` 共同作用，表格收缩更严重。正确做法：让 table 保持 `display: table`，在外面包 wrapper 做 overflow-x。

**修复**：在具体作用到的选择器中加 `display: table` 覆盖：

```css
.panel table, .apple-content table, .dashboard-table {
  display: table;               /* ← 必须！覆盖 reset */
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
}
```

**不要加 `!important`**，用 specificity 覆盖更干净。

#### 2. reset.css 全量覆盖

`reset.css` 还对 `h1-h6`, `ul`, `a`, `p`, `figure` 等做了全局 reset。自定义样式必须显式覆盖，不能假设某些属性（如 `display`）是初始值。

#### 3. 浏览器 DevTools 在 `display: block` 上的误导

当你在 DevTools 中选中 table 元素，看到 `width: 100%` 和 `table-layout: fixed` 都在，但表格仍然收缩时——**检查 `display` 属性**。如果 display 不是 `table`，前面两个属性全部无用。这是最常见的 PaperMod table bug 误诊原因。

### 排查命令

```bash
# 搜索内容（找出哪些文件包含特定文本）
rg "上证综指|WTI|金融要闻|指数" content/

# 搜索渲染模板中的类名（跟踪 CSS 链路）
rg "apple-content|post-apple|home-card" layouts/

# 搜索 CSS display 规则（找冲突）
rg "display:\s*(block|inline|table|flex)" assets/css/extended/ themes/hugo-PaperMod/assets/css/

# 搜索全局 table 规则（找根源）
rg "table\s*{" themes/hugo-PaperMod/assets/css/core/reset.css

# 追踪完整的 CSS cascade（从 reset → md-content → extended 逐层看 table 规则）
for f in themes/hugo-PaperMod/assets/css/core/reset.css themes/hugo-PaperMod/assets/css/common/md-content.css assets/css/extended/*.css; do
  echo "=== $f ==="
  rg -n "table" "$f"
done
```

