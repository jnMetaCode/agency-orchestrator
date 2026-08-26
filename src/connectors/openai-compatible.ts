/**
 * OpenAI Compatible Connector
 * 支持 DeepSeek、智谱、通义、Moonshot 等兼容 OpenAI 格式的 API
 *
 * 默认使用 streaming 模式，避免长生成任务被服务端 60s 超时断开（DeepSeek 等常见问题）
 */
import { splitVisionMessage, stripImageDataUris } from '../utils/vision.js';
import type { LLMConnector, LLMResult, LLMConfig } from '../types.js';

// 端点地址/发送的公共逻辑抽到 endpoint.ts（Ollama 连接器也要用，放这里会形成奇怪的依赖方向）。
// 这里整体再导出：web/server.js、cli.ts、测试都从本模块引，保持导入路径不变。
export {
  joinEndpoint, normalizeBaseUrl, chatEndpointCandidates, endpointCandidates,
  isAzureDeploymentUrl, sameCredentialScope, postChatCompletions, postApiEndpoint, endpointHint,
  isGatewayRouteMissShell, envProxyHint,
} from './endpoint.js';
export type { ChatPostResult } from './endpoint.js';
import { normalizeBaseUrl, isAzureDeploymentUrl, postChatCompletions, endpointHint, isGatewayRouteMissShell, envProxyHint } from './endpoint.js';


/** 估算 token 数：CJK 字符按 1.5 token/char，ASCII 按 0.25 token/char */
function estimateTokens(text: string): number {
  let cjk = 0, ascii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cjk++; else ascii++;
  }
  return Math.ceil(cjk * 1.5 + ascii / 4);
}

/**
 * 解析「非流式」的一整个 JSON 响应（中转端点无视 stream:true 时的常见形态）。
 * 兼容 OpenAI 的 message.content、部分实现的 text 字段，以及 content 为分段数组的写法；
 * 万一 content-type 标了 json 实际发的还是 SSE，退回按 data: 行扫一遍，不至于两头落空。
 */
function parseNonStreamBody(text: string): { content: string; finishReason: string | null } {
  try {
    const j = JSON.parse(text);
    if (j?.error) throw new Error(`API error: ${j.error.message || JSON.stringify(j.error)}`);
    const choice = j?.choices?.[0];
    const raw = choice?.message?.content ?? choice?.text ?? j?.content;
    const content = Array.isArray(raw)
      ? raw.map((p: { text?: string }) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
      : typeof raw === 'string' ? raw : '';
    return { content, finishReason: choice?.finish_reason ?? null };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('API error')) throw err;
    // 标了 json 却发的 SSE：按行捞一遍 delta
    let content = '', finishReason: string | null = null;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data: ') || t.slice(6) === '[DONE]') continue;
      try {
        const chunk = JSON.parse(t.slice(6));
        content += chunk?.choices?.[0]?.delta?.content ?? '';
        finishReason = chunk?.choices?.[0]?.finish_reason ?? finishReason;
      } catch { /* 半截行忽略 */ }
    }
    return { content, finishReason };
  }
}

/** 构造「停顿中断」错误，带 stalled / noContent 标记，供 executor 给精准提示（不再首推增大超时）。 */
function makeStallError(stallMs: number, contentLen: number, partial?: string): Error {
  const secs = Math.max(1, Math.round(stallMs / 1000));
  const detail = contentLen === 0
    ? `provider ${secs}s 内未返回任何内容（0 token，多半输入过大或服务端卡住）`
    : `provider 停顿超过 ${secs}s 未继续输出`;
  const err = new Error(`stream stalled: ${detail}`);
  (err as { stalled?: boolean }).stalled = true;
  (err as { noContent?: boolean }).noContent = contentLen === 0;
  if (partial) (err as { partialContent?: string }).partialContent = partial;
  process.stderr.write(`\n  ⏱️  ${detail}，已主动中断（可调 AO_STREAM_STALL_MS）\n`);
  return err;
}

