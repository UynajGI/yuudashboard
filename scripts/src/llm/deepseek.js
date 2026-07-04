// DeepSeek provider（OpenAI 兼容 API）。
// base: https://api.deepseek.com  model: deepseek-chat
import { LLMProvider } from './provider.js';

const BASE_URL = 'https://api.deepseek.com';
const TIMEOUT = 90_000;

export class DeepSeekProvider extends LLMProvider {
  constructor({ apiKey, model } = {}) {
    super();
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY;
    this.model = model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    if (!this.apiKey) throw new Error('DEEPSEEK_API_KEY 未设置（见 scripts/.env.example）');
  }

  async complete({ system, user, responseFormat = 'text' }) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      const body = {
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3, // 简报要稳定，压低随机性
        ...(responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      };

      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`DeepSeek HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const usage = {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      };

      let content = text;
      if (responseFormat === 'json') {
        content = safeParseJson(text);
      }

      return { content, usage };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * 单轮对话（OpenAI 兼容），支持 function calling。
   * 返回原始 assistant message（含可能的 tool_calls），不做工具执行。
   * 工具执行循环由 agent.js 的 runAgent 编排。
   * @param {{messages: Array, tools?: Array, toolChoice?: 'auto'|'none'|object}} opts
   * @returns {Promise<{message: object, usage: {inputTokens, outputTokens}}>}
   */
  async chat({ messages, tools, toolChoice = 'auto' }) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT);

    try {
      const body = {
        model: this.model,
        messages,
        temperature: 0.3,
        ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
      };

      const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`DeepSeek chat HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const message = data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
      const usage = {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      };
      return { message, usage };
    } finally {
      clearTimeout(t);
    }
  }
}

/** 容错 JSON 解析：模型偶尔在 JSON 外带多余文本，做一次提取 */
function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    throw new Error(`LLM 返回的 JSON 解析失败：${text.slice(0, 200)}`);
  }
}
