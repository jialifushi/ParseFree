/**
 * 节点解析与格式转换模块
 * 将 Clash YAML 配置及各类代理协议转换为通用节点链接（格式.txt 结构）
 */

/**
 * 基础 Base64 编码解码助手（兼容 Node.js 与 Web Worker）
 */
export function toBase64(str) {
  if (typeof btoa === "function") {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return btoa(str);
    }
  }
  return Buffer.from(str, "utf-8").toString("base64");
}

export function fromBase64(str) {
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
 * 解析 Flow 风格键值对（例如 {name: xxx, port: 443, ...}）
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
export function parseYamlProxies(yamlText) {
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
 * 将单个 Proxy 节点对象转换为标准通用节点链接
 */
export function proxyToUri(p) {
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

/**
 * 智能解析源数据（支持 Clash YAML、Base64 订阅、纯文本链接列表）
 */
export function parseSubscription(rawContent) {
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
