你现在要改的是一个 Hugo / PaperMod 风格站点的视觉系统，不是单独美化某个页面。

我提供的文件有：

- layouts/index.html
- layouts/_default/single.html
- layouts/_default/section.html
- layouts/_default/terms.html 或 taxonomy.html
- layouts/_default/taxonomy.html 或 term.html
- assets/css/extended/dashboard.css
- assets/css/extended/apple-single.css
- assets/css/extended/apple-section.css

核心要求：

以 dashboard.css 作为唯一视觉基准，统一 single / section / taxonomy / term 四类页面。现在的问题是三个 CSS 像三个不同人写的：single 像窄阅读页，section 像另一种 Apple hero，taxonomy 又像普通卡片页。我要你把它们统一成同一套「Apple dashboard / Bento panel」风格。

不要继续写“苹果风”“玻璃拟态”“大渐变 hero”。我想要的是 dashboard.css 现在这种风格：

- 桌面端是信息看板，不是手机窄页；
- 页面最大宽度统一 1180px；
- 卡片间距统一 28px；
- 面板圆角统一 20px；
- 面板背景统一使用 var(--entry)；
- 页面背景统一使用 var(--theme)；
- 文本颜色统一使用 var(--primary) / var(--secondary)；
- 边框统一使用 var(--border)；
- 所有主面板统一有顶部 3px 渐变条；
- 所有卡片 hover 都是轻微 translateY(-4px) + 阴影增强；
- 所有入场动画统一使用 dashboard.css 里的 panel-rise / item-fade；
- 不要每个 CSS 文件自己重新定义一套 root 变量；
- 不要一个页面用玻璃，一个页面用白卡，一个页面用大渐变；
- 不要电脑端中间 760px 窄栏、两侧大片空白。

最终目标：

首页、section 列表页、文章详情页、标签首页、标签详情页，看起来像同一个产品里的不同页面，而不是三个模板拼起来的。

具体改法：

第一步：建立唯一设计系统

请从 dashboard.css 提取公共设计 token，放到一个统一 CSS 里，或者直接保留在 dashboard.css 顶部：

:root {
  --dash-max: 1180px;
  --dash-gap: 28px;
  --dash-radius: 20px;
  --dash-radius-lg: 28px;
  --dash-panel-bg: var(--entry);
  --dash-page-bg: var(--theme);
  --dash-text: var(--primary);
  --dash-muted: var(--secondary);
  --dash-border: var(--border);
  --dash-shadow:
    0 1px 3px rgba(0,0,0,.04),
    0 8px 32px rgba(0,0,0,.06);
  --dash-shadow-hover:
    0 2px 8px rgba(0,0,0,.06),
    0 16px 48px rgba(0,0,0,.10);
  --dash-ease: cubic-bezier(0.16, 1, 0.3, 1);

  --accent-news: #ee5a24;
  --accent-finance: #20bf6b;
  --accent-research: #4facfe;
  --accent-blue: #4facfe;
  --accent-cyan: #00f2fe;
  --accent-purple: #af52de;
}

然后所有页面都必须复用这套变量。不要在 apple-single.css 和 apple-section.css 里再各自定义一套 --apple-bg、--apple-card、--apple-section-max 等互相冲突的 token。

第二步：统一基础布局

所有页面的顶层容器都应该遵守：

- max-width: var(--dash-max)
- margin: 32px auto 64px
- width: min(var(--dash-max), calc(100% - 48px))
- 手机端才改为 calc(100% - 24px)

也就是说：

.dashboard,
.apple-section-hero,
.apple-section-body,
.apple-layout,
.apple-taxonomy-page .apple-layout,
.apple-term-page .apple-layout {
  width: min(var(--dash-max), calc(100% - 48px));
  margin-left: auto;
  margin-right: auto;
}

第三步：统一 panel 组件

把 dashboard.css 里的 .panel 作为所有卡片的母版。以下这些类都应该视觉上等价于 .panel：

.panel
.apple-section-hero-inner
.apple-section-content
.apple-card
.apple-content-shell
.apple-tldr
.apple-tag-chip
.apple-pagination-link

它们都应该拥有：

- position: relative;
- background: var(--entry);
- border-radius: var(--dash-radius);
- overflow: hidden;
- box-shadow: var(--dash-shadow);
- border: 1px solid rgba(0,0,0,.04) 或 var(--border);
- animation: panel-rise .6s var(--dash-ease) both;
- transition: transform .35s var(--dash-ease), box-shadow .35s var(--dash-ease);

hover 统一：

transform: translateY(-4px);
box-shadow: var(--dash-shadow-hover);

第四步：统一顶部渐变条

所有主卡片都要有 dashboard.css 那种顶部 3px 渐变条。

首页：
.panel-news::before    orange/red
.panel-finance::before green/teal
.panel-research::before blue/cyan

其他页面：
.apple-section-hero-inner::before
.apple-card::before
.apple-content-shell::before
.apple-tldr::before
.apple-tag-chip::before

统一使用：

content: "";
position: absolute;
top: 0;
left: 0;
right: 0;
height: 3px;
background: linear-gradient(90deg, var(--accent-blue), var(--accent-cyan));

不同 section 可以用 data 属性或 class 改 accent，但默认都蓝青，不要各玩各的。

第五步：重构 single.html / apple-single.css

文章详情页不要做 760px 窄文档页。电脑端应该是 dashboard 布局：

