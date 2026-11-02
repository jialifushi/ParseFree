/**
 * ParseFree - Cloudflare Worker / Pages 单文件独立运行版本
 * 适合直接复制全文粘贴到 Cloudflare Dashboard 在线代码编辑器中一键保存并部署
 * 或作为 Pages _worker.js 自动运行
 *
 * 核心功能：
 * 1. 每日自动抓取免费节点站点（free.datiya.com 等）最新的 Clash 配置
 * 2. 智能容错回退机制（今日未更新自动探测前 1~3 天可用数据）
 * 3. 实时将 Clash YAML 节点转为标准节点 URI（与 格式.txt 结构一致）
 * 4. 支持账号密码访问保护（AUTH_USERNAME / AUTH_PASSWORD / AUTH_TOKEN 环境变量）
 * 5. 支持浏览器 Web 可视化面板、通用明文订阅 (/sub)、Base64 订阅 (?b64=1)
 */

// ==================== 1. 通用工具模块 ====================
/**
 * 通用工具与 Base64 编解码助手
 * 兼容 Node.js 与 Cloudflare Worker 运行环境
 */

function toBase64(str) {
  if (typeof btoa === "function") {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return btoa(str);
    }
  }
  return Buffer.from(str, "utf-8").toString("base64");
}

function fromBase64(str) {
  if (typeof atob === "function") {
    try {
      return decodeURIComponent(escape(atob(str)));
    } catch (e) {
      return atob(str);
    }
  }
  return Buffer.from(str, "base64").toString("utf-8");
}

// ==================== 2. 协议格式化模块 ====================
/**
 * 代理节点协议转换格式化模块
 * 将各协议的代理配置对象转换为标准通用节点分享链接（格式.txt 结构）
 */



/**
 * 将单个 Proxy 节点对象转换为标准通用节点链接
 */
function proxyToUri(p) {
  if (!p || !p.type) return null;
  const type = String(p.type).toLowerCase();
  const name = p.name || `${p.server}:${p.port}`;
  const encodedName = encodeURIComponent(name);

  // 1. VMess 协议 (V2RayN 标准 JSON 格式)
  if (type === "vmess") {
    const vmessObj = {
      v: "2",
      ps: name,
      add: String(p.server || ""),
      port: String(p.port || 443),
      id: String(p.uuid || ""),
      aid: String(p.alterId !== undefined ? p.alterId : 0),
      scy: p.cipher || "auto",
      net: p.network || "tcp",
      type: "none",
      host: p["ws-opts"]?.headers?.Host || p["ws-headers"]?.Host || p.servername || "",
      path: p["ws-opts"]?.path || p["ws-path"] || "",
      tls: p.tls ? "tls" : "",
      sni: p.servername || p["ws-opts"]?.headers?.Host || "",
      alpn: Array.isArray(p.alpn) ? p.alpn.join(",") : (p.alpn || "")
    };
    if (p["skip-cert-verify"]) vmessObj.verify_cert = false;
    return "vmess://" + toBase64(JSON.stringify(vmessObj));
  }

  // 2. Shadowsocks 协议 (SIP002 标准)
  if (type === "ss") {
    const userinfo = toBase64(`${p.cipher}:${p.password}`);
    return `ss://${userinfo}@${p.server}:${p.port}#${encodedName}`;
  }

  // 3. AnyTLS 协议
  if (type === "anytls") {
    const sec = p.tls ? "tls" : "none";
    const sni = p.servername || p.sni || "";
    const alpn = encodeURIComponent(Array.isArray(p.alpn) ? p.alpn[0] : (p.alpn || "http/1.1"));
    const insecure = p["skip-cert-verify"] ? "1" : "0";
    const fp = p["client-fingerprint"] || "chrome";
    return `anytls://${p.password || p.uuid}@${p.server}:${p.port}?security=${sec}&sni=${encodeURIComponent(sni)}&alpn=${alpn}&insecure=${insecure}&fp=${fp}#${encodedName}`;
  }

  // 4. Trojan 协议
  if (type === "trojan") {
    const sni = p.sni || p.servername || p.server;
    return `trojan://${encodeURIComponent(p.password)}@${p.server}:${p.port}?security=tls&sni=${encodeURIComponent(sni)}#${encodedName}`;
  }

  // 5. VLESS 协议
  if (type === "vless") {
    const sec = p.tls ? (p.realityOpts ? "reality" : "tls") : "none";
    const net = p.network || "tcp";
    const sni = p.servername || p.sni || "";
    const path = p["ws-opts"]?.path || "";
    return `vless://${p.uuid}@${p.server}:${p.port}?encryption=none&security=${sec}&type=${net}&sni=${encodeURIComponent(sni)}&path=${encodeURIComponent(path)}#${encodedName}`;
  }

  // 6. Hysteria 2 协议
  if (type === "hysteria2" || type === "hy2") {
    const sni = p.sni || p.servername || "";
    const insecure = p["skip-cert-verify"] ? "1" : "0";
    return `hysteria2://${encodeURIComponent(p.password)}@${p.server}:${p.port}?sni=${encodeURIComponent(sni)}&insecure=${insecure}#${encodedName}`;
  }

  // 7. TUIC 协议
  if (type === "tuic") {
    const sni = p.sni || p.servername || "";
    const alpn = encodeURIComponent(Array.isArray(p.alpn) ? p.alpn.join(",") : (p.alpn || ""));
    return `tuic://${p.uuid}:${encodeURIComponent(p.password)}@${p.server}:${p.port}?sni=${encodeURIComponent(sni)}&alpn=${alpn}#${encodedName}`;
  }

  return null;
}

