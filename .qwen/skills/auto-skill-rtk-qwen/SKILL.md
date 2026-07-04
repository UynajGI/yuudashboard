---
name: rtk-qwen
description: Install and configure rtk (command proxy/optimizer) for Qwen Code — PreToolUse auto-rewrite NOT supported, use explicit rtk prefix
source: auto-skill
extracted_at: '2026-07-03T07:23:05.995Z'
---

# rtk 在 Qwen Code 中的安装与配置

## 背景

[rtk](https://github.com/rtk-ai/rtk) 是一个 CLI 命令代理，能自动将冗长的命令输出过滤/压缩为 token 高效的紧凑输出。原本仅原生支持 Claude Code、Gemini CLI、Copilot、Cursor 等工具，**Qwen Code 没有官方支持且 PreToolUse auto-rewrite 不可用**。

## 关键发现

### 1. Qwen Code 不支持 PreToolUse 命令改写（2026-07-03）

通过逆向 Qwen Code v4.24.0 源码确认：

- **文档** 声称 PreToolUse hook 支持 `hookSpecificOutput.updatedInput` 改写工具参数
- **实际代码** `firePreToolUseHook()` 只提取 `shouldProceed`、`additionalContext`、`blockReason`，**完全忽略 `updatedInput`**
- 即使 hook 返回了正确的 `updatedInput`，Qwen Code 也不会应用它

`rtk hook claude` 的输出与 Qwen Code 协议格式天然兼容（工具名 `run_shell_command` 可被正确识别），但 Qwen Code 不处理命令改写。

### 2. 工具名差异

| 工具 | Shell 工具名 |
|------|-------------|
| Claude Code | `Bash` |
| Qwen Code | `run_shell_command` |

### 3. 手动包装脚本尝试

为兼容 `permissionDecision` 字段要求编写了包装脚本 `/home/yuunagi/.local/bin/rtk-qwen-hook.sh`，但最终确定问题不在于 hook 输出格式，而是 Qwen Code 框架未实现 `updatedInput` 功能。

## 实践方案（可行）

### 1. 安装/更新 rtk 二进制

```bash
# Cargo 安装（推荐）
cargo install --git https://github.com/rtk-ai/rtk

# 预编译二进制（更快）
curl -fsSL "https://github.com/rtk-ai/rtk/releases/download/v0.43.0/rtk-x86_64-unknown-linux-musl.tar.gz" \
  -o /tmp/rtk.tar.gz && cd /tmp && tar xzf rtk.tar.gz
cp rtk ~/.cargo/bin/rtk && chmod +x ~/.cargo/bin/rtk
```

### 2. 显式使用 rtk 命令

由于 auto-rewrite 不可用，所有命令**主动添加 `rtk` 前缀**：

| 原始命令 | 改写后 |
|----------|--------|
| `git status` | `rtk git status` |
| `git log -n 10` | `rtk git log -n 10` |
| `git diff` | `rtk git diff` |
| `cargo test` | `rtk test cargo test` |
| `cargo build` | `rtk cargo build` |
| `cat file.rs` | `rtk read file.rs` |
| `ls -la` | `rtk ls .` |
| `grep pattern .` | `rtk grep pattern .` |
| `docker ps` | `rtk docker ps` |
| `kubectl logs pod` | `rtk kubectl logs pod` |

### 3. 验证安装

```bash
rtk --version
echo '{"tool_name":"run_shell_command","tool_input":{"command":"git status"}}' | rtk hook claude
# 应输出: {"hookSpecificOutput":{"updatedInput":{"command":"rtk git status"}}}
```

## 复现记录

以下均已测试但**不工作**（供未来参考）：

1. **直接使用 `rtk hook claude`** — hook 被调用，返回正确的 `updatedInput`，但命令不改变
2. **包装脚本补充 `permissionDecision`** — 同上，Qwen Code 框架不处理
3. **`updatedInput` 同时放在顶层和 `hookSpecificOutput` 内** — 同上
4. **调整 hook 执行顺序** — 在 context-mode 前后均测试过，无影响

**根本原因**：Qwen Code 的 `chunk-6QTCOQX7.js::firePreToolUseHook()` 和 `acpAgent-4F36XM3X.js` 调用方均未处理 `updatedInput`。需 Qwen Code 团队在后续版本实现。

## 配置文件

- rtk: `~/.config/rtk/config.toml`
- Qwen Code: `~/.qwen/settings.json`

## 资源

- rtk 文档: <https://rtk-ai.app/guide>
- rtk GitHub: <https://github.com/rtk-ai/rtk>
