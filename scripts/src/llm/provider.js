// LLM Provider 抽象接口。
// 新增 provider（glm / openai）只需实现这个接口，业务代码不变。
//
// 接口约定：
//   complete({ system, user, responseFormat }) → { content: string, usage: {in,out} }
//   - responseFormat: 'text' | 'json'
//   - content: 当 responseFormat='json' 时，content 是已 JSON.parse 的对象
//   - usage: { inputTokens, outputTokens } 用于成本统计（尽力而为）

export class LLMProvider {
  /** @returns {Promise<{content: string|object, usage: {inputTokens:number, outputTokens:number}}>} */
  async complete(_opts) {
    throw new Error('LLMProvider.complete() 必须由子类实现');
  }
}
