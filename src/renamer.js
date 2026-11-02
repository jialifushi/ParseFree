/**
 * 节点名称清洗与自定义重命名模块
 * 1. 识别并清理源数据中的广告/宣传信息（如 "tg频道:@freenodedaily"），替换为指定的首节点名称
 * 2. 为其他所有节点自动增加指定前缀（如 "HOS自动化线路 "）
 * 3. 支持环境变量 (FIRST_NODE_NAME / NODE_PREFIX) 与 URL 参数自定义
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
  // 若是首个节点且包含 tg 或 @ 符号，直接判定为宣传节点
  if (index === 0 && /(tg|@|http|频道|群)/i.test(name)) {
    return true;
  }
  return AD_PATTERNS.some(p => p.test(name));
}

/**
 * 格式化单个节点的名称
 */
export function formatNodeDisplayName(rawName = "", index = 0, {
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
export function renameUriNode(uri, index = 0, options = {}) {
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
export function processAndRenameNodes(nodes = [], options = {}) {
  return nodes.map((nodeUri, idx) => renameUriNode(nodeUri, idx, options));
}
