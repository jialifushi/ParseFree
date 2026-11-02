/**
 * 账号密码与访问鉴权模块
 * 支持环境变量配置：AUTH_USERNAME、AUTH_PASSWORD、AUTH_TOKEN
 * 支持 HTTP Basic Auth、URL UserInfo 及 URL 查询参数 (?token= / ?key= / ?pwd=)
 */

import { fromBase64 } from "./utils.js";

/**
 * 校验请求是否通过身份认证
 * @param {Request} request 
 * @param {Object} env 环境变量对象
 * @returns {{ authenticated: boolean, active: boolean, token?: string }}
 */
export function verifyAuth(request, env = {}) {
  const expectedUser = env.AUTH_USERNAME ? String(env.AUTH_USERNAME).trim() : "";
  const expectedPass = (env.AUTH_PASSWORD || env.AUTH_TOKEN) ? String(env.AUTH_PASSWORD || env.AUTH_TOKEN).trim() : "";

  // 若未配置任何账号密码或 Token，则不开启认证
  if (!expectedUser && !expectedPass) {
    return { authenticated: true, active: false };
  }

  const url = new URL(request.url);
  const searchParams = url.searchParams;

  // 1. 从 URL 查询参数中提取凭证 (?token= / ?key= / ?auth= / ?pwd=)
  const queryToken = searchParams.get("token") || searchParams.get("key") || searchParams.get("auth") || searchParams.get("pwd") || searchParams.get("password");
  const queryUser = searchParams.get("user") || searchParams.get("username");

  if (queryToken && queryToken === expectedPass) {
    if (!queryUser || !expectedUser || queryUser === expectedUser) {
      return { authenticated: true, active: true, token: queryToken };
    }
  }

  // 2. 从 HTTP Authorization 请求头提取 (Basic Auth)
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
    try {
      const b64Credentials = authHeader.slice(6).trim();
      const decoded = fromBase64(b64Credentials);
      const colonIndex = decoded.indexOf(":");
      if (colonIndex !== -1) {
        const user = decoded.substring(0, colonIndex);
        const pass = decoded.substring(colonIndex + 1);

        const userMatches = !expectedUser || user === expectedUser;
        const passMatches = pass === expectedPass;
        if (userMatches && passMatches) {
          return { authenticated: true, active: true, token: pass };
        }
      }
    } catch (err) {}
  }

  // 3. 从 URL 的 UserInfo 中提取 (如 https://user:pass@domain/sub)
  if (url.username || url.password) {
    const userMatches = !expectedUser || url.username === expectedUser;
    const passMatches = url.password === expectedPass;
    if (userMatches && passMatches) {
      return { authenticated: true, active: true, token: url.password };
    }
  }

  return { authenticated: false, active: true };
}

/**
 * 构造 401 认证挑战响应
 */
export function buildAuthRequiredResponse() {
  return new Response(
    "401 Unauthorized: 访问已被保护。请提供正确的账号密码，或在订阅链接中添加 ?token=您的密码 参数。",
    {
      status: 401,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "WWW-Authenticate": 'Basic realm="ParseFree Protected Area"',
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}
