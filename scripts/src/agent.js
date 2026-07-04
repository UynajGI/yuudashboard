// Agent loop：给 LLM 一组 tools，让它自主决定调用顺序与次数，循环到产出最终文本。
//
// 这是 function calling 的核心编排，零框架依赖：
//   1. 把 system + user 作为首轮 messages 发给 LLM（附带 tools 定义）
//   2. LLM 返回 tool_calls → 逐个执行对应 handler → 结果以 role:'tool' 塞回 messages
//   3. 再次请求 LLM，它可能继续调工具，或给出最终 content
//   4. 直到模型不再返回 tool_calls（产出最终文本）或达到 maxRounds
//
// 用法：
//   const { content, rounds, usage } = await runAgent({
//     llm,
//     system: '你是金融分析师...',
//     user: '分析今日板块强弱',
//     tools: [getMarketSnapshotTool, getHistorySeriesTool],   // OpenAI function 定义
//     toolHandlers: { get_market_snapshot: (args)=>..., get_history_series: (args)=>... },
//   });

const DEFAULT_MAX_ROUNDS = 6;

/**
 * @param {object} opts
 * @param {object} opts.llm           LLM provider 实例（需实现 chat()）
 * @param {string} opts.system        系统提示
 * @param {string} opts.user          用户首条消息（任务描述）
 * @param {Array}  opts.tools         OpenAI function 定义数组 [{type:'function', function:{name,description,parameters}}]
 * @param {object} opts.toolHandlers  { toolName: (args) => string | object }
 * @param {number} [opts.maxRounds]   最大工具调用轮次（默认 6）
 * @returns {Promise<{content: string, rounds: number, usage: {inputTokens, outputTokens}, trace: Array}>}
 */
export async function runAgent({ llm, system, user, tools = [], toolHandlers = {}, maxRounds = DEFAULT_MAX_ROUNDS }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  let totalUsage = { inputTokens: 0, outputTokens: 0 };
  const trace = []; // [{round, tool, args, resultPreview, ok}]
  let rounds = 0;

  while (rounds <= maxRounds) {
    const { message, usage } = await llm.chat({ messages, tools });
    totalUsage.inputTokens += usage.inputTokens;
    totalUsage.outputTokens += usage.outputTokens;
    messages.push(message);

    // 无 tool_calls → 模型给出最终文本，循环结束
    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      console.log(`    agent 第 ${rounds} 轮：产出最终文本（${message.content?.length || 0} 字符）`);
      return {
        content: message.content || '',
        rounds,
        usage: totalUsage,
        trace,
      };
    }

    // 有 tool_calls → 逐个执行，结果塞回 messages
    rounds++;
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const rawArgs = tc.function?.arguments || '{}';
      let args;
      try {
        args = JSON.parse(rawArgs);
      } catch {
        args = {}; // 模型偶尔返回畸形 JSON
      }

      console.log(`    agent 第 ${rounds} 轮：调用 ${name}(${rawArgs.length > 80 ? rawArgs.slice(0, 80) + '...' : rawArgs})`);

      const handler = toolHandlers[name];
      let resultStr;
      let ok = true;
      if (!handler) {
        resultStr = JSON.stringify({ error: `未知工具: ${name}` });
        ok = false;
      } else {
        try {
          const result = await handler(args);
          resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        } catch (e) {
          resultStr = JSON.stringify({ error: e.message });
          ok = false;
        }
      }

      const preview = resultStr.length > 100 ? resultStr.slice(0, 100) + '...' : resultStr;
      console.log(`      → ${ok ? '✓' : '✗'} ${preview}`);
      trace.push({ round: rounds, tool: name, args, resultPreview: preview, ok });

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: resultStr,
      });
    }
  }

  // 达到 maxRounds 仍未结束：强制让模型总结（不带 tools，必出文本）
  console.log(`    agent 达到 maxRounds=${maxRounds}，强制收尾`);
  const { message: finalMsg, usage: finalUsage } = await llm.chat({ messages: [...messages, { role: 'user', content: '已达到工具调用上限。请基于已有信息直接给出最终结论，不要再调用工具。' }] });
  totalUsage.inputTokens += finalUsage.inputTokens;
  totalUsage.outputTokens += finalUsage.outputTokens;

  return {
    content: finalMsg.content || '',
    rounds,
    usage: totalUsage,
    trace,
  };
}
