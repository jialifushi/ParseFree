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
 * 支持自动日期递增模式、V2Ray/Clash源切换、手动编辑地址及成功获取后停止探测机制
 */



// 内存中记录的最新状态缓存
let memoryState = {
  date: "",           // 当前缓存数据的日期 (YYYYMMDD)
  type: "clash",      // 请求的源类型: clash | v2ray
  isTodayReady: false,// 今天的数据是否已成功拿到（一旦拿到即锁定，停止定时探测）
  targetUrl: "",      // 实际使用的源地址
  content: "",        // 源订阅文本内容
  lastCheckTime: 0    // 最近探测检查时间戳
};

/**
 * 根据日期和类型构造源地址
 */
function buildSourceUrl(dateStr, type = "clash", baseUrl = DEFAULT_BASE_URL) {
  const ext = type.toLowerCase() === "v2ray" ? "v2ray.txt" : "clash.yaml";
  return `${baseUrl}/uploads/${dateStr}-${ext}`;
}

/**
 * 从 KV 或环境变量中加载手动保存的持久化配置
 */
async function getSavedConfig(env = {}) {
  const kv = env.PARSEFREE_KV || env.KV;
  if (kv && typeof kv.get === "function") {
    try {
      const saved = await kv.get("PARSEFREE_CONFIG", { type: "json" });
      if (saved) return saved;
    } catch (e) {}
  }
  return {
    mode: env.SOURCE_MODE || "auto",
    type: env.SOURCE_TYPE || "clash",
    manualUrl: env.CUSTOM_SOURCE_URL || ""
  };
}

/**
 * 尝试抓取指定 URL 并验证内容有效性
 */
async function fetchValidContent(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ClashforWindows/0.20.39", "Accept": "*/*" }
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 50) {
        return text;
      }
    }
  } catch (err) {}
  return null;
}

/**
 * 智能获取订阅数据（核心状态机）
 * 每天00点之后自动更新目标日期，一旦成功拿到今天的数据即停止探测并锁定
 */
async function resolveSubscriptionData({
  requestedSource = "",
  requestedType = "",
  forceRefresh = false,
  env = {}
}) {
  const savedConfig = await getSavedConfig(env);
  const type = (requestedType || savedConfig.type || "clash").toLowerCase();
  const manualUrl = requestedSource || (savedConfig.mode === "manual" ? savedConfig.manualUrl : "");

  // 1. 手动模式：直接使用指定地址
  if (manualUrl) {
    const res = await fetch(manualUrl, {
      headers: { "User-Agent": "ClashforWindows/0.20.39", "Accept": "*/*" }
    });
    if (!res.ok) throw new Error(`手动源获取失败 [HTTP ${res.status}]: ${manualUrl}`);
    const content = await res.text();
    const dateMatch = manualUrl.match(/(\d{8})/);
    return {
      content,
      targetUrl: manualUrl,
      sourceDate: dateMatch ? dateMatch[1] : "manual",
      isToday: true,
      mode: "manual",
      type
    };
  }

  // 2. 自动模式：基于当前北京时间 (UTC+8) 的日期自动递增
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);

  // 检查内存中是否已拿到今天的数据且类型一致
  if (!forceRefresh && memoryState.isTodayReady && memoryState.date === todayStr && memoryState.type === type && memoryState.content) {
    return {
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: true,
      mode: "auto",
      type
    };
  }

  // 候选类型列表：若指定 v2ray，当 v2ray 为空时自动降级回退到 clash 兜底
  const candidateTypes = type === "v2ray" ? ["v2ray", "clash"] : ["clash"];

  // 3. 优先探测当天的最新地址
  for (const cType of candidateTypes) {
    const todayUrl = buildSourceUrl(todayStr, cType);
    const content = await fetchValidContent(todayUrl);
    if (content) {
      memoryState = {
        date: todayStr,
        type,
        isTodayReady: true, // 锁定今日就绪，后续停止探测
        targetUrl: todayUrl,
        content,
        lastCheckTime: Date.now()
      };
      return {
        content,
        targetUrl: todayUrl,
        sourceDate: todayStr,
        isToday: true,
        mode: "auto",
        type
      };
    }
  }

  // 4. 当天新文件尚未上传（如凌晨404）-> 容错回退机制，依次尝试昨日、前日
  for (let offset = 1; offset <= 3; offset++) {
    const pastDate = new Date(bjNow.getTime() - offset * 86400000);
    const pastDateStr = formatDate(pastDate);

    for (const cType of candidateTypes) {
      const pastUrl = buildSourceUrl(pastDateStr, cType);
      const content = await fetchValidContent(pastUrl);
      if (content) {
        memoryState = {
          date: pastDateStr,
          type,
          isTodayReady: false, // 标记今天数据尚未 ready，下次请求或 cron 将继续探测
          targetUrl: pastUrl,
          content,
          lastCheckTime: Date.now()
        };
        return {
          content,
          targetUrl: pastUrl,
          sourceDate: pastDateStr,
          isToday: false, // 说明当前是回退数据
          mode: "auto",
          type
        };
      }
    }
  }

  throw new Error(`无法获取可用节点数据，已尝试探测今日 [${todayStr}] 及前 3 日源均无响应。`);
}