// ==================== 3. 节点解析模块 ====================
/**
 * 节点配置与订阅文本解析模块
 * 提供轻量无外部依赖的 Clash Flow/Block YAML 解析及通用订阅识别
 */




/**
 * 解析 Flow 风格紧凑键值对（例如 {name: xxx, port: 443, ...}）
 */
function parseFlow(s) {
  s = s.trim();
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1).trim();
  const res = {};
  let i = 0;
  const skipWs = () => { while (i < s.length && /\s/.test(s[i])) i++; };

  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;
    let key = "";
    while (i < s.length && s[i] !== ":" && s[i] !== " " && s[i] !== "\t") {
      if (s[i] === "\"" || s[i] === "\x27") {
        const q = s[i++];
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\") i++;
          key += s[i++];
        }
        i++;
      } else key += s[i++];
    }
    skipWs();
    if (s[i] === ":") i++;
    skipWs();

    let val = null;
    if (s[i] === "{") {
      let depth = 0, st = i;
      while (i < s.length) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") {
          depth--;
          if (depth === 0) { i++; break; }
        }
        i++;
      }
      val = parseFlow(s.slice(st, i));
    } else if (s[i] === "[") {
      let depth = 0, st = i;
      while (i < s.length) {
        if (s[i] === "[") depth++;
        else if (s[i] === "]") {
          depth--;
          if (depth === 0) { i++; break; }
        }
        i++;
      }
      val = s.slice(st + 1, i - 1).split(",").map(x => x.trim().replace(/^["\x27]|["\x27]$/g, "")).filter(Boolean);
    } else {
      let raw = "";
      if (s[i] === "\"" || s[i] === "\x27") {
        const q = s[i++];
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\") i++;
          raw += s[i++];
        }
        i++;
      } else {
        while (i < s.length && s[i] !== ",") raw += s[i++];
      }
      raw = raw.trim();
      if (raw === "true") val = true;
      else if (raw === "false") val = false;
      else if (/^-?\d+(\.\d+)?$/.test(raw)) val = Number(raw);
      else val = raw;
    }
    if (key) res[key] = val;
    skipWs();
    if (s[i] === ",") i++;
  }
  return res;
}

/**
 * 轻量解析 Clash YAML 中的 proxies 列表
 * 支持 Flow 紧凑单行格式和 Block 换行缩进格式
 */