- hero 是一个 1180px 宽的大 panel；
- hero 里面左对齐：breadcrumbs / kicker / title / description / meta；
- 正文区域是 1180px 宽的两栏 grid；
- 左侧是正文 panel；
- 右侧是 TL;DR panel；
- TL;DR 不折叠，桌面端 sticky；
- 标签不要 fixed 悬浮，放在正文后面作为 chip row。

single 桌面布局建议：

.apple-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: var(--dash-gap);
  align-items: start;
}

.apple-content {
  grid-column: 1;
}

.apple-tldr {
  grid-column: 2;
  grid-row: 1;
  position: sticky;
  top: 96px;
}

.apple-footer {
  grid-column: 1 / -1;
}

如果当前 HTML 结构不方便，允许改 single.html，把正文和 TL;DR 包成：

<div class="apple-article-grid">
  <article class="apple-content-shell">
    <div class="post-content md-content apple-content">...</div>
  </article>

  {{ with .Params.tldr }}
  <aside class="apple-tldr">...</aside>
  {{ end }}
</div>

注意：TL;DR 要像 dashboard 面板，不要像灰色文档提示框。

第六步：重构 section.html / apple-section.css

section 页必须和首页 dashboard 统一：

- hero 是一个 1180px 宽 panel，不是全屏大海报；
- 文章列表是 bento card grid；
- 默认三列；
- 第一张 featured 可以 span 2 columns，但不要破坏整体一致性；
- 卡片内部结构和首页 panel-list 语言一致：eyebrow / title / desc / meta / arrow；
- 动画统一用 panel-rise，列表项可用 item-fade；
- 不要单独写巨大 radial gradient 背景。

section grid：

.apple-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--dash-gap);
}

.apple-card-featured {
  grid-column: span 2;
  min-height: 280px;
}

@media (max-width: 1080px) {
  .apple-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 720px) {
  .apple-card-grid { grid-template-columns: 1fr; }
  .apple-card-featured { grid-column: auto; }
}

第七步：重构 taxonomy.html / term.html

taxonomy 标签首页和 tag 详情页也必须像 dashboard，不要像单独的 chip 页面。

taxonomy.html：

- hero panel：标题“标签”/描述；
- tag cloud 用 dashboard card/chip grid；
- 每个 tag chip 不是小手机 chip，而是可点击小 panel；
- 桌面端可以 4 列或 auto-fit minmax(180px, 1fr)。

term.html：

- hero panel：Tag / title / count；
- 文章列表复用 section 的 .apple-card-grid 和 .apple-card；
- 不要写另一套 .term-card 或 .card-grid；
- 所有文章卡片都用同一个 .apple-card。

第八步：CSS 文件组织

现在三个 CSS 风格打架。请按这个方式整理：

1. dashboard.css：保留首页 dashboard，同时放公共 token、公共 panel、公共动画。
2. apple-single.css：只写 single 页面特有布局，不重新定义视觉 token。
3. apple-section.css：只写 section / taxonomy / term 页面特有布局，不重新定义视觉 token。

禁止：

- 在 apple-single.css 里重新定义完整 :root 设计系统；
- 在 apple-section.css 里重新定义另一套 --apple-section-* 视觉变量；
- 不同页面使用不同 max-width、radius、shadow、animation、hover 逻辑。

允许：

- 每个页面可以有少量 layout 专属变量，但必须基于 --dash-*。
- 例如 --article-sidebar: 320px 是允许的。
- 但 --apple-bg、--apple-card、--apple-shadow 这类重复视觉系统不允许。

第九步：暗色模式

暗色模式只适配 dashboard 变量，不要每页单独写一套：

[data-theme="dark"] .panel,
[data-theme="dark"] .apple-card,
[data-theme="dark"] .apple-content-shell,
[data-theme="dark"] .apple-tldr,
[data-theme="dark"] .apple-section-hero-inner {
  box-shadow:
    0 1px 3px rgba(0,0,0,.15),
    0 8px 32px rgba(0,0,0,.25);
}

[data-theme="dark"] ...:hover {
  box-shadow:
    0 2px 8px rgba(0,0,0,.2),
    0 16px 48px rgba(0,0,0,.35);
}

不要用 prefers-color-scheme，因为站点主题大概率使用 [data-theme="dark"]。

第十步：验收标准

改完后必须满足：

- 首页 index、section 列表页、single 文章页、taxonomy 标签首页、term 标签详情页，视觉上像同一个设计系统；
- 电脑端没有大面积无意义空白；
- single 文章页桌面端是两栏 dashboard：正文 + TL;DR；
- TL;DR 不折叠，且在桌面端 sticky；
- section 和 term 的文章卡片复用同一套 .apple-card；
- taxonomy 的标签也像 dashboard 小面板，而不是孤立 chip；
- 所有页面动画统一；
- 所有卡片 hover 统一；
- 所有圆角、阴影、间距、宽度统一；
- CSS 中不再出现三套互相冲突的 root token；
- 不要为了“苹果风”加入大面积玻璃、强渐变、强阴影、夸张背景光斑；
- 整体更接近 Apple 官网产品信息面板 + macOS 设置面板 + Bento grid，而不是移动端博客模板。

请直接修改这些文件并输出完整可覆盖版本：

- dashboard.css
- apple-single.css
- apple-section.css
- single.html，如需要调整 TL;DR 布局
- section.html，如需要统一 card 结构
- taxonomy.html
- term.html

不要只给建议。我要可直接覆盖的代码。