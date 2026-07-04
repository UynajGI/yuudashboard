// LLM 工厂：读 LLM_PROVIDER env，返回对应 provider 实例。
// 切换 provider：新建实现文件 + 改 env，业务代码不变。
import { DeepSeekProvider } from './deepseek.js';

const REGISTRY = {
  deepseek: (cfg) => new DeepSeekProvider(cfg),
  // 以后加：
  // glm: (cfg) => new GlmProvider(cfg),
  // openai: (cfg) => new OpenAIProvider(cfg),
};

export function createLLM() {
  const name = (process.env.LLM_PROVIDER || 'deepseek').toLowerCase();
  const factory = REGISTRY[name];
  if (!factory) throw new Error(`未知 LLM_PROVIDER: ${name}（可选：${Object.keys(REGISTRY).join(', ')}）`);
  return factory();
}

export { LLMProvider } from './provider.js';
