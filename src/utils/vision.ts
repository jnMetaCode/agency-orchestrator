/**
 * 图片输入协议（vision）。
 *
 * 设计：图片以 **data URI 字符串**在变量系统里流动——`-i photo=@图.png` 解析成
 * `data:image/png;base64,...`，照常经 {{photo}} 渲染进 task 文本。好处：LLMConnector
 * 接口零改动（15 个连接器不受波及）、图片跨步骤传递不需要任何新机制。
 *
 * 发送前的分工：
 * - 支持 vision 的连接器（openai-compatible / claude）用 splitVisionMessage 把 data URI
 *   拆成多模态消息（文本里留 [图片N] 占位）；
 * - 不支持的（CLI 订阅类 / ollama v1）用 stripImageDataUris 剥离并警告——
 *   几 MB 的 base64 直接进提示词是 token 炸弹，绝不能原样透传。
 */

export const IMAGE_DATA_URI_RE = /data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/g;

export interface VisionImage { mime: string; base64: string; uri: string }

/** 把消息里内嵌的图片 data URI 拆出来：文本留 [图片N] 占位，图片按序返回。 */
export function splitVisionMessage(userMessage: string): { text: string; images: VisionImage[] } {
  const images: VisionImage[] = [];
  const text = userMessage.replace(IMAGE_DATA_URI_RE, (uri) => {
    const m = uri.match(/^data:(image\/[a-z]+);base64,(.+)$/s);
    if (!m) return uri;
    images.push({ mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], base64: m[2], uri });
    return `[图片${images.length}]`;
  });
  return { text, images };
}

/** 剥掉图片 data URI（换成占位文本）。给不支持 vision 的路径用，防 base64 炸提示词。 */
export function stripImageDataUris(s: string, placeholder = '[图片]'): string {
  return s.replace(IMAGE_DATA_URI_RE, placeholder);
}

/** 消息里是否带图片输入。 */
export function hasImageInput(s: string): boolean {
  IMAGE_DATA_URI_RE.lastIndex = 0;
  return IMAGE_DATA_URI_RE.test(s);
}
