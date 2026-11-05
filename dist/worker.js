/**
 * ParseFree - Cloudflare Worker / Pages 单文件独立运行版本
 * 适合直接复制全文粘贴到 Cloudflare Dashboard 在线代码编辑器中一键保存并部署
 * 或作为 Pages _worker.js 自动运行
 *
 * 核心功能：
 * 1. 每日00点后自动递增更新地址，一旦获取成功自动停止探测并锁定
 * 2. 自动识别并清理 "tg频道:@freenodedaily" 等宣传信息，更换为 "HOS Daily官方维护"
 * 3. 自动为普通节点名称增加前缀 "HOS自动化线路 "，支持环境变量与 URL 参数深度自定义
 * 4. 支持手动编辑地址与自动日期模式切换，支持 Clash 与 V2Ray 两种源格式
 * 5. 支持账号密码访问保护（AUTH_PASSWORD / AUTH_USERNAME 环境变量）
 * 6. 支持浏览器 Web 可视化面板、通用明文订阅 (/sub)、Base64 订阅 (?b64=1)
 */

// ==================== 1. 通用工具模块 ====================
/**
 * 通用工具与 Base64 编解码助手
 * 兼容 Node.js 与 Cloudflare Worker 运行环境
 */

const DEFAULT_BASE_URL = "https://free.datiya.com";

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

/**
 * 获取当前北京时间 (UTC+8) 的 Date 对象
 */
function getBeijingDate() {
  const now = new Date();
  return new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
}

/**
 * 将 Date 对象格式化为 YYYYMMDD 字符串
 */
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * 格式化时间戳为北京时间 (UTC+8) 字符串: YYYY-MM-DD HH:mm:ss
 */
function formatBeijingDateTime(epochMs) {
  if (!epochMs) return "-";
  const bjOffsetMs = 8 * 60 * 60 * 1000;
  const d = new Date(epochMs + bjOffsetMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * 获取接下来一天的 00:00:00 (北京时间) 的 UTC 毫秒时间戳
 */
function getNextDayMidnightEpochMs(nowMs = Date.now()) {
  const bjOffsetMs = 8 * 60 * 60 * 1000;
  const bjTime = new Date(nowMs + bjOffsetMs);
  const y = bjTime.getUTCFullYear();
  const m = bjTime.getUTCMonth();
  const d = bjTime.getUTCDate();
  return Date.UTC(y, m, d + 1, 0, 0, 0) - bjOffsetMs;
}

/**
 * 计算时间元数据：上次请求时间、下次请求时间以及实时倒计时秒数
 */
function computeTimingMeta({
  isSuccess = false,
  lastFailedTime = 0,
  retryCooldownMs = 600000,
  nowMs = Date.now()
} = {}) {
  let nextRequestTime = 0;
  if (isSuccess) {
    // 成功锁定今日/或手动成功：下一次请求时间固定为接下来一天的 00:00 (北京时间)
    nextRequestTime = getNextDayMidnightEpochMs(nowMs);
  } else if (lastFailedTime > 0) {
    // 失败重试中：下一次请求时间为 失败时间 + 冷却时间
    nextRequestTime = lastFailedTime + retryCooldownMs;
  } else {
    nextRequestTime = nowMs;
  }
  const countdownSeconds = Math.max(0, Math.floor((nextRequestTime - nowMs) / 1000));
  return {
    nextRequestTime,
    countdownSeconds,
    nextRequestTimeStr: formatBeijingDateTime(nextRequestTime)
  };
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

// ==================== 5. 订阅源与状态管理模块 ====================
/**
 * 订阅源与每日更新状态管理模块
 * 支持自动日期递增、失败重试间隔退避、失败期间自动回退最新有效数据与成功后锁定停止机制
 */




const DEFAULT_RETRY_INTERVAL_MINUTES = 10;

// 内存中记录的最新状态缓存
let memoryState = {
  date: "",            // 当前提供数据的日期 (YYYYMMDD)
  type: "clash",       // 源类型: clash | v2ray
  isTodayReady: false, // 今天的数据是否已成功拿到（一旦拿到即锁定，停止定时探测）
  targetUrl: "",       // 实际使用的源地址
  content: "",         // 源订阅文本内容
  lastSuccessTime: 0,  // 最近一次成功获取的时间戳
  lastFailedTime: 0,   // 最近一次探测今日失败的时间戳
  lastRequestTime: 0,  // 最近一次请求/探测的时间戳
  dataVersion: 1,      // 数据版本号 (变更时使 CF 边缘缓存立即失效)
  lastNotifiedSuccessDate: "", // 当天成功通知记录 (防重复推送)
  lastAlertSlots: []   // 已发送未更新告警的时段 (如 ["20261106-9"])
};

function getCacheVersion() {
  return memoryState.dataVersion || 1;
}

function bumpCacheVersion() {
  memoryState.dataVersion = Date.now();
  return memoryState.dataVersion;
}

function buildReturnData(result, retryCooldownMs) {
  const nowMs = Date.now();
  memoryState.lastRequestTime = nowMs;
  const timing = computeTimingMeta({
    isSuccess: Boolean(result.isToday || result.mode === "manual"),
    lastFailedTime: memoryState.lastFailedTime,
    retryCooldownMs,
    nowMs
  });
  return {
    ...result, lastRequestTime: nowMs, lastRequestTimeStr: formatBeijingDateTime(nowMs),
    nextRequestTime: timing.nextRequestTime, nextRequestTimeStr: timing.nextRequestTimeStr, countdownSeconds: timing.countdownSeconds
  };
}

function buildSourceUrl(dateStr, type = "clash", baseUrl = DEFAULT_BASE_URL) {
  const ext = type.toLowerCase() === "v2ray" ? "v2ray.txt" : "clash.yaml";
  return `${baseUrl}/uploads/${dateStr}-${ext}`;
}

async function getSavedConfig(env = {}) {
  const kv = env.PARSEFREE_KV || env.KV;
  if (kv && typeof kv.get === "function") {
    try {
      const saved = await kv.get("PARSEFREE_CONFIG", { type: "json" });
      if (saved) return saved;
    } catch (e) {}
  }
  return {
    mode: env.SOURCE_MODE || "auto", type: env.SOURCE_TYPE || "clash", manualUrl: env.CUSTOM_SOURCE_URL || "",
    retryInterval: Number(env.RETRY_INTERVAL_MINUTES) || DEFAULT_RETRY_INTERVAL_MINUTES,
    barkServer: env.BARK_SERVER || "", barkKey: env.BARK_KEY || "",
    notifySuccess: env.BARK_NOTIFY_SUCCESS !== "0", notifyAlert: env.BARK_NOTIFY_ALERT !== "0", notifyDevice: env.BARK_NOTIFY_DEVICE === "1"
  };
}

async function saveConfig(env = {}, newConfig = {}) {
  const kv = env.PARSEFREE_KV || env.KV;
  if (kv && typeof kv.put === "function") {
    const current = await getSavedConfig(env);
    const updated = { ...current, ...newConfig };
    await kv.put("PARSEFREE_CONFIG", JSON.stringify(updated));
    return { success: true, config: updated };
  }
  return { success: false, error: "未绑定 KV 命名空间 (PARSEFREE_KV)" };
}

async function fetchValidContent(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "ClashforWindows/0.20.39", "Accept": "*/*" } });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 50) return text;
    }
  } catch (err) {}
  return null;
}