export class OpenAICompatibleConnector implements LLMConnector {
  private apiKey: string;
  /** 只读暴露给外部 debug / 测试用，运行时不可变 */
  readonly baseUrl: string;
  /** Azure OpenAI 端点：用 `api-key` header + `max_completion_tokens`（与原生 OpenAI 不同）。issue #38 */
  readonly isAzure: boolean;
  /** 首次请求探测出的可用端点（含跳转后的最终地址）；后续请求直接复用，不再重复探测 */
  private resolvedEndpoint?: string;
  /** 地址漂移提示每个连接器实例只播一次，别把日志刷满 */
  private noticed = new Set<string>();

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    // 规整用户填的地址（引号/尾斜杠/整条 curl 地址/缺协议），避免最常见的粘贴错配
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    );
    this.isAzure = /\.azure\.com|azure/i.test(this.baseUrl);

    if (!this.apiKey) {
      throw new Error('缺少 API Key，请通过参数或环境变量传入');
    }
  }

  /**
   * token 上限参数名。Azure 的 gpt 模型（及 OpenAI o系列推理模型）只认 `max_completion_tokens`，
   * 老式 `max_tokens` 会被拒。Azure 自动切换；其它端点可用 AO_OPENAI_TOKENS_PARAM 显式覆盖。issue #38
   */
  /** o1/o3/o4/gpt-5 系推理模型：reasoning token 计入输出上限，且只认 max_completion_tokens。
   *  按模型名识别，覆盖 Azure 之外的原生 OpenAI / 第三方兼容端点；gpt-4o 等非推理模型不误伤。issue #99 */
  private isReasoningModel(model?: string): boolean {
    return /(?:^|[^a-z])(?:o[1-9]|gpt-5)/i.test(model || '');
  }

  /** token 上限参数名。Azure 的 gpt 模型及 OpenAI o 系列/gpt-5 推理模型只认 max_completion_tokens，
   *  老式 max_tokens 会被 400 拒。可用 AO_OPENAI_TOKENS_PARAM 显式覆盖。issue #38 #99 */
  private tokenParamFor(model?: string): 'max_tokens' | 'max_completion_tokens' {
    const forced = process.env.AO_OPENAI_TOKENS_PARAM;
    if (forced === 'max_completion_tokens' || forced === 'max_tokens') return forced;
    return this.isAzure || this.isReasoningModel(model) ? 'max_completion_tokens' : 'max_tokens';
  }

  /** 未显式指定 max_tokens 时的默认上限。**仅推理模型**放大：它们把 reasoning token 计入输出上限，
   *  4096 常被内部推理吃光 → finish_reason=length、content 为空（「调用成功却什么都没生成」）。
   *  非推理的 Azure 部署（gpt-4/gpt-35 等，输出上限仅 4k~16k）保持 4096——否则 32768 会被端点以
   *  「max_completion_tokens 过大」400 拒掉，且该 400 不在切参重试的覆盖范围内。issue #99 */
  private defaultMaxTokens(model?: string): number {
    return this.isReasoningModel(model) ? 32768 : 4096;
  }

  async chat(systemPrompt: string, userMessage: string, config: LLMConfig): Promise<LLMResult> {
    const maxContinuations = 3;  // 最多续写 3 次
    let fullContent = '';
    // 空正文诊断用：最后一段流的 reasoning 字符数 / finish_reason / 请求地址（作用域在循环外）
    let lastReasoningChars = 0, lastFinishReason: string | null = null, lastRequestUrl = '';

    // token 参数名/默认上限按模型定；若端点不接受该参数名，遇 400 自动切到另一个名字重试一次（双向）。issue #99
    let activeTokenParam = this.tokenParamFor(config.model);
    let activeMaxTokens = config.max_tokens || this.defaultMaxTokens(config.model);
    let switchedParam = false; // token 参数名最多自动切换一次（任一方向），防抖动
    let endpointReprobed = false; // 缓存端点失效后最多重探一次

    try {
    for (let continuation = 0; continuation <= maxContinuations; continuation++) {
      // 构建消息：首次用原始 prompt，续写时追加已有内容让模型接着写。
      // 带图片输入（data URI，见 utils/vision.ts）时拆成 OpenAI vision content 数组——
      // 需要模型本身支持 vision，不支持的模型由服务端报错（诚实透传，不静默吞图）。
      const { text: userText, images: userImages } = splitVisionMessage(userMessage);
      const userContent: string | Array<Record<string, unknown>> = userImages.length
        ? [{ type: 'text', text: userText }, ...userImages.map((im) => ({ type: 'image_url', image_url: { url: im.uri } }))]
        : userMessage;
      const messages: Array<{role: string; content: string | Array<Record<string, unknown>>}> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];
      if (continuation > 0 && fullContent) {
        messages.push(
          { role: 'assistant', content: fullContent },
          { role: 'user', content: '你的回答被中断了，请从中断处继续写完，不要重复已写的内容。' },
        );
      }

      const fetchTimeout = config.timeout || 300_000;
      // 首字节/停顿超时：provider 迟迟不吐数据（输入过大 / 服务端卡死）时快速失败，
      // 而不是干等到总超时（可被动态抬到 20+ 分钟）。可用 AO_STREAM_STALL_MS 覆盖；不超过总超时。
      // 覆盖「等响应头」+「读 body」全程：连响应头都不来也能在 stallMs 内中断（不只 token 间隙）。
      const stallMs = Math.min(Number(process.env.AO_STREAM_STALL_MS) || 90_000, fetchTimeout);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeout);
      const abortState = { stalled: false };
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const armStall = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => { abortState.stalled = true; controller.abort(); }, stallMs);
      };
      const clearStall = () => clearTimeout(stallTimer);
      armStall(); // 从发起请求就开始计时（覆盖「等响应头」阶段）

      let response: Response;
      let requestUrl = `${this.baseUrl}/chat/completions`;
      let drift: string | undefined;
      try {
        // 跳转保持 POST（否则 301/302 会被降级成 GET → 上游回 405）+ /v1 拼法自动兜底
        const post = await postChatCompletions({
          baseUrl: this.baseUrl,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            // Azure 用 api-key header 鉴权（Bearer 仅 AAD token 时有效）
            ...(this.isAzure ? { 'api-key': this.apiKey } : {}),
          },
          signal: controller.signal,
          endpoint: this.resolvedEndpoint,
          // 只有真·Azure 部署地址才放弃 /v1 兜底（域名里恰好带 azure 的中转仍然享受兜底）
          azure: isAzureDeploymentUrl(this.baseUrl),
          onNotice: (m) => this.notice(m),
          body: JSON.stringify({
            // 供应商专有参数（thinking/reasoning 档位等）先铺底，核心字段随后覆盖——
            // params 永远不能改掉 model/stream/messages，避免把流式解析搞挂
            ...(config.params ?? {}),
            model: config.model!,
            [activeTokenParam]: activeMaxTokens,
            ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
            stream: true,
            messages,
          }),
        });
        response = post.response;
        requestUrl = post.url;
        drift = post.drift;
        // 探测到的可用地址记下来：后续续写/重试不再重复试候选路径
        if (response.ok) this.resolvedEndpoint = post.url;
      } catch (err) {
        clearTimeout(timer);
        clearStall();
        // 等响应头阶段就被停顿检测中断（provider 连头都不发）
        if (abortState.stalled) {
          throw makeStallError(stallMs, 0);
        }
        const proxy = envProxyHint();
        const hint = !this.apiKey
          ? '\n  可能原因: 未设置 API Key，请检查环境变量（DEEPSEEK_API_KEY 或 OPENAI_API_KEY）或 .env 配置'
          : `\n  可能原因: 无法连接 ${this.baseUrl}，请检查 base_url 是否正确、网络是否可达`
            + (proxy ? `\n  ${proxy}` : '');
        throw new Error(`请求失败: ${requestUrl}\n  ${err instanceof Error ? err.message : err}${hint}`);
      }

      if (!response.ok) {
        clearTimeout(timer);
        clearStall();
        const text = await response.text();
        // 端点不接受当前 token 参数名（推理模型只认 max_completion_tokens，部分聚合端点只认 max_tokens）→
        // 自动切到另一个名字重试一次（双向）。排除「数值过大」类 400，免把 value 问题误判成参数名问题。issue #99
        const paramNameRejected = /max_(?:completion_)?tokens/i.test(text)
          && !/too large|too many|maximum|exceed|less than|greater than|must be|at most/i.test(text);
        if (response.status === 400 && !switchedParam && paramNameRejected) {
          switchedParam = true;
          activeTokenParam = activeTokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
          // 切到 max_completion_tokens 说明确是推理模型；用户没显式指定时把默认上限一并放大，避免被推理吃光
          if (activeTokenParam === 'max_completion_tokens' && !config.max_tokens) {
            activeMaxTokens = Math.max(activeMaxTokens, 32768);
          }
          process.stderr.write(`  🔄 端点不接受该 token 参数名，自动切换为 ${activeTokenParam} 重试...\n`);
          continuation--; // 这次切参重试不消耗续写额度
          continue;
        }
        // 缓存下来的端点后来失效了（中转商改了路由等）→ 清掉缓存重探一次候选，
        // 免得整轮运行都卡在一个已经不通的地址上。只重探一次，防打转。
        if ((response.status === 404 || response.status === 405) && this.resolvedEndpoint && !endpointReprobed) {
          endpointReprobed = true;
          this.resolvedEndpoint = undefined;
          continuation--; // 重探不消耗续写额度
          continue;
        }
        // 光一句「API error 405」用户无从查起——把实际请求地址、跳转情况和该状态码的
        // 常见成因一并带上（405 几乎必然是 base_url 配错/被跳转，见 endpointHint）
        throw new Error(
          `API error ${response.status}: ${text.slice(0, 500)}${endpointHint(response.status, requestUrl, this.baseUrl, drift)}`,
        );
      }

      let streamResult: { content: string; finishReason: string | null; reasoningChars?: number };
      try {
        // 有些中转/自建端点无视 stream:true，直接回一整个 JSON。按 SSE 去解会一行都匹配不上，
        // 结果是「调用成功却什么都没生成」这种最难查的失败——按 content-type 走非流式解析。
        if (/application\/json/i.test(response.headers.get('content-type') || '')) {
          const text = await response.text();
          // 两个候选路径都被网关用「200 + 正文写着接口不存在」挡回来了（LanoX 这类网关不回 404）。
          // 不点破的话 parseNonStreamBody 只会解出空字符串，用户看到的是「跑完了但什么都没生成」。
          if (isGatewayRouteMissShell(text)) {
            throw new Error(
              `API error: 端点返回 200 但正文是「接口不存在」——地址没走对（${text.slice(0, 200)}）` +
              endpointHint(404, requestUrl, this.baseUrl, drift),
            );
          }
          streamResult = parseNonStreamBody(text);
        } else {
          // armStall 在 readStream 收到每段字节时被调用以重置停顿计时
          streamResult = await this.readStream(response, { onData: armStall });
        }
      } catch (err) {
        clearTimeout(timer);
        clearStall();
        const partial = (err as any).partialContent as string | undefined;
        // 断点续写：拿到 >200 字符部分内容就续写（停顿中断也算，下一轮会重新计时）
        if (partial && partial.length > 200) {
          fullContent += partial;
          process.stderr.write(`  🔄 断点续写 (${continuation + 1}/${maxContinuations})，已累计 ${fullContent.length} 字符...\n`);
          continue;
        }
        // 停顿中断且无可用部分内容 → 抛精准 stall 错误（带 noContent，供 executor 给对的提示）
        if (abortState.stalled) {
          throw makeStallError(stallMs, fullContent.length, fullContent.length > 200 ? fullContent : undefined);
        }
        const streamErr = new Error(`streaming terminated (已收到 ${fullContent.length} 字符): ${err instanceof Error ? err.message : err}`);
        (streamErr as any).partialContent = fullContent.length > 200 ? fullContent : undefined;
        throw streamErr;
      } finally {
        clearTimeout(timer);
        clearStall();
      }

      fullContent += streamResult.content;
      lastReasoningChars += streamResult.reasoningChars ?? 0;
      lastFinishReason = streamResult.finishReason;
      lastRequestUrl = requestUrl;
      // 干净结束但命中 max_tokens 上限（finish_reason=length）→ 自动续写，避免静默截断
      if (streamResult.finishReason === 'length' && continuation < maxContinuations) {
        process.stderr.write(`  🔄 输出达 max_tokens 上限，自动续写 (${continuation + 1}/${maxContinuations})，已累计 ${fullContent.length} 字符...\n`);
        continue;
      }
      break;
    }
    } catch (err) {
      // 续写循环中途若遇到非流式错误（如某轮 fetch 失败 / 503），前面已累计的 fullContent
      // 会随错误抛出而丢失。这里把已生成内容附在错误上，让 executor 的最后兜底仍能保留它。
      // （流式中断路径已自带 partialContent；取两者较长者，避免覆盖更完整的内容。）
      if (fullContent.length > 200) {
        const existing = (err as any)?.partialContent as string | undefined;
        if (!existing || existing.length < fullContent.length) {
          (err as any).partialContent = fullContent;
        }
      }
      throw err;
    }

    // 正文为空绝不能当"完成"返回：下游步骤会拿着空变量继续跑（真机：提示词工程师 57s 输出 0 token 被记为完成，
    // 反穿帮清单问"你指哪条提示词"，出片步骤把空 prompt 发给厂商才报 400）。推理模型"只想不写"是最常见的原因。
    if (!fullContent.trim()) {
      const rc = lastReasoningChars;
      const why = rc > 0
        ? `模型只返回了思考内容（${rc} 字符 reasoning）没有正文——多半是输出上限被 thinking 吃光，或该模型在这家网关上不回正文`
        : `模型返回了空正文（finish_reason=${lastFinishReason ?? '未知'}）`;
      throw new Error(`${why}。换一个模型（如非推理模型）或关闭 thinking 后重试；请求地址: ${lastRequestUrl}`);
    }
    return {
      content: fullContent,
      usage: {
        // 流式模式下 usage 在最后一个 chunk，已在 readStream 中尝试提取
        // 兜底用字符估算（CJK 字符 ≈ 1-2 token，英文 ≈ 0.25 token/char）。
        // 图片必须先剥掉再估——base64 按字符估会虚报 20 万+ token；每张图按 vision 常见口径记 ~800
        input_tokens: estimateTokens(systemPrompt + stripImageDataUris(userMessage, ''))
          + (userMessage.match(/data:image\//g)?.length ?? 0) * 800,
        output_tokens: estimateTokens(fullContent),
      },
    };
  }

  /** 地址跳转/换候选的提示：同一条只播一次（续写会重复触发） */
  private notice(msg: string): void {
    if (this.noticed.has(msg)) return;
    this.noticed.add(msg);
    process.stderr.write(`  ${msg}\n`);
  }

  /**
   * 读取 SSE 流并拼接内容
   * 格式: data: {"choices":[{"delta":{"content":"token"}}]}\n\n
   * 结束: data: [DONE]\n\n
   */
  private async readStream(
    response: Response,
    opts?: { onData?: () => void },
  ): Promise<{ content: string; finishReason: string | null; reasoningChars?: number }> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is null');

    const decoder = new TextDecoder();
    let content = '';
    let buffer = '';
    let finishReason: string | null = null;
    // 推理模型（Agnes 2.0 / DeepSeek R 系等）先流 reasoning_content 再流 content；只记长度用于诊断"只想不写"
    let reasoningChars = 0;
    let lastProgressTime = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        opts?.onData?.();  // 连接还在产出字节，重置外层停顿计时

        buffer += decoder.decode(value, { stream: true });

        // 每 10 秒显示接收进度，让用户知道没卡死
        const now = Date.now();
        if (now - lastProgressTime > 10_000 && content.length > 0) {
          lastProgressTime = now;
          process.stderr.write(`  📡 已生成 ${content.length} 字...\n`);
        }

        // 按行解析 SSE
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';  // 最后一行可能不完整，留到下次

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);  // 去掉 "data: "
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            // 检查流式错误响应
            if (chunk.error) {
              throw new Error(`API stream error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
            const rd = chunk.choices?.[0]?.delta?.reasoning_content ?? chunk.choices?.[0]?.delta?.reasoning;
            if (typeof rd === 'string') reasoningChars += rd.length;
            const fr = chunk.choices?.[0]?.finish_reason;
            if (fr) finishReason = fr;
          } catch (e) {
            // 重新抛出 API 错误，忽略 JSON 解析失败
            if (e instanceof Error && e.message.startsWith('API stream error')) throw e;
          }
        }
      }
    } catch (err) {
      reader.cancel().catch(() => {});  // 释放连接资源
      // 流被服务端断开（DeepSeek ~60s 超时）或被外层停顿检测 abort。
      // 始终抛出错误让 chat 判断（停顿 / 部分内容），部分内容附在 error 上供兜底。
      const streamErr = new Error(`streaming terminated (已收到 ${content.length} 字符): ${err instanceof Error ? err.message : err}`);
      (streamErr as { partialContent?: string }).partialContent = content.length > 200 ? content : undefined;
      process.stderr.write(`\n  ⚠️  流式连接中断 (${err instanceof Error ? err.message : err})，已收到 ${content.length} 字符\n`);
      throw streamErr;
    }

    reader.cancel().catch(() => {});  // 正常结束也释放 reader
    return { content, finishReason, reasoningChars };
  }
}
