/**
 * Cloudflare Worker 主入口
 * 路由分发、Cache API 缓存控制与结果输出
 */

import { parseSubscription } from "./parser.js";
import { toBase64 } from "./utils.js";
import { fetchSubscriptionData } from "./scraper.js";
import { renderDashboardHtml } from "./ui.js";
import { verifyAuth, buildAuthRequiredResponse } from "./auth.js";

// 常见代理客户端 User-Agent 标识
const CLIENT_UA_PATTERNS = [
  "clash", "v2ray", "shadowrocket", "quantumult",
  "surge", "sing-box", "nekobox", "surfboard", "curl", "wget"
];

function isProxyClient(userAgent = "") {
  const ua = userAgent.toLowerCase();
  return CLIENT_UA_PATTERNS.some(p => ua.includes(p));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // 1. 访问鉴权校验（环境变量配置 AUTH_USERNAME / AUTH_PASSWORD / AUTH_TOKEN）
    const auth = verifyAuth(request, env);
    if (!auth.authenticated) {
      return buildAuthRequiredResponse();
    }

    // 2. 提取请求参数
    const customSource = searchParams.get("source") || searchParams.get("url");
    const format = (searchParams.get("format") || "").toLowerCase();
    const isB64 = searchParams.get("b64") === "1" || searchParams.get("b64") === "true" || format === "base64" || format === "b64";
    const filterKeyword = searchParams.get("filter") || "";
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1";

    // 2. 缓存检查 (Cloudflare Cache API)
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(url.toString(), request);
    if (cache && !forceRefresh && request.method === "GET") {
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    try {
      // 3. 获取目标数据并解析
      const { content, targetUrl, meta } = await fetchSubscriptionData(customSource);
      let nodes = parseSubscription(content);

      // 4. 按关键字过滤
      if (filterKeyword) {
        const kw = filterKeyword.toLowerCase();
        nodes = nodes.filter(n => decodeURIComponent(n).toLowerCase().includes(kw));
      }

      const clientUa = request.headers.get("user-agent") || "";
      const isSubRoute = pathname === "/sub" || pathname === "/txt" || pathname.startsWith("/sub/");
      const isClientRequest = isSubRoute || isB64 || format !== "" || isProxyClient(clientUa);

      // 5. 客户端或纯订阅请求 -> 返回纯文本节点列表或 Base64
      if (isClientRequest) {
        let bodyText = nodes.join("\n");
        if (isB64) {
          bodyText = toBase64(bodyText);
        }

        const headers = {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=1800",
          "Access-Control-Allow-Origin": "*",
          "X-Total-Nodes": String(nodes.length),
          "X-Source-Date": String(meta.sourceDate || "unknown")
        };

        const response = new Response(bodyText, { status: 200, headers });
        if (cache && ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
      }

      // 6. 浏览器访问根路径 -> 渲染可视化 Web 控制台
      const baseUrl = `${url.protocol}//${url.host}`;
      const tokenParam = auth.token ? `token=${encodeURIComponent(auth.token)}` : "";
      const subUrl = tokenParam ? `${baseUrl}/sub?${tokenParam}` : `${baseUrl}/sub`;
      const b64SubUrl = tokenParam ? `${baseUrl}/sub?b64=1&${tokenParam}` : `${baseUrl}/sub?b64=1`;

      const html = renderDashboardHtml({
        subUrl,
        b64SubUrl,
        nodes,
        targetUrl,
        sourceDate: meta.sourceDate,
        method: meta.method,
        authInfo: auth
      });

      const response = new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=600"
        }
      });

      if (cache && ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;

    } catch (err) {
      return new Response(
        `Error: ${err.message}\n\n请检查上游订阅源是否可访问，或稍后重试。`,
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        }
      );
    }
  }
};
