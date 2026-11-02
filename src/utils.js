/**
 * 通用工具与 Base64 编解码助手
 * 兼容 Node.js 与 Cloudflare Worker 运行环境
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
