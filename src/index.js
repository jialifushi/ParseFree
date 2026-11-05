/**
 * Cloudflare Worker 主入口
 * 支持 HTTP 请求路由处理与 Cron 定时事件监听 (scheduled)
 */

import { parseSubscription } from "./parser.js";
import { toBase64 } from "./utils.js";
import { renderDashboardHtml } from "./ui.js";
import { verifyAuth, buildAuthRequiredResponse } from "./auth.js";
import { resolveSubscriptionData, handleScheduledTask, getSavedConfig, saveConfig, getCacheVersion } from "./manager.js";
import { processAndRenameNodes, DEFAULT_FIRST_NODE_NAME, DEFAULT_NODE_PREFIX } from "./renamer.js";
import { sendBarkNotification, sendClientFetchPush } from "./bark.js";

const CLIENT_UA_PATTERNS = [
  "clash", "v2ray", "shadowrocket", "quantumult",
  "surge", "sing-box", "nekobox", "surfboard", "curl", "wget"
];

// 版本标识：代码更新后自动使 Cloudflare 旧版本边缘缓存完全失效
const WORKER_VERSION = "3.2.0";

function isProxyClient(userAgent = "") {
  const ua = userAgent.toLowerCase();
  return CLIENT_UA_PATTERNS.some(p => ua.includes(p));
}