function parseYamlProxies(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  let startIdx = -1;
  let baseIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(\s*)proxies\s*:/);
    if (m) {
      startIdx = i + 1;
      baseIndent = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return [];

  const proxyLines = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.search(/\S/);
    if (indent <= baseIndent && /^[a-zA-Z0-9_-]+\s*:/.test(trimmed)) {
      break;
    }
    proxyLines.push(line);
  }

  const items = [];
  let curItem = [];
  for (let line of proxyLines) {
    if (/^\s*-\s+/.test(line)) {
      if (curItem.length > 0) items.push(curItem);
      curItem = [line];
    } else if (curItem.length > 0) {
      curItem.push(line);
    }
  }
  if (curItem.length > 0) items.push(curItem);

  function parseBlock(linesArr) {
    const root = {};
    const stack = [{ indent: -1, obj: root }];
    for (let rawLine of linesArr) {
      let line = rawLine;
      const indent = line.search(/\S/);
      line = line.replace(/^\s*-\s+/, "").trim();
      if (!line || line.startsWith("#")) continue;

      const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let valStr = m[2].trim();

      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;

      if (valStr === "") {
        const newObj = {};
        parent[key] = newObj;
        stack.push({ indent, obj: newObj });
      } else if (valStr.startsWith("{") && valStr.endsWith("}")) {
        parent[key] = parseFlow(valStr);
      } else if (valStr.startsWith("[") && valStr.endsWith("]")) {
        parent[key] = valStr.slice(1, -1).split(",").map(x => x.trim().replace(/^["\x27]|["\x27]$/g, "")).filter(Boolean);
      } else {
        valStr = valStr.replace(/^["\x27]|["\x27]$/g, "");
        if (valStr === "true") parent[key] = true;
        else if (valStr === "false") parent[key] = false;
        else if (/^-?\d+(\.\d+)?$/.test(valStr)) parent[key] = Number(valStr);
        else parent[key] = valStr;
      }
    }
    return root;
  }

  const result = [];
  for (let it of items) {
    const first = it[0].trim();
    if (/^-\s*\{/.test(first)) {
      const full = it.map(x => x.trim()).join(" ").replace(/^-\s*/, "");
      result.push(parseFlow(full));
    } else {
      result.push(parseBlock(it));
    }
  }
  return result;
}

/**
 * 智能解析订阅数据（支持 Clash YAML、Base64 订阅、纯文本链接列表）
 */
