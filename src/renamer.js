/**
 * 节点名称清洗与自定义重命名模块
 * 1. 识别并清理源数据中的广告/宣传信息（如 "tg频道:@freenodedaily"），替换为指定的首节点名称
 * 2. 首节点自动追加数据来源日期的“日”部分（如 20261102 -> "HOS Daily官方维护02"），一目了然识别今日是否已更新
 * 3. 为其他所有节点自动增加指定前缀（如 "HOS自动化线路 "）
 * 4. 支持环境变量与 URL 参数深度自定义
 */

import { toBase64, fromBase64 } from "./utils.js";

export const DEFAULT_FIRST_NODE_NAME = "HOS Daily官方维护";
export const DEFAULT_NODE_PREFIX = "HOS自动化线路 ";

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
export function isAdvertisement(name = "", index = 0) {
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
export function formatNodeDisplayName(rawName = "", index = 0, {
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
export function renameUriNode(uri, index = 0, options = {}) {
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
export function processAndRenameNodes(nodes = [], options = {}) {
  return nodes.map((nodeUri, idx) => renameUriNode(nodeUri, idx, options));
}
