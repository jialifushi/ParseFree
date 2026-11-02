/**
 * 通用工具与 Base64 编解码助手
 * 兼容 Node.js 与 Cloudflare Worker 运行环境
 */

export const DEFAULT_BASE_URL = "https://free.datiya.com";

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
 * 获取当前北京时间 (UTC+8) 的 Date 对象
 */
export function getBeijingDate() {
  const now = new Date();
  return new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
}

/**
 * 将 Date 对象格式化为 YYYYMMDD 字符串
 */
export function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}
