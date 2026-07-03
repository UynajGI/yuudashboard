# Yuunagi Dashboard

个人信息聚合看板，整合每日时事简报、全球金融市场数据与前沿科研动态。

## 板块

- **时事** — 每日新闻简报
- **金融** — 全球指数与商品价格
- **科研** — ArXiv 精选论文速递

## 技术

- [Hugo](https://gohugo.io) + [PaperMod](https://github.com/adityatelange/hugo-PaperMod) 主题
- 自定义统一设计系统（`--dash-*` token）
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
  index.html           # 首页三栏面板
  single.html          # 文章详情（覆盖 PaperMod）
  taxonomy.html        # /tags/ 标签云（覆盖 PaperMod）
  _default/
    section.html       # Section Bento 卡片列表
    term.html          # Tag 详情文章卡片列表
```

CSS 在 `assets/css/extended/`，PaperMod 自动打包进 `stylesheet.css`。
