// LLM Provider 抽象接口。
// 新增 provider（glm / openai）只需实现这个接口，业务代码不变。
//
// 接口约定：
//   complete({ system, user, responseFormat }) → { content: string, usage: {in,out} }
//   - responseFormat: 'text' | 'json'
//   - content: 当 responseFormat='json' 时，content 是已 JSON.parse 的对象
//   - usage: { inputTokens, outputTokens } 用于成本统计（尽力而为）
//
//   chat({ messages, tools, maxToolRounds }) → { message, usage }   [可选，agent 用]
//   - messages: OpenAI 格式的完整对话历史
//   - tools: function-calling 工具定义（[{type:'function', function:{...}}]），可选
//   - 返回单轮结果：{ message: assistant 消息对象（含 tool_calls 或 content）, usage }
//   - 注意：chat() 只做一轮，工具执行循环由 agent.js 负责

export class LLMProvider {
  /** @returns {Promise<{content: string|object, usage: {inputTokens:number, outputTokens:number}}>} */
  async complete(_opts) {
    throw new Error('LLMProvider.complete() 必须由子类实现');
  }

  /**
   * 单轮对话（OpenAI 兼容格式），支持 function calling。
   * 工具执行循环不在 provider 内做，由 agent.js 的 runAgent 编排。
   * @returns {Promise<{message: object, usage: {inputTokens, outputTokens}}>}
   *   message: { role:'assistant', content?:string, tool_calls?:[{id, type:'function', function:{name, arguments}}] }
   */
  async chat(_opts) {
    throw new Error('LLMProvider.chat() 未实现（该 provider 不支持 function calling）');
  }
}
