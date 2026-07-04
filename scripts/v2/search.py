#!/usr/bin/env python3
"""ddgs 搜索脚本：供 Node 的 SearchSource 通过 child_process 调用。
用法: python3 search.py --query="港股 恒生 今日" --max=10 [--timelimit=d]
输出: JSON 数组到 stdout，每项 {title, href, body}。失败输出 []。
"""
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", required=True)
    parser.add_argument("--max", type=int, default=10)
    parser.add_argument("--timelimit", default="d")  # d=一天 w=一周 m=一月
    args = parser.parse_args()

    try:
        from ddgs import DDGS
        ddgs = DDGS()
        results = ddgs.text(args.query, timelimit=args.timelimit, max_results=args.max)
        # 标准化字段名：ddgs text 返回 title/href/body
        out = [
            {"title": r.get("title", ""), "href": r.get("href", ""), "body": r.get("body", "")}
            for r in results
        ]
        json.dump(out, sys.stdout, ensure_ascii=False)
    except Exception as e:
        # 失败不阻塞 pipeline，输出空数组
        json.dump([], sys.stdout, ensure_ascii=False)
        print(f"\n[ddgs] {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