export default {
  // HTTP 请求处理
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, searchParams } = url;

    // 1. 访问鉴权校验（环境变量配置 AUTH_USERNAME / AUTH_PASSWORD / AUTH_TOKEN）
    const auth = verifyAuth(request, env);
    if (!auth.authenticated) {
      return buildAuthRequiredResponse();
    }

    // 1.1 Bark 配置测试与保存 API 路由
    if (pathname === "/api/test-bark") {
      let bodyJson = {};
      if (request.method === "POST") bodyJson = await request.json().catch(() => ({}));
      const saved = await getSavedConfig(env);
      const srv = bodyJson.server || searchParams.get("server") || saved.barkServer || env.BARK_SERVER || "https://api.day.app";
      const k = bodyJson.key || searchParams.get("key") || saved.barkKey || env.BARK_KEY || "";
      const res = await sendBarkNotification({
        server: srv, key: k,
        title: "【ParseFree】Bark 推送服务配置测试",
        body: `🎉 恭喜！Bark 推送服务已成功连接，当前配置生效正常。\n测试时间：${new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
        group: "ParseFree"
      });
      return new Response(JSON.stringify(res), { status: res.success ? 200 : 400, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    if (pathname === "/api/save-bark" && request.method === "POST") {
      const bodyJson = await request.json().catch(() => ({}));
      const res = await saveConfig(env, bodyJson);
      return new Response(JSON.stringify(res), { status: res.success ? 200 : 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    // 2. 提取请求参数
    const requestedSource = searchParams.get("source") || searchParams.get("url") || "";
    const requestedType = searchParams.get("type") || ""; // clash | v2ray
    const requestedInterval = searchParams.get("retry_interval") || searchParams.get("interval") || null;
    const format = (searchParams.get("format") || "").toLowerCase();
    const isB64 = searchParams.get("b64") === "1" || searchParams.get("b64") === "true" || format === "base64" || format === "b64";
    const filterKeyword = searchParams.get("filter") || "";
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1";

    // 节点自定义名称与前缀参数（支持环境变量与 URL 参数）
    const firstName = searchParams.get("first_name") || searchParams.get("ad_name") || env.FIRST_NODE_NAME || DEFAULT_FIRST_NODE_NAME;
    const prefix = searchParams.get("prefix") !== null ? searchParams.get("prefix") : (env.NODE_PREFIX !== undefined ? env.NODE_PREFIX : DEFAULT_NODE_PREFIX);

    // 3. 边缘缓存处理 (注入版本号与数据版本，定时任务更新或改版时旧缓存立即失效)
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKeyUrl = new URL(url.toString());
    cacheKeyUrl.searchParams.set("_worker_v", WORKER_VERSION);
    cacheKeyUrl.searchParams.set("_dv", String(getCacheVersion()));
    const cacheKey = new Request(cacheKeyUrl.toString(), request);
    if (cache && !forceRefresh && request.method === "GET") {
      const cached = await cache.match(cacheKey);
      if (cached) {
        // 确保客户端始终收到禁止本地缓存标头，避免手机客户端缓存旧备注
        const clientRes = new Response(cached.body, cached);
        clientRes.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
        clientRes.headers.set("Pragma", "no-cache");
        clientRes.headers.set("Expires", "0");
        return clientRes;
      }
    }

    try {
      // 4. 解析与获取订阅数据（智能日期状态机或手动模式）
      const data = await resolveSubscriptionData({
        requestedSource,
        requestedType,
        requestedInterval,
        forceRefresh,
        env
      });
      let nodes = parseSubscription(data.content);

      // 5. 广告宣传信息清洗与节点自定义重命名（首节点自动附带日部分）
      nodes = processAndRenameNodes(nodes, { firstName, prefix, sourceDate: data.sourceDate });

      // 6. 关键词过滤
      if (filterKeyword) {
        const kw = filterKeyword.toLowerCase();
        nodes = nodes.filter(n => decodeURIComponent(n).toLowerCase().includes(kw));
      }

      const clientUa = request.headers.get("user-agent") || "";
      const isSubRoute = pathname === "/sub" || pathname === "/txt" || pathname.startsWith("/sub/");
      const isClientRequest = isSubRoute || isB64 || format !== "" || isProxyClient(clientUa);

      // 7. 客户端请求 -> 输出纯文本节点列表或 Base64 订阅
      if (isClientRequest) {
        let bodyText = nodes.join("\n");
        if (isB64) {
          bodyText = toBase64(bodyText);
        }

        const headers = {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
          "Access-Control-Allow-Origin": "*",
          "Subscription-Userinfo": "upload=0; download=0; total=10737418240000; expire=0",
          "Profile-Update-Interval": "6",
          "Content-Disposition": `attachment; filename="ParseFree_${data.sourceDate || 'sub'}.txt"`,
          "X-Total-Nodes": String(nodes.length),
          "X-Source-Date": encodeURIComponent(String(data.sourceDate || "unknown")),
          "X-Source-Type": encodeURIComponent(String(data.type)),
          "X-Last-Request-Time": encodeURIComponent(data.lastRequestTimeStr || ""),
          "X-Next-Request-Time": encodeURIComponent(data.nextRequestTimeStr || ""),
          "X-Countdown-Seconds": String(data.countdownSeconds || 0)
        };

        const response = new Response(bodyText, { status: 200, headers });
        if (ctx && typeof ctx.waitUntil === "function") {
          if (cache) {
            const edgeCacheRes = new Response(bodyText, { status: 200, headers: { ...headers, "Cache-Control": "public, max-age=60" } });
            ctx.waitUntil(cache.put(cacheKey, edgeCacheRes));
          }
          const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "";
          ctx.waitUntil(getSavedConfig(env).then(saved => sendClientFetchPush({
            clientUa, clientIp, format: isB64 ? "Base64" : "明文", nodeCount: nodes.length, sourceDate: data.sourceDate, env, savedConfig: saved
          })));
        }
        return response;
      }

      // 8. 浏览器访问根路径 -> 渲染 Web 控制面板
      const baseUrl = `${url.protocol}//${url.host}`;
      const queryParts = [];
      if (auth.token) queryParts.push(`token=${encodeURIComponent(auth.token)}`);
      if (data.type === "v2ray") queryParts.push("type=v2ray");
      if (requestedSource) queryParts.push(`source=${encodeURIComponent(requestedSource)}`);
      if (firstName !== DEFAULT_FIRST_NODE_NAME) queryParts.push(`first_name=${encodeURIComponent(firstName)}`);
      if (prefix !== DEFAULT_NODE_PREFIX) queryParts.push(`prefix=${encodeURIComponent(prefix)}`);
      if (requestedInterval) queryParts.push(`retry_interval=${encodeURIComponent(requestedInterval)}`);

      const queryStr = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
      const b64QueryStr = queryParts.length > 0 ? `?b64=1&${queryParts.join("&")}` : "?b64=1";

      const subUrl = `${baseUrl}/sub${queryStr}`;
      const b64SubUrl = `${baseUrl}/sub${b64QueryStr}`;
      const savedConfig = await getSavedConfig(env);

      const html = renderDashboardHtml({
        subUrl,
        b64SubUrl,
        nodes,
        targetUrl: data.targetUrl,
        sourceDate: data.sourceDate,
        isToday: data.isToday,
        mode: data.mode,
        type: data.type,
        authInfo: auth,
        renameOptions: { firstName, prefix },
        retryMinutes: data.retryMinutes,
        statusMsg: data.statusMsg,
        timing: {
          lastRequestTimeStr: data.lastRequestTimeStr,
          nextRequestTimeStr: data.nextRequestTimeStr,
          countdownSeconds: data.countdownSeconds,
          isToday: data.isToday
        },
        barkConfig: savedConfig
      });

      const response = new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300"
        }
      });

      if (cache && ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
      }
      return response;

    } catch (err) {
      return new Response(
        `Error: ${err.message}\n\n请检查源地址是否有效，或稍后重试。`,
        {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        }
      );
    }
  },

  // 定时任务 (Cron Trigger) 触发处理
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledTask(env));
  }
};
