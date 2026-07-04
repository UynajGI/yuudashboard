# Yuunagi Dashboard

个人信息聚合看板，整合每日时事简报、全球金融市场数据与前沿科研动态。

## 板块

- **时事** — 每日新闻简报
- **金融** — 全球指数与商品价格
- **科研** — ArXiv 精选论文速递

## 布局

- **全站左侧 sticky 侧边栏**（首页/时事/金融/科研/标签/关于）
- **首页瀑布流**：所有文章按时间倒序混合排列，全文展开，卡片按类别着色
- **文章详情页**：hero + TL;DR 摘要 + 正文三 panel 纵向排列
- **Section 列表页**：Bento 三列卡片网格
- **标签云 + 标签详情页**

## 技术

- [Hugo](https://gohugo.io) v0.163 + [PaperMod](https://github.com/adityatelange/hugo-PaperMod) 主题
- 统一设计系统（`--dash-*` CSS token），`dashboard.css` 为唯一基准
- [Turbo](https://turbo.hotwired.dev) 平滑页面切换
- [Lenis](https://lenis.studio) 平滑滚动
- [chart.xkcd](https://chart.xkcd.net) 金融图表
- [Grid.js](https://gridjs.io) 数据表格
- GitHub Pages 部署

## 开发

```bash
hugo server          # 开发服务器（http://localhost:1313/yuudashboard/）
hugo --gc --minify   # 构建
```

提交前自动运行 `hugo --gc --minify`（lefthook pre-commit）。

## 模板结构

```
layouts/
  index.html              # 首页：侧边栏 + 瀑布流
  single.html             # 文章详情（根级覆盖 PaperMod）
  taxonomy.html           # /tags/ 标签云（根级覆盖 PaperMod）
  partials/
    sidebar.html          # 全站左侧导航
  _default/
    section.html          # Section Bento 卡片列表
    term.html             # Tag 详情文章卡片
    about.html            # 关于页面
```

CSS 在 `assets/css/extended/`，PaperMod 自动打包：

```
assets/css/extended/
  dashboard.css           # 设计 token + 面板基类 + 首页 + 暗色模式
  apple-single.css        # 文章页特有布局
  apple-section.css       # section/taxonomy/term 卡片网格
```

## 已知陷阱

- **PaperMod `reset.css`** 全局 `table { display: block }` 导致表格不撑满 panel。需在自定义 CSS 中加 `display: table` 覆盖。
- **模板覆盖优先级**：PaperMod 根级模板（`single.html`、`taxonomy.html`）需放在项目 `layouts/` 根级；`_default/` 仅用于 PaperMod 不存在的模板。