/**
 * 智能解析订阅数据（状态机）
 * 每天00点后自动递增，失败按设定间隔重试，失败期间自动回退最新可用数据，成功后立刻停止探测
 */
async function resolveSubscriptionData({
  requestedSource = "",
  requestedType = "",
  requestedInterval = null,
  forceRefresh = false,
  env = {}
}) {
  const savedConfig = await getSavedConfig(env);
  const type = (requestedType || savedConfig.type || "clash").toLowerCase();
  const manualUrl = requestedSource || (savedConfig.mode === "manual" ? savedConfig.manualUrl : "");
  const retryMinutes = Math.max(1, Number(requestedInterval) || savedConfig.retryInterval || DEFAULT_RETRY_INTERVAL_MINUTES);
  const retryCooldownMs = retryMinutes * 60 * 1000;

  // 1. 手动模式：直接使用指定地址
  if (manualUrl) {
    const res = await fetch(manualUrl, {
      headers: { "User-Agent": "ClashforWindows/0.20.39", "Accept": "*/*" }
    });
    if (!res.ok) throw new Error(`手动源获取失败 [HTTP ${res.status}]: ${manualUrl}`);
    const content = await res.text();
    const dateMatch = manualUrl.match(/(\d{8})/);
    return buildReturnData({
      content,
      targetUrl: manualUrl,
      sourceDate: dateMatch ? dateMatch[1] : "manual",
      isToday: true,
      mode: "manual",
      type,
      retryMinutes
    }, retryCooldownMs);
  }

  // 2. 自动模式：基于北京时间 (UTC+8) 的日期自动递增
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);

  // A. 今日数据已锁定：直接返回，完全停止探测
  if (!forceRefresh && memoryState.isTodayReady && memoryState.date === todayStr && memoryState.type === type && memoryState.content) {
    return buildReturnData({
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: true,
      mode: "auto",
      type,
      retryMinutes,
      statusMsg: "今日数据已锁定 (停止探测)"
    }, retryCooldownMs);
  }

  // B. 检查失败重试冷却期：若刚失败不久且已有可用回退数据，则暂不重复探测，直接回退返回最新数据
  const timeSinceLastFail = Date.now() - memoryState.lastFailedTime;
  const isCoolingDown = !forceRefresh && memoryState.lastFailedTime > 0 && timeSinceLastFail < retryCooldownMs;

  if (isCoolingDown && memoryState.content) {
    const waitSeconds = Math.ceil((retryCooldownMs - timeSinceLastFail) / 1000);
    return buildReturnData({
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: false,
      mode: "auto",
      type,
      retryMinutes,
      isCoolingDown: true,
      statusMsg: `今日源待发布，冷却重试中 (已回退，${waitSeconds} 秒后允许再次探测)`
    }, retryCooldownMs);
  }

  // C. 发起对今日新源的探测
  const candidateTypes = type === "v2ray" ? ["v2ray", "clash"] : ["clash"];
  for (const cType of candidateTypes) {
    const todayUrl = buildSourceUrl(todayStr, cType);
    const content = await fetchValidContent(todayUrl);
    if (content) {
      // 成功拿到今日新数据 -> 锁定状态，清空失败标记，停止后续探测
      memoryState = {
        date: todayStr,
        type,
        isTodayReady: true,
        targetUrl: todayUrl,
        content,
        lastSuccessTime: Date.now(),
        lastFailedTime: 0,
        lastRequestTime: Date.now(),
        dataVersion: memoryState.dataVersion || 1,
        lastNotifiedSuccessDate: memoryState.lastNotifiedSuccessDate,
        lastAlertSlots: memoryState.lastAlertSlots
      };
      bumpCacheVersion();
      if (memoryState.lastNotifiedSuccessDate !== todayStr) {
        memoryState.lastNotifiedSuccessDate = todayStr;
        sendSuccessPush({ todayStr, env, savedConfig }).catch(() => {});
      }
      return buildReturnData({
        content,
        targetUrl: todayUrl,
        sourceDate: todayStr,
        isToday: true,
        mode: "auto",
        type,
        retryMinutes,
        statusMsg: "今日数据已成功获取并锁定"
      }, retryCooldownMs);
    }
  }

  // D. 探测今日失败 -> 记录失败时间戳，启动间隔退避
  memoryState.lastFailedTime = Date.now();

  // 若已有历史有效数据，立即自动回退返回
  if (memoryState.content && memoryState.type === type) {
    return buildReturnData({
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: false,
      mode: "auto",
      type,
      retryMinutes,
      statusMsg: `今日数据尚未上传，已自动回退使用 ${memoryState.date} 数据`
    }, retryCooldownMs);
  }

  // E. 内存无数据时，向前回退探测前 1~7 天有效数据兜底
  for (let offset = 1; offset <= 7; offset++) {
    const pastDateStr = formatDate(new Date(bjNow.getTime() - offset * 86400000));
    for (const cType of candidateTypes) {
      const pastUrl = buildSourceUrl(pastDateStr, cType);
      const content = await fetchValidContent(pastUrl);
      if (content) {
        memoryState = {
          date: pastDateStr, type, isTodayReady: false, targetUrl: pastUrl, content,
          lastSuccessTime: Date.now(), lastFailedTime: Date.now(), lastRequestTime: Date.now(),
          dataVersion: memoryState.dataVersion || 1,
          lastNotifiedSuccessDate: memoryState.lastNotifiedSuccessDate,
          lastAlertSlots: memoryState.lastAlertSlots
        };
        return buildReturnData({
          content, targetUrl: pastUrl, sourceDate: pastDateStr, isToday: false, mode: "auto", type, retryMinutes,
          statusMsg: `已自动回退使用 ${pastDateStr} 最新有效数据`
        }, retryCooldownMs);
      }
    }
  }

  throw new Error(`无法获取可用节点数据，探测今日 [${todayStr}] 及前 7 日源均无有效响应。`);
}

