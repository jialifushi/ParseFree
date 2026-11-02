/**
 * 节点配置与订阅文本解析模块
 * 提供轻量无外部依赖的 Clash Flow/Block YAML 解析及通用订阅识别
 */

import { proxyToUri } from "./formatter.js";
import { fromBase64 } from "./utils.js";

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
 * 智能解析订阅数据（支持 Clash YAML、Base64 订阅、纯文本链接列表）
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
