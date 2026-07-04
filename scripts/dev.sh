#!/usr/bin/env bash
# 开发阶段工具脚本
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

case "${1:-help}" in
  reset)
    echo "🗑  清空全部报告 + 重置去重..."
    rm -f content/news/2026-07*.md content/finance/2026-07*.md 2>/dev/null || true
    echo '{"_meta":{},"urls":{},"titles":{}}' > data/seen-news.json
    echo '{"_meta":{},"urls":{},"titles":{}}' > data/seen-finance.json
    echo '{"_meta":{},"jobs":{}}' > data/recent-events-news.json
    echo '{"_meta":{},"jobs":{}}' > data/recent-events-finance.json
    rm -f data/*.local.json 2>/dev/null || true
    echo "✓ 已清空"
    ;;

  news)
    echo "📰 本地跑时事（dry-run）..."
    cd scripts
    for job in daily-news-domestic daily-news-world daily-news-tech daily-news-engineering; do
      echo "--- $job ---"
      node v2/index.js --job="$job" --dry-run 2>&1 | tail -5
    done
    ;;

  finance)
    echo "📈 本地跑金融（dry-run）..."
    cd scripts
    for job in daily-finance-ashare daily-finance-hk daily-finance-asia daily-finance-us daily-finance-commodity daily-finance-crypto; do
      echo "--- $job ---"
      node v2/index.js --job="$job" --dry-run 2>&1 | tail -5
    done
    ;;

  ga)
    echo "🚀 触发 GA 全量（news + finance 并行 → publish）..."
    gh workflow run generate.yml --ref main
    ;;

  status)
    echo "📋 GA 最近运行..."
    gh run list --limit=8
    ;;

  deploy)
    echo "🌐 触发 deploy..."
    gh workflow run deploy.yml --ref main
    ;;

  help|*)
    cat <<EOF
用法: bash scripts/dev.sh <命令>

  reset     清空报告 + 重置去重（4 个 state 文件）
  news      本地 dry-run 时事
  finance   本地 dry-run 金融
  ga        触发 GA 全量（artifact 模式，news+finance 并行 → publish 一次 push）
  status    查看 GA 运行状态
  deploy    手动触发 deploy
EOF
    ;;
esac