/**
 * 定时任务 (Cron Trigger) 处理函数
 * 遵循重试间隔限制，今日一旦成功获取立即停止探测
 * 支持 09:00 / 12:00 / 18:00 固定时段未发布告警推送
 */
async function handleScheduledTask(env = {}) {
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);
  const bjHour = bjNow.getHours();
  const savedConfig = await getSavedConfig(env);

  if (memoryState.isTodayReady && memoryState.date === todayStr) {
    console.log(`[Cron] 今日数据已锁定 [${todayStr}]，停止探测。`);
    return;
  }

  // 9点 / 12点 / 18点未发布自动告警推送
  if ([9, 12, 18].includes(bjHour) && !memoryState.isTodayReady) {
    const slotKey = `${todayStr}-${bjHour}`;
    if (!memoryState.lastAlertSlots.includes(slotKey)) {
      memoryState.lastAlertSlots.push(slotKey);
      if (memoryState.lastAlertSlots.length > 20) memoryState.lastAlertSlots.shift();
      sendAlertPush({
        hour: bjHour,
        todayStr,
        fallbackDate: memoryState.date,
        retryMinutes: savedConfig.retryInterval,
        env,
        savedConfig
      }).catch(() => {});
    }
  }

  const retryCooldownMs = (savedConfig.retryInterval || DEFAULT_RETRY_INTERVAL_MINUTES) * 60 * 1000;
  if (memoryState.lastFailedTime > 0 && Date.now() - memoryState.lastFailedTime < retryCooldownMs) {
    return;
  }

  try {
    await resolveSubscriptionData({ forceRefresh: true, env });
  } catch (err) {
    console.warn(`[Cron] 今日新源尚未发布:`, err.message);
  }
}