/**
 * 定时任务 (Cron Trigger) 触发执行函数
 * 仅当今天数据尚未拿到时才触发网络探测，一旦拿到立刻停止探测
 */
async function handleScheduledTask(env = {}) {
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);

  // 若今日数据已就绪，直接跳过本次定时获取
  if (memoryState.isTodayReady && memoryState.date === todayStr) {
    console.log(`[Cron] 今日数据已锁定 [${todayStr}]，无需重复探测。`);
    return;
  }

  console.log(`[Cron] 开始探测今日订阅数据 [${todayStr}]...`);
  try {
    await resolveSubscriptionData({ forceRefresh: true, env });
    if (memoryState.isTodayReady) {
      console.log(`[Cron] 成功获取今日最新数据 [${todayStr}]，已锁定停止探测！`);
    }
  } catch (err) {
    console.warn(`[Cron] 今日数据暂未上传，保持回退状态:`, err.message);
  }
}

// ==================== 6. 节点名称清洗与重命名模块 ====================
/**
 * 节点名称清洗与自定义重命名模块
 * 1. 识别并清理源数据中的广告/宣传信息（如 "tg频道:@freenodedaily"），替换为指定的首节点名称
 * 2. 为其他所有节点自动增加指定前缀（如 "HOS自动化线路 "）
 * 3. 支持环境变量 (FIRST_NODE_NAME / NODE_PREFIX) 与 URL 参数自定义
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
  // 若是首个节点且包含 tg 或 @ 符号，直接判定为宣传节点
  if (index === 0 && /(tg|@|http|频道|群)/i.test(name)) {
    return true;
  }
  return AD_PATTERNS.some(p => p.test(name));
}

/**
 * 格式化单个节点的名称
 */
function formatNodeDisplayName(rawName = "", index = 0, {
  firstName = DEFAULT_FIRST_NODE_NAME,
  prefix = DEFAULT_NODE_PREFIX
} = {}) {
  const trimmed = rawName.trim();
  // 命中广告特征或者是首个宣传节点
  if (isAdvertisement(trimmed, index)) {
    return firstName || DEFAULT_FIRST_NODE_NAME;
  }
  // 普通节点：若尚未包含该前缀，则添加前缀
  if (prefix && !trimmed.startsWith(prefix.trim())) {
    return `${prefix}${trimmed}`;
  }
  return trimmed;
}

/**
 * 重写标准节点 URI 链接中的节点名称
 * 支持 VMess (JSON ps 字段)、SS/Trojan/VLESS/AnyTLS (URI # 哈希名称)
 */