function parseSubscription(rawContent) {
  if (!rawContent || typeof rawContent !== "string") return [];
  const trimmed = rawContent.trim();

  // A. 若包含 Clash 标记 "proxies:"
  if (/^proxies\s*:/m.test(trimmed)) {
    const list = parseYamlProxies(trimmed);
    const uris = [];
    for (const p of list) {
      const uri = proxyToUri(p);
      if (uri) uris.push(uri);
    }
    return uris;
  }

  // B. 尝试检测是否为直接的 URI 列表 (包含 vmess://, anytls://, ss:// 等)
  const uriLines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => /^(vmess|vless|ss|ssr|trojan|anytls|hysteria2?|tuic):\/\//i.test(l));
  if (uriLines.length > 0) {
    return uriLines;
  }

  // C. 尝试进行 Base64 解码后再匹配
  try {
    const decoded = fromBase64(trimmed);
    const decodedLines = decoded.split(/\r?\n/).map(l => l.trim()).filter(l => /^(vmess|vless|ss|ssr|trojan|anytls|hysteria2?|tuic):\/\//i.test(l));
    if (decodedLines.length > 0) {
      return decodedLines;
    }
  } catch (err) {}

  return [];
}

// ==================== 4. 动态抓取与容错模块 ====================
/**
 * 目标节点源动态探测与抓取模块
 * 针对 free.datiya.com 等每日更新网站提供智能文章抓取与多日容错回退机制
 */

const DEFAULT_BASE_URL = "https://free.datiya.com";

/**
 * 获取当前北京时间 (UTC+8) 的 Date 对象
 */
function getBeijingDate() {
  const now = new Date();
  return new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
}

/**
 * 格式化日期为 YYYYMMDD
 */
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * 智能定位最新的 Clash YAML 订阅链接
 */
async function discoverLatestClashUrl(baseUrl = DEFAULT_BASE_URL) {
  // 1. 尝试从网站首页解析最新发布的文章
  try {
    const homeRes = await fetch(`${baseUrl}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (homeRes.ok) {
      const homeHtml = await homeRes.text();
      const postMatch = homeHtml.match(/\/post\/(\d{8})\/?/);
      if (postMatch) {
        const postUrl = `${baseUrl}/post/${postMatch[1]}/`;
        const postRes = await fetch(postUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        if (postRes.ok) {
          const postHtml = await postRes.text();
          const yamlMatch = postHtml.match(/https?:\/\/[^\s"'<>]+\/uploads\/\d{8}-clash\.yaml/);
          if (yamlMatch) {
            return {
              url: yamlMatch[0],
              sourceDate: postMatch[1],
              method: "article_discovery"
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn("HomePage scraping failed, proceeding to date fallback:", err.message);
  }

  // 2. 容错机制：按当前北京时间往前探测 3 天（今日、昨日、前日）
  const bjNow = getBeijingDate();
  for (let offset = 0; offset <= 3; offset++) {
    const targetDate = new Date(bjNow.getTime() - offset * 86400000);
    const dateStr = formatDate(targetDate);
    const candidateUrl = `${baseUrl}/uploads/${dateStr}-clash.yaml`;
    try {
      const probeRes = await fetch(candidateUrl, { method: "HEAD" });
      if (probeRes.ok) {
        return {
          url: candidateUrl,
          sourceDate: dateStr,
          method: "date_probe"
        };
      }
    } catch (err) {}
  }

  // 默认兜底尝试昨日
  const yesterday = new Date(bjNow.getTime() - 86400000);
  const fallbackDate = formatDate(yesterday);
  return {
    url: `${baseUrl}/uploads/${fallbackDate}-clash.yaml`,
    sourceDate: fallbackDate,
    method: "fallback"
  };
}

/**
 * 抓取目标订阅内容
 * 支持用户传入自定义 source 或自动探测
 */
async function fetchSubscriptionData(customSourceUrl) {
  let targetUrl = customSourceUrl;
  let meta = { sourceDate: "custom", method: "custom_url" };

  if (!targetUrl) {
    const discovery = await discoverLatestClashUrl();
    targetUrl = discovery.url;
    meta = discovery;
  }

  const response = await fetch(targetUrl, {
    headers: {
      "User-Agent": "ClashforWindows/0.20.39",
      "Accept": "*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`获取订阅源失败 [HTTP ${response.status}]: ${targetUrl}`);
  }

  const content = await response.text();
  return {
    content,
    targetUrl,
    meta
  };
}

// ==================== 5. 账号密码鉴权模块 ====================
/**
 * 账号密码与访问鉴权模块
 * 支持环境变量配置：AUTH_USERNAME、AUTH_PASSWORD、AUTH_TOKEN
 * 支持 HTTP Basic Auth、URL UserInfo 及 URL 查询参数 (?token= / ?key= / ?pwd=)
 */



/**
 * 校验请求是否通过身份认证
 * @param {Request} request 
 * @param {Object} env 环境变量对象
 * @returns {{ authenticated: boolean, active: boolean, token?: string }}
 */
function verifyAuth(request, env = {}) {
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
function buildAuthRequiredResponse() {
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

// ==================== 6. UI 渲染模块 ====================
/**
 * Web 控制台页面渲染模块
 * 遵循 Element Plus 企业级风格，简洁、专业、克制
 */

function renderDashboardHtml({
  subUrl,
  b64SubUrl,
  nodes,
  targetUrl,
  sourceDate,
  method,
  authInfo = {}
}) {
  const nodeCount = nodes.length;
  const escapedNodes = JSON.stringify(nodes);
  const isProtected = Boolean(authInfo.active);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费节点订阅解析转换服务</title>
  <style>
    :root {
      --el-color-primary: #409eff;
      --el-color-success: #67c23a;
      --el-color-warning: #e6a23c;
      --el-color-info: #909399;
      --el-color-danger: #f56c6c;
      --el-bg-color: #f5f7fa;
      --el-text-color-primary: #303133;
      --el-text-color-regular: #606266;
      --el-text-color-secondary: #909399;
      --el-border-color: #dcdfe6;
      --el-border-color-light: #e4e7ed;
      --card-bg: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--el-bg-color);
      color: var(--el-text-color-primary);
      line-height: 1.6;
      padding: 24px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .header {
      background: var(--card-bg);
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .header h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: var(--el-text-color-primary); }
    .header p { font-size: 14px; color: var(--el-text-color-regular); }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid var(--el-color-primary); padding-left: 10px; }
    
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .meta-item { background: #fafafa; border: 1px solid var(--el-border-color-light); padding: 12px; border-radius: 4px; }
    .meta-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
    .meta-value { font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); word-break: break-all; }
    
    .sub-box { margin-bottom: 16px; }
    .sub-label { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--el-text-color-regular); }
    .input-group { display: flex; gap: 8px; }
    .input-control {
      flex: 1;
      padding: 9px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 4px;
      font-size: 13px;
      background: #fafafa;
      color: var(--el-text-color-primary);
    }
    .btn {
      padding: 9px 16px;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      border: 1px solid transparent;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-primary { background: var(--el-color-primary); color: #fff; }
    .btn-primary:hover { background: #66b1ff; }
    .btn-default { background: #fff; border-color: var(--el-border-color); color: var(--el-text-color-regular); }
    .btn-default:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
    
    .node-list { max-height: 400px; overflow-y: auto; border: 1px solid var(--el-border-color-light); border-radius: 4px; }
    .node-item {
      padding: 10px 14px;
      font-size: 13px;
      font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      border-bottom: 1px solid var(--el-border-color-light);
      word-break: break-all;
      background: #fff;
    }
    .node-item:nth-child(even) { background: #fafafa; }
    .node-item:last-child { border-bottom: none; }
    .tag {
      display: inline-block;
      padding: 2px 6px;
      font-size: 11px;
      border-radius: 3px;
      font-weight: 600;
      margin-right: 8px;
    }
    .tag-vmess { background: #ecf5ff; color: #409eff; border: 1px solid #d9ecff; }
    .tag-ss { background: #f0f9eb; color: #67c23a; border: 1px solid #e1f3d8; }
    .tag-anytls { background: #fdf6ec; color: #e6a23c; border: 1px solid #faecd8; }
    .tag-other { background: #f4f4f5; color: #909399; border: 1px solid #e9e9eb; }
    
    .toast {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      display: none;
      z-index: 9999;
    }
  </style>
</head>
<body>
  <div class="toast" id="toast">复制成功</div>
  <div class="container">
    <div class="header">
      <h1>免费节点自动同步与格式转换服务</h1>
      <p>自动抓取每日更新的节点订阅，实时转换为标准节点链接格式（与 格式.txt 结构一致）。</p>
    </div>

    <div class="card">
      <div class="card-title">节点状态概览</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">已解析可用节点数</div>
          <div class="meta-value" style="color: var(--el-color-success);">${nodeCount} 个</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">数据源发布日期</div>
          <div class="meta-value">${sourceDate || "最新"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">获取机制</div>
          <div class="meta-value">${method === "article_discovery" ? "文章智能抓取" : (method === "date_probe" ? "日期轮询探测" : "自定义源")}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">访问鉴权保护</div>
          <div class="meta-value" style="color: ${isProtected ? 'var(--el-color-success)' : 'var(--el-color-info)'};">${isProtected ? "已开启 (密码保护)" : "未开启 (公开访问)"}</div>
        </div>
      </div>
      <div class="meta-label">当前解析上游源地址：</div>
      <div style="font-size: 13px; color: var(--el-text-color-regular); font-family: monospace; word-break: break-all;">${targetUrl}</div>
    </div>

    <div class="card">
      <div class="card-title">订阅地址获取</div>
      <div class="sub-box">
        <div class="sub-label">1. 通用明文订阅链接（每行一个节点，推荐导入 Shadowrocket / v2rayN / sing-box / NekoBox）：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="subInput" value="${subUrl}">
          <button class="btn btn-primary" onclick="copyText('${subUrl}')">复制订阅链接</button>
        </div>
      </div>
      <div class="sub-box">
        <div class="sub-label">2. Base64 编码订阅链接（适用于仅支持 base64 订阅的客户端）：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="b64SubInput" value="${b64SubUrl}">
          <button class="btn btn-default" onclick="copyText('${b64SubUrl}')">复制 Base64 链接</button>
        </div>
      </div>
      <div style="margin-top: 16px;">
        <button class="btn btn-primary" onclick="copyAllNodes()">一键复制全部节点链接</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">节点链接明细 (${nodeCount})</div>
      <div class="node-list">
        ${nodes.map((n) => {
          const proto = n.split("://")[0] || "node";
          let tagClass = "tag-other";
          if (proto === "vmess") tagClass = "tag-vmess";
          else if (proto === "ss") tagClass = "tag-ss";
          else if (proto === "anytls") tagClass = "tag-anytls";
          return `<div class="node-item"><span class="tag ${tagClass}">${proto.toUpperCase()}</span>${n}</div>`;
        }).join("")}
      </div>
    </div>
  </div>

  <script>
    const allNodes = ${escapedNodes};

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.style.display = "block";
      setTimeout(() => { t.style.display = "none"; }, 2000);
    }

    function copyText(val) {
      navigator.clipboard.writeText(val).then(() => {
        showToast("已复制到剪贴板");
      }).catch(() => {
        prompt("请手动复制：", val);
      });
    }

    function copyAllNodes() {
      const text = allNodes.join("\\n");
      copyText(text);
    }
  </script>
</body>
</html>`;
}

// ==================== 7. Worker 主入口 ====================
/**
 * Cloudflare Worker 主入口
 * 路由分发、Cache API 缓存控制与结果输出
 */







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