// ==================== 6. 节点名称清洗与重命名模块 ====================
/**
 * 节点名称清洗与自定义重命名模块
 * 1. 识别并清理源数据中的广告/宣传信息（如 "tg频道:@freenodedaily"），替换为指定的首节点名称
 * 2. 首节点自动追加数据来源日期的“日”部分（如 20261102 -> "HOS Daily官方维护02"），一目了然识别今日是否已更新
 * 3. 为其他所有节点自动增加指定前缀（如 "HOS自动化线路 "）
 * 4. 支持环境变量与 URL 参数深度自定义
 */



const DEFAULT_FIRST_NODE_NAME = "HOS Daily官方维护";
const DEFAULT_NODE_PREFIX = "HOS自动化线路 ";

// 常见广告与宣传特征正则表达式
const AD_PATTERNS = [
  /tg(?:频道|群|社区)?[:：\s]*@/i,
  /@freenode/i,
  /telegram/i,
  /@\w+/i,
  /关注频道/i,
  /发布页/i,
  /官网/i,
  /最新地址/i,
  /每日更新/i
];

/**
 * 判断指定节点名称是否属于宣传广告
 */
function isAdvertisement(name = "", index = 0) {
  if (!name) return false;
  if (index === 0 && /(tg|@|http|频道|群)/i.test(name)) {
    return true;
  }
  return AD_PATTERNS.some(p => p.test(name));
}

/**
 * 格式化单个节点的显示名称
 * @param {string} rawName 原始名称
 * @param {number} index 节点索引 (0 为首节点)
 * @param {Object} options 配置项 (firstName, prefix, sourceDate)
 */
function formatNodeDisplayName(rawName = "", index = 0, {
  firstName = DEFAULT_FIRST_NODE_NAME,
  prefix = DEFAULT_NODE_PREFIX,
  sourceDate = ""
} = {}) {
  const trimmed = rawName.trim();

  // 首个节点或命中宣传广告特征的节点
  if (isAdvertisement(trimmed, index) || index === 0) {
    let baseName = (firstName || DEFAULT_FIRST_NODE_NAME).trim();
    // 从 sourceDate 中提取 2 位日部分 (如 20261102 -> 02)
    const match = String(sourceDate).match(/(\d{4})(\d{2})(\d{2})/);
    if (match) {
      const dayStr = match[3];
      if (!baseName.endsWith(dayStr)) {
        baseName = `${baseName}${dayStr}`;
      }
    }
    return baseName;
  }

  // 普通节点：若尚未包含该前缀，则添加前缀
  if (prefix && !trimmed.startsWith(prefix.trim())) {
    return `${prefix}${trimmed}`;
  }
  return trimmed;
}

/**
 * 重写标准节点 URI 链接中的节点名称
 * 支持：
 * 1. 标准 V2RayN JSON 格式 (vmess://base64(json))
 * 2. 小火箭/Quantumult 风格 VMess (vmess://base64?remarks=...#...)
 * 3. 带有 # 备注或 ?remarks= 查询参数的协议 (ss, anytls, trojan, vless, hysteria 等)
 */