function renameUriNode(uri, index = 0, options = {}) {
  if (!uri || typeof uri !== "string") return uri;

  // 1. VMess 协议 URI
  if (uri.startsWith("vmess://")) {
    try {
      const b64 = uri.slice(8).trim();
      const jsonStr = fromBase64(b64);
      const vmessObj = JSON.parse(jsonStr);
      const currentName = vmessObj.ps || "";
      vmessObj.ps = formatNodeDisplayName(currentName, index, options);
      return "vmess://" + toBase64(JSON.stringify(vmessObj));
    } catch (e) {
      return uri;
    }
  }

  // 2. 其它带有 # 备注名称的标准 URI (ss://, trojan://, vless://, anytls://, etc.)
  const hashIdx = uri.indexOf("#");
  if (hashIdx !== -1) {
    const basePart = uri.substring(0, hashIdx);
    const rawNameEncoded = uri.substring(hashIdx + 1);
    let rawName = "";
    try {
      rawName = decodeURIComponent(rawNameEncoded);
    } catch (e) {
      rawName = rawNameEncoded;
    }
    const newName = formatNodeDisplayName(rawName, index, options);
    return `${basePart}#${encodeURIComponent(newName)}`;
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
  renameOptions = {}
}) {
  const nodeCount = nodes.length;
  const escapedNodes = JSON.stringify(nodes);
  const isProtected = Boolean(authInfo.active);
  const isAutoMode = mode !== "manual";
  const isV2ray = type === "v2ray";
  const firstName = renameOptions.firstName || "HOS Daily官方维护";
  const prefix = renameOptions.prefix !== undefined ? renameOptions.prefix : "HOS自动化线路 ";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费节点自动同步与转换服务 - ParseFree</title>
  <style>
    :root {
      --el-color-primary: #409eff;
      --el-color-success: #67c23a;
      --el-color-warning: #e6a23c;
      --el-color-info: #909399;
      --el-color-danger: #f56c6c;
      --el-bg-color: #f5f7fa;
      --el-text-primary: #303133;
      --el-text-regular: #606266;
      --el-text-secondary: #909399;
      --el-border-color: #dcdfe6;
      --el-border-light: #e4e7ed;
      --card-bg: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background-color: var(--el-bg-color); color: var(--el-text-primary);
      line-height: 1.6; padding: 24px 16px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .card {
      background: var(--card-bg); border: 1px solid var(--el-border-light);
      border-radius: 6px; padding: 20px 24px; margin-bottom: 20px;
    }
    .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid var(--el-color-primary); padding-left: 10px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .meta-item { background: #fafafa; border: 1px solid var(--el-border-light); padding: 12px; border-radius: 4px; }
    .meta-label { font-size: 12px; color: var(--el-text-secondary); margin-bottom: 4px; }
    .meta-value { font-size: 14px; font-weight: 600; word-break: break-all; }
    .input-group { display: flex; gap: 8px; margin-bottom: 12px; }
    .input-control {
      flex: 1; padding: 8px 12px; border: 1px solid var(--el-border-color);
      border-radius: 4px; font-size: 13px; background: #fafafa; color: var(--el-text-primary);
    }
    .btn {
      padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer;
      font-weight: 500; border: 1px solid transparent; transition: all 0.2s;
    }
    .btn-primary { background: var(--el-color-primary); color: #fff; }
    .btn-primary:hover { background: #66b1ff; }
    .btn-default { background: #fff; border-color: var(--el-border-color); color: var(--el-text-regular); }
    .btn-default:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
    .node-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--el-border-light); border-radius: 4px; }
    .node-item {
      padding: 9px 12px; font-size: 12px; font-family: monospace;
      border-bottom: 1px solid var(--el-border-light); word-break: break-all; background: #fff;
    }
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
      <p style="font-size: 13px; color: var(--el-text-regular);">每日00点后自动更新地址，一旦获取成功自动停止探测并锁定。广告信息自动清理，节点名称统一规范化。</p>
    </div>

    <!-- 1. 运行状态卡片 -->
    <div class="card">
      <div class="card-title">当前同步状态</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">已解析可用节点</div>
          <div class="meta-value" style="color: var(--el-color-success);">${nodeCount} 个</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">数据来源与日期</div>
          <div class="meta-value">${sourceDate} (${isAutoMode ? (isToday ? "今日已锁定" : "自动回退中") : "手动"})</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">源文件格式</div>
          <div class="meta-value">${isV2ray ? "V2Ray 格式 (.txt)" : "Clash 格式 (.yaml)"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">安全鉴权状态</div>
          <div class="meta-value" style="color: ${isProtected ? 'var(--el-color-success)' : 'var(--el-color-info)'};">${isProtected ? "已开启密码保护" : "公开访问"}</div>
        </div>
      </div>
      <div class="meta-label">当前生效的上游源地址：</div>
      <div style="font-size: 13px; color: var(--el-text-regular); font-family: monospace; word-break: break-all; margin-top: 4px;">${targetUrl}</div>
    </div>

    <!-- 2. 数据源模式设置与手动编辑卡片 -->
    <div class="card">
      <div class="card-title">数据源模式与手动编辑</div>
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
    </div>

    <!-- 3. 自定义节点命名与广告清理卡片 -->
    <div class="card">
      <div class="card-title">节点命名与广告清理设置</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 12px;">
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 6px;">首节点 / 广告宣传替换名称：</div>
          <input type="text" class="input-control" id="firstNameInput" value="${firstName}" style="width: 100%;">
        </div>
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 6px;">普通节点线路前缀：</div>
          <input type="text" class="input-control" id="prefixInput" value="${prefix}" style="width: 100%;">
        </div>
      </div>
      <button class="btn btn-primary" onclick="applyRenameOptions()">应用节点命名规则</button>
    </div>

    <!-- 4. 订阅地址获取卡片 -->
    <div class="card">
      <div class="card-title">客户端订阅链接</div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">1. 通用明文订阅链接 (与 格式.txt 一致，导入小火箭 / v2rayN / sing-box)：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="subInput" value="${subUrl}">
          <button class="btn btn-primary" onclick="copyText('${subUrl}')">复制订阅链接</button>
        </div>
      </div>
      <div style="margin-bottom: 14px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">2. Base64 编码订阅链接 (兼容仅认 base64 的旧版客户端)：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="b64SubInput" value="${b64SubUrl}">
          <button class="btn btn-default" onclick="copyText('${b64SubUrl}')">复制 Base64 链接</button>
        </div>
      </div>
      <button class="btn btn-primary" onclick="copyAllNodes()">一键复制全部 ${nodeCount} 个节点链接</button>
    </div>

    <!-- 5. 节点列表预览卡片 -->
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
    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg; t.style.display = "block";
      setTimeout(() => { t.style.display = "none"; }, 2000);
    }
    function copyText(val) {
      navigator.clipboard.writeText(val).then(() => showToast("已复制到剪贴板")).catch(() => prompt("请复制：", val));
    }
    function copyAllNodes() { copyText(allNodes.join("\\n")); }

    function switchMode(m) {
      document.getElementById("manualBox").style.display = m === "manual" ? "block" : "none";
      if (m === "auto") {
        const u = new URL(window.location.href);
        u.searchParams.delete("source"); u.searchParams.delete("mode");
        window.location.href = u.toString();
      }
    }
    function switchType(t) {
      const u = new URL(window.location.href);
      u.searchParams.set("type", t);
      window.location.href = u.toString();
    }
    function applyManualUrl() {
      const val = document.getElementById("customInput").value.trim();
      if (!val) return alert("请输入有效地址");
      const u = new URL(window.location.href);
      u.searchParams.set("source", val);
      window.location.href = u.toString();
    }
    function applyRenameOptions() {
      const fn = document.getElementById("firstNameInput").value.trim();
      const p = document.getElementById("prefixInput").value;
      const u = new URL(window.location.href);
      if (fn) u.searchParams.set("first_name", fn);
      else u.searchParams.delete("first_name");
      if (p) u.searchParams.set("prefix", p);
      else u.searchParams.delete("prefix");
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

    // 2. 提取请求参数
    const requestedSource = searchParams.get("source") || searchParams.get("url") || "";
    const requestedType = searchParams.get("type") || ""; // clash | v2ray
    const format = (searchParams.get("format") || "").toLowerCase();
    const isB64 = searchParams.get("b64") === "1" || searchParams.get("b64") === "true" || format === "base64" || format === "b64";
    const filterKeyword = searchParams.get("filter") || "";
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1";

    // 节点自定义名称与前缀参数（支持环境变量与 URL 参数）
    const firstName = searchParams.get("first_name") || searchParams.get("ad_name") || env.FIRST_NODE_NAME || DEFAULT_FIRST_NODE_NAME;
    const prefix = searchParams.get("prefix") !== null ? searchParams.get("prefix") : (env.NODE_PREFIX !== undefined ? env.NODE_PREFIX : DEFAULT_NODE_PREFIX);

    // 3. 边缘缓存处理 (Cloudflare Cache API)
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cacheKey = new Request(url.toString(), request);
    if (cache && !forceRefresh && request.method === "GET") {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    try {
      // 4. 解析与获取订阅数据（智能日期状态机或手动模式）
      const data = await resolveSubscriptionData({
        requestedSource,
        requestedType,
        forceRefresh,
        env
      });
      let nodes = parseSubscription(data.content);

      // 5. 广告宣传信息清洗与节点自定义重命名
      nodes = processAndRenameNodes(nodes, { firstName, prefix });

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
          "Cache-Control": "public, max-age=1800",
          "Access-Control-Allow-Origin": "*",
          "X-Total-Nodes": String(nodes.length),
          "X-Source-Date": encodeURIComponent(String(data.sourceDate || "unknown")),
          "X-Source-Type": encodeURIComponent(String(data.type))
        };

        const response = new Response(bodyText, { status: 200, headers });
        if (cache && ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(cache.put(cacheKey, response.clone()));
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

      const queryStr = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
      const b64QueryStr = queryParts.length > 0 ? `?b64=1&${queryParts.join("&")}` : "?b64=1";

      const subUrl = `${baseUrl}/sub${queryStr}`;
      const b64SubUrl = `${baseUrl}/sub${b64QueryStr}`;

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
        renameOptions: { firstName, prefix }
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
