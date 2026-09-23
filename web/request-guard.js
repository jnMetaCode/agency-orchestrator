// Studio 服务端的请求来源守卫（纯函数，test/request-guard.ts 钉住）。
//
// 为什么需要：服务端默认只听 127.0.0.1，但「只听回环」挡不住浏览器——用户开着 Studio 时访问的
// 任何网页都能往 127.0.0.1:8088 发请求。两条真实攻击面：
//   1. **DNS 重绑定**：恶意页把自己的域名解析改指到 127.0.0.1，于是它和 Studio「同源」，能读响应。
//      /api/test-provider 会把**已保存的 key** 发到请求里给的 baseUrl —— 等于把 key 寄给对方；
//      /api/claude/apply 还能改写 ~/.claude/settings.json。特征：Host 头是对方的域名。
//   2. **跨站表单 POST**：/api/claude/repair、/restore、/proxy/clear 这类不需要请求体的端点，
//      一个自动提交的 <form> 就能触发，连预检都不需要。特征：Origin 头是别人的站。
//
// 规则：
//   - 绑在回环上（默认）：Host 必须是回环名，或在 AO_ALLOWED_HOSTS 里。重绑定靠的是域名，回环名绑不了。
//   - 绑在非回环上（Docker / NAS，部署者自己选择了暴露到局域网）：不强制 Host——那里的用户常用
//     `nas.local`、反代域名访问，升级后全员 403 是更糟的结果；配了 AO_ALLOWED_HOSTS 才按白名单收紧。
//   - Origin 头存在时（浏览器对跨源请求和所有 POST 都会带）：必须与 Host 同主机，或本身是回环
//     （vite dev server 从 localhost:5173 代理过来），或在白名单里。`Origin: null`（沙箱 iframe、
//     file://）一律拒绝——正常的 Studio 页面永远不会是 null 源。
//   - 没有 Origin 头的请求（curl、脚本、同源 GET）不受 Origin 规则影响。

import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHost(name) {
  const h = String(name || '').trim().toLowerCase();
  return LOOPBACK.has(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h.endsWith('.localhost');
}

/** "example.com:8088" / "[::1]:8088" / "127.0.0.1" → 小写主机名（IPv6 保留方括号外的内容）。解析不了返回 ''。 */
export function hostnameOf(hostHeader) {
  const s = String(hostHeader || '').trim().toLowerCase();
  if (!s) return '';
  try { return new URL(`http://${s}`).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; }
}

export function parseAllowedHosts(raw) {
  return String(raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * @param {{ host?: string, origin?: string, boundHost: string, allowedHosts?: string[] }} p
 * @returns {{ ok: true } | { ok: false, reason: 'host' | 'origin', detail: string }}
 */
export function checkRequestSource({ host, origin, boundHost, allowedHosts = [] }) {
  const reqHost = hostnameOf(host);
  const allowed = (h) => allowedHosts.includes(h);
  const enforceHost = isLoopbackHost(boundHost) || allowedHosts.length > 0;
  if (enforceHost) {
    const okHost = reqHost && (isLoopbackHost(reqHost) || allowed(reqHost));
    if (!okHost) return { ok: false, reason: 'host', detail: reqHost || '(空)' };
  }
  if (origin != null && origin !== '') {
    if (origin === 'null') return { ok: false, reason: 'origin', detail: 'null' };
    let o;
    try { o = new URL(origin); } catch { return { ok: false, reason: 'origin', detail: String(origin).slice(0, 80) }; }
    const oHost = o.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const sameHost = !!reqHost && oHost === reqHost;
    if (!sameHost && !isLoopbackHost(oHost) && !allowed(oHost)) return { ok: false, reason: 'origin', detail: o.host };
  }
  return { ok: true };
}

/**
 * 可选的访问令牌（`AO_WEB_TOKEN`）。默认不设 = 行为一个字节不变；设了之后 `/api/*` 必须带上它。
 *
 * 为什么需要：Docker 镜像监听 0.0.0.0，同一内网里任何人打开就能用你存的 key 跑活、删运行、改配置。
 * 来源守卫（Host/Origin）挡的是**别的网页**借用户的浏览器发请求，挡不住直接访问的人。
 *
 * 两种带法：`Authorization: Bearer <token>`（前端的 fetch 用这个），或 `?token=<token>`（首次进页面
 * 用链接把令牌带进来，前端随即存起来并把它从地址栏抹掉）。
 * 比较用定长扫描，别让「第几个字符不对」从耗时上漏出去。
 */
export function timingSafeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  // 长度不等时 crypto 会直接抛，所以先判长度（长度本来就藏不住），再对等长内容做定时安全比较
  if (x.length !== y.length || x.length === 0) return false;
  return cryptoTimingSafeEqual(x, y);
}

/** 请求里带的令牌：优先 Authorization: Bearer，其次 ?token=。都没有返回 ''。 */
export function tokenFromRequest(req) {
  const auth = String(req?.headers?.authorization || '');
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const q = req?.query?.token;
  return typeof q === 'string' ? q.trim() : '';
}