function renameUriNode(uri, index = 0, options = {}) {
  if (!uri || typeof uri !== "string") return uri;

  // 1. VMess 协议 URI: 优先尝试标准 V2RayN JSON 格式
  if (uri.startsWith("vmess://")) {
    const rawRest = uri.slice(8).trim();
    try {
      const questionIdx = rawRest.indexOf("?");
      const hashIdx = rawRest.indexOf("#");
      let b64Part = rawRest;
      if (questionIdx !== -1) b64Part = rawRest.substring(0, questionIdx);
      else if (hashIdx !== -1) b64Part = rawRest.substring(0, hashIdx);

      const jsonStr = fromBase64(b64Part.trim());
      if (jsonStr.startsWith("{") && jsonStr.endsWith("}")) {
        const vmessObj = JSON.parse(jsonStr);
        const currentName = vmessObj.ps || "";
        vmessObj.ps = formatNodeDisplayName(currentName, index, options);
        return "vmess://" + toBase64(JSON.stringify(vmessObj));
      }
    } catch (e) {
      // 无法作为 JSON 解析，继续向下执行按 Shadowrocket query / hash 格式处理
    }
  }

  // 2. 带有 # 备注名称或 ?remarks= 的各类 URI (Shadowrocket-style vmess, ss, anytls, trojan 等)
  let workingUri = uri;
  const hashIdx = workingUri.indexOf("#");
  let rawName = "";

  if (hashIdx !== -1) {
    const rawNameEncoded = workingUri.substring(hashIdx + 1);
    try {
      rawName = decodeURIComponent(rawNameEncoded);
    } catch (e) {
      rawName = rawNameEncoded;
    }
  } else {
    const remarksMatch = workingUri.match(/[?&]remarks=([^&#]*)/i);
    if (remarksMatch) {
      try {
        rawName = decodeURIComponent(remarksMatch[1]);
      } catch (e) {
        rawName = remarksMatch[1];
      }
    }
  }

  if (rawName || hashIdx !== -1) {
    const newName = formatNodeDisplayName(rawName, index, options);
    const encodedNewName = encodeURIComponent(newName);

    if (/[?&]remarks=/i.test(workingUri)) {
      workingUri = workingUri.replace(/([?&]remarks=)[^&#]*/i, `$1${encodedNewName}`);
    }

    if (hashIdx !== -1) {
      workingUri = `${workingUri.substring(0, hashIdx)}#${encodedNewName}`;
    } else {
      workingUri = `${workingUri}#${encodedNewName}`;
    }
    return workingUri;
  }

  return uri;
}

/**
 * 批量处理并重命名节点链接列表
 */
function processAndRenameNodes(nodes = [], options = {}) {
  return nodes.map((nodeUri, idx) => renameUriNode(nodeUri, idx, options));
}

// ==================== 7. 账号密码鉴权模块 ====================
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

// ==================== 8. UI 渲染模块 ====================
/**
 * Web 控制台页面渲染模块
 * 遵循 Element Plus 企业级风格，简洁、专业、克制
 * 支持自动日期模式 / 手动编辑地址模式切换，支持 V2Ray / Clash 源切换与节点重命名规则自定义
 */

function renderDashboardHtml({
  subUrl,
  b64SubUrl,
  nodes,
  targetUrl,
  sourceDate,
  isToday,
  mode,
  type,
  authInfo = {},
  renameOptions = {},
  retryMinutes = 10,
  statusMsg = "",
  timing = {},
  barkConfig = {}
}) {
  const nodeCount = nodes.length;
  const escapedNodes = JSON.stringify(nodes);
  const isProtected = Boolean(authInfo.active);
  const isAutoMode = mode !== "manual";
  const isV2ray = type === "v2ray";
  const firstName = renameOptions.firstName || "HOS Daily官方维护";
  const prefix = renameOptions.prefix !== undefined ? renameOptions.prefix : "HOS自动化线路 ";
  const lastReqTime = timing.lastRequestTimeStr || "-";
  const nextReqTime = timing.nextRequestTimeStr || "-";
  const countdownSec = Number(timing.countdownSeconds) || 0;
  const barkServer = barkConfig.barkServer || "";
  const barkKey = barkConfig.barkKey || "";
  const notifySuccess = barkConfig.notifySuccess !== false;
  const notifyAlert = barkConfig.notifyAlert !== false;
  const notifyDevice = Boolean(barkConfig.notifyDevice);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费节点自动同步与转换服务 - ParseFree</title>
  <style>
    :root {
      --el-color-primary: #409eff; --el-color-success: #67c23a; --el-color-warning: #e6a23c;
      --el-color-info: #909399; --el-color-danger: #f56c6c; --el-bg-color: #f5f7fa;
      --el-text-primary: #303133; --el-text-regular: #606266; --el-text-secondary: #909399;
      --el-border-color: #dcdfe6; --el-border-light: #e4e7ed; --card-bg: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background-color: var(--el-bg-color); color: var(--el-text-primary);
      line-height: 1.6; padding: 24px 16px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .card { background: var(--card-bg); border: 1px solid var(--el-border-light); border-radius: 6px; padding: 20px 24px; margin-bottom: 20px; }
    .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid var(--el-color-primary); padding-left: 10px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .meta-item { background: #fafafa; border: 1px solid var(--el-border-light); padding: 12px; border-radius: 4px; }
    .meta-label { font-size: 12px; color: var(--el-text-secondary); margin-bottom: 4px; }
    .meta-value { font-size: 14px; font-weight: 600; word-break: break-all; }
    .input-group { display: flex; gap: 8px; margin-bottom: 12px; }
    .input-control { flex: 1; padding: 8px 12px; border: 1px solid var(--el-border-color); border-radius: 4px; font-size: 13px; background: #fafafa; color: var(--el-text-primary); }
    .btn { padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 500; border: 1px solid transparent; transition: all 0.2s; }
    .btn-primary { background: var(--el-color-primary); color: #fff; }
    .btn-primary:hover { background: #66b1ff; }
    .btn-default { background: #fff; border-color: var(--el-border-color); color: var(--el-text-regular); }
    .btn-default:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
    .node-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--el-border-light); border-radius: 4px; }
    .node-item { padding: 9px 12px; font-size: 12px; font-family: monospace; border-bottom: 1px solid var(--el-border-light); word-break: break-all; background: #fff; }
    .node-item:nth-child(even) { background: #fafafa; }
    .tag { display: inline-block; padding: 2px 6px; font-size: 11px; border-radius: 3px; font-weight: 600; margin-right: 8px; }
    .tag-vmess { background: #ecf5ff; color: #409eff; border: 1px solid #d9ecff; }
    .tag-ss { background: #f0f9eb; color: #67c23a; border: 1px solid #e1f3d8; }
    .tag-anytls { background: #fdf6ec; color: #e6a23c; border: 1px solid #faecd8; }
    .tag-other { background: #f4f4f5; color: #909399; border: 1px solid #e9e9eb; }
    .radio-label { margin-right: 18px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #fff; padding: 8px 18px; border-radius: 4px; font-size: 13px; display: none; z-index: 9999; }
  </style>
</head>
<body>
  <div class="toast" id="toast">复制成功</div>
  <div class="container">
    <div class="card" style="margin-bottom: 16px;">
      <h1 style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">ParseFree 免费节点自动同步与转换服务</h1>
      <p style="font-size: 13px; color: var(--el-text-regular);">每日00点后自动更新地址，一旦获取成功自动停止探测并锁定。首节点附带日期标识，失败期间自动回退最新有效数据。</p>
    </div>

    <!-- 1. 运行状态卡片 -->
    <div class="card">
      <div class="card-title">当前同步状态</div>
      <div class="meta-grid">
        <div class="meta-item"><div class="meta-label">已解析可用节点</div><div class="meta-value" style="color: var(--el-color-success);">${nodeCount} 个</div></div>
        <div class="meta-item"><div class="meta-label">数据来源日期</div><div class="meta-value">${sourceDate} (${isAutoMode ? (isToday ? "今日已锁定" : "自动回退中") : "手动"})</div></div>
        <div class="meta-item"><div class="meta-label">探测与回退状态</div><div class="meta-value" style="font-size: 13px; color: ${isToday ? 'var(--el-color-success)' : 'var(--el-color-warning)'};">${statusMsg || (isToday ? "已成功锁定今日数据" : "自动回退使用最新有效数据")}</div></div>
        <div class="meta-item"><div class="meta-label">安全鉴权状态</div><div class="meta-value" style="color: ${isProtected ? 'var(--el-color-success)' : 'var(--el-color-info)'};">${isProtected ? "已开启密码保护" : "公开访问"}</div></div>
        <div class="meta-item"><div class="meta-label">本次请求 (北京时间)</div><div class="meta-value" style="font-size: 13px;">${lastReqTime}</div></div>
        <div class="meta-item"><div class="meta-label">下一次请求 (北京时间)</div><div class="meta-value" style="font-size: 13px; color: var(--el-color-primary);">${nextReqTime} ${isToday ? "(明日0点)" : "(重试探测)"}</div></div>
        <div class="meta-item"><div class="meta-label">距离下一次请求倒计时</div><div class="meta-value" id="countdownBox" style="font-size: 14px; font-weight: 700; color: var(--el-color-primary); font-family: monospace;">计算中...</div></div>
      </div>
      <div class="meta-label">当前生效的上游源地址：</div>
      <div style="font-size: 13px; color: var(--el-text-regular); font-family: monospace; word-break: break-all; margin-top: 4px;">${targetUrl}</div>
    </div>

    <!-- 2. 数据源模式设置与手动编辑卡片 -->
    <div class="card">
      <div class="card-title">数据源模式与探测间隔设置</div>
      <div style="margin-bottom: 14px;">
        <span style="font-size: 13px; font-weight: 600; margin-right: 12px;">运行模式：</span>
        <label class="radio-label"><input type="radio" name="workMode" value="auto" ${isAutoMode ? "checked" : ""} onchange="switchMode('auto')"> 自动日期递增模式 (每日00点后自动更新)</label>
        <label class="radio-label"><input type="radio" name="workMode" value="manual" ${!isAutoMode ? "checked" : ""} onchange="switchMode('manual')"> 手动编辑指定地址模式</label>
      </div>
      <div style="margin-bottom: 14px;">
        <span style="font-size: 13px; font-weight: 600; margin-right: 12px;">源文件类型：</span>
        <label class="radio-label"><input type="radio" name="srcType" value="clash" ${!isV2ray ? "checked" : ""} onchange="switchType('clash')"> Clash (.yaml)</label>
        <label class="radio-label"><input type="radio" name="srcType" value="v2ray" ${isV2ray ? "checked" : ""} onchange="switchType('v2ray')"> V2Ray (.txt)</label>
      </div>
      <div id="manualBox" style="${isAutoMode ? 'display: none;' : ''}">
        <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 6px;">输入自定义或指定日期的节点订阅地址：</div>
        <div class="input-group">
          <input type="text" class="input-control" id="customInput" value="${targetUrl}" placeholder="例如: https://free.datiya.com/uploads/20261102-clash.yaml">
          <button class="btn btn-primary" onclick="applyManualUrl()">应用此地址</button>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
        <span style="font-size: 13px; color: var(--el-text-regular);">失败重试探测间隔 (分钟)：</span>
        <input type="number" min="1" max="1440" class="input-control" id="intervalInput" value="${retryMinutes}" style="width: 100px; flex: none;">
        <button class="btn btn-default" onclick="applyInterval()">更新间隔</button>
      </div>
    </div>

    <!-- 3. 自定义节点命名与广告清理卡片 -->
    <div class="card">
      <div class="card-title">节点命名与广告清理设置</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 12px;">
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">首节点名称 (将自动附带日期后2位)：</div>
          <input type="text" class="input-control" id="firstNameInput" value="${firstName}" style="width: 100%;">
          <div style="font-size: 11px; color: var(--el-text-secondary); margin-top: 2px;">例如数据源为 02日，首节点将自动显示为：“${firstName}02”</div>
        </div>
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">普通节点线路前缀：</div>
          <input type="text" class="input-control" id="prefixInput" value="${prefix}" style="width: 100%;">
          <div style="font-size: 11px; color: var(--el-text-secondary); margin-top: 2px;">后续所有节点前面都统一加上该前缀</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="applyRenameOptions()">应用命名规则</button>
    </div>

    <!-- 4. 订阅地址获取卡片 -->
    <div class="card">
      <div class="card-title">客户端订阅链接</div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">1. Base64 订阅链接 (🔥 推荐小火箭 Shadowrocket / v2rayN 导入，全量同步覆盖备注)：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="b64SubInput" value="${b64SubUrl}">
          <button class="btn btn-primary" onclick="copyText('${b64SubUrl}')">复制 Base64 订阅</button>
        </div>
      </div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">2. 通用明文订阅链接 (单行 URI 格式，与 格式.txt 一致)：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="subInput" value="${subUrl}">
          <button class="btn btn-default" onclick="copyText('${subUrl}')">复制明文链接</button>
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
        <button class="btn btn-primary" onclick="copyAllNodes()">一键复制全部 ${nodeCount} 个节点链接</button>
        <button class="btn btn-default" onclick="forceRefreshData()">强制刷新源数据并穿透缓存</button>
      </div>
      <div style="background: #fdf6ec; border: 1px solid #faecd8; border-radius: 4px; padding: 10px 12px; font-size: 12px; color: #e6a23c; line-height: 1.5;">
        <strong>💡 小火箭更新提示：</strong>小火箭对已导入过的节点默认会保留本地旧备注。若小火箭拉取后名称未更新，建议在小火箭中<strong>左滑删除旧订阅重新添加</strong>，或优先使用上方 <strong>Base64 订阅链接</strong> 下拉刷新。
      </div>
    </div>

    <!-- 5. Bark 配置卡片 -->
    <div class="card">
      <div class="card-title">Bark 配置</div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">服务器地址</div>
        <input type="text" class="input-control" id="barkServerInput" value="${barkServer}" placeholder="例如: https://apple.hertzhe.dpdns.org" style="width: 100%;">
      </div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">设备Key</div>
        <input type="text" class="input-control" id="barkKeyInput" value="${barkKey}" placeholder="例如: fyvLzgWrWJKraAkhSa7EUc" style="width: 100%;">
      </div>
      <div style="margin-bottom: 14px; font-size: 13px;">
        <label class="radio-label"><input type="checkbox" id="barkNotifySuccess" ${notifySuccess ? 'checked' : ''}> 每日更新成功推送</label>
        <label class="radio-label"><input type="checkbox" id="barkNotifyAlert" ${notifyAlert ? 'checked' : ''}> 9/12/18点未发布告警</label>
        <label class="radio-label"><input type="checkbox" id="barkNotifyDevice" ${notifyDevice ? 'checked' : ''}> 设备拉取节点通知 (5分钟防抖)</label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-primary" onclick="saveBarkConfig()">保存配置</button>
        <button class="btn btn-default" style="background: #5a626d; color: #fff;" onclick="testBarkNotification()">测试通知</button>
      </div>
    </div>

    <!-- 6. 节点列表预览卡片 -->
    <div class="card">
      <div class="card-title">节点明细预览 (${nodeCount})</div>
      <div class="node-list">
        ${nodes.map(n => {
          const proto = (n.split("://")[0] || "node").toLowerCase();
          let cls = "tag-other";
          if (proto === "vmess") cls = "tag-vmess";
          else if (proto === "ss") cls = "tag-ss";
          else if (proto === "anytls") cls = "tag-anytls";
          return `<div class="node-item"><span class="tag ${cls}">${proto.toUpperCase()}</span>${n}</div>`;
        }).join("")}
      </div>
    </div>
  </div>

  <script>
    const allNodes = ${escapedNodes};
    let leftSec = ${countdownSec};
    function updateCountdown() {
      const el = document.getElementById("countdownBox");
      if (!el) return;
      if (leftSec <= 0) { el.innerText = "00分00秒 (已到期可探测)"; return; }
      const h = Math.floor(leftSec / 3600);
      const m = Math.floor((leftSec % 3600) / 60);
      const s = leftSec % 60;
      el.innerText = (h > 0 ? h + "小时" : "") + String(m).padStart(2, "0") + "分" + String(s).padStart(2, "0") + "秒";
      leftSec--;
    }
    updateCountdown();
    setInterval(updateCountdown, 1000);

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg; t.style.display = "block";
      setTimeout(() => { t.style.display = "none"; }, 2000);
    }
    function copyText(val) {
      navigator.clipboard.writeText(val).then(() => showToast("已复制到剪贴板")).catch(() => prompt("请复制：", val));
    }
    function copyAllNodes() { copyText(allNodes.join("\\n")); }

    function forceRefreshData() {
      const u = new URL(window.location.href);
      u.searchParams.set("refresh", "1");
      window.location.href = u.toString();
    }
    async function testBarkNotification() {
      const server = document.getElementById("barkServerInput").value.trim();
      const key = document.getElementById("barkKeyInput").value.trim();
      if (!key) return alert("请先填写设备Key");
      showToast("正在发送测试通知...");
      try {
        const res = await fetch("/api/test-bark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server, key }) });
        const d = await res.json();
        if (d.success) showToast("✓ 测试通知已成功送达 Bark"); else alert("测试失败: " + (d.error || "未知错误"));
      } catch (e) { alert("网络异常: " + e.message); }
    }
    async function saveBarkConfig() {
      const barkServer = document.getElementById("barkServerInput").value.trim();
      const barkKey = document.getElementById("barkKeyInput").value.trim();
      const notifySuccess = document.getElementById("barkNotifySuccess").checked;
      const notifyAlert = document.getElementById("barkNotifyAlert").checked;
      const notifyDevice = document.getElementById("barkNotifyDevice").checked;
      try {
        const res = await fetch("/api/save-bark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ barkServer, barkKey, notifySuccess, notifyAlert, notifyDevice }) });
        const d = await res.json();
        if (d.success) showToast("✓ Bark 配置已成功保存至 KV"); else alert("保存提示: " + (d.error || "未绑定 KV，请直接在 CF 环境变量中设置"));
      } catch (e) { alert("保存失败: " + e.message); }
    }
    function switchMode(m) {
      document.getElementById("manualBox").style.display = m === "manual" ? "block" : "none";
      if (m === "auto") { const u = new URL(window.location.href); u.searchParams.delete("source"); u.searchParams.delete("mode"); window.location.href = u.toString(); }
    }
    function switchType(t) { const u = new URL(window.location.href); u.searchParams.set("type", t); window.location.href = u.toString(); }
    function applyManualUrl() {
      const val = document.getElementById("customInput").value.trim();
      if (!val) return alert("请输入有效地址");
      const u = new URL(window.location.href); u.searchParams.set("source", val); window.location.href = u.toString();
    }
    function applyInterval() {
      const val = document.getElementById("intervalInput").value.trim();
      const u = new URL(window.location.href); if (val) u.searchParams.set("retry_interval", val); window.location.href = u.toString();
    }
    function applyRenameOptions() {
      const fn = document.getElementById("firstNameInput").value.trim();
      const p = document.getElementById("prefixInput").value;
      const u = new URL(window.location.href);
      if (fn) u.searchParams.set("first_name", fn); else u.searchParams.delete("first_name");
      if (p) u.searchParams.set("prefix", p); else u.searchParams.delete("prefix");
      window.location.href = u.toString();
    }
  </script>
</body>
</html>`;
}

// ==================== 9. Worker 主入口 ====================
/**
 * Cloudflare Worker 主入口
 * 支持 HTTP 请求路由处理与 Cron 定时事件监听 (scheduled)
 */









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
