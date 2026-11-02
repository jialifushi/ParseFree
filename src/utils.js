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

/**
 * 格式化时间戳为北京时间 (UTC+8) 字符串: YYYY-MM-DD HH:mm:ss
 */
export function formatBeijingDateTime(epochMs) {
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
export function getNextDayMidnightEpochMs(nowMs = Date.now()) {
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
export function computeTimingMeta({
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
