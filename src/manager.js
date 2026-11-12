/**
 * 订阅源与每日更新状态管理模块
 * 支持自动日期递增、失败重试间隔退避、失败期间自动回退最新有效数据与成功后锁定停止机制
 */

import {
  getBeijingDate,
  formatDate,
  DEFAULT_BASE_URL,
  formatBeijingDateTime,
  computeTimingMeta
} from "./utils.js";
import { sendSuccessPush, sendAlertPush } from "./bark.js";

export const DEFAULT_RETRY_INTERVAL_MINUTES = 10;

// 内存中记录的最新状态缓存
let memoryState = {
  date: "", type: "clash", isTodayReady: false, targetUrl: "", content: "",
  lastSuccessTime: 0, lastFailedTime: 0, lastRequestTime: 0, dataVersion: 1,
  lastNotifiedSuccessDate: "", lastAlertSlots: []
};

export const getCacheVersion = () => memoryState.dataVersion || 1;
export const bumpCacheVersion = () => (memoryState.dataVersion = Date.now());

export async function isAlreadyNotified(tag, ttl = 86400) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (!cache) return false;
  try {
    const req = new Request(`https://parsefree.internal/${tag}`);
    const hit = await cache.match(req);
    if (hit) return true;
    await cache.put(req, new Response("1", { headers: { "Cache-Control": `public, max-age=${ttl}` } }));
  } catch (e) {}
  return false;
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

export function buildSourceUrl(dateStr, type = "clash", baseUrl = DEFAULT_BASE_URL) {
  const ext = type.toLowerCase() === "v2ray" ? "v2ray.txt" : "clash.yaml";
  return `${baseUrl}/uploads/${dateStr}-${ext}`;
}

export async function getSavedConfig(env = {}) {
  let s = {};
  const kv = env.PARSEFREE_KV || env.KV;
  if (kv && typeof kv.get === "function") {
    try { s = (await kv.get("PARSEFREE_CONFIG", { type: "json" })) || {}; } catch (e) {}
  }
  return {
    mode: s.mode || env.SOURCE_MODE || "auto",
    type: s.type || env.SOURCE_TYPE || "clash",
    manualUrl: s.manualUrl || env.CUSTOM_SOURCE_URL || "",
    retryInterval: Number(s.retryInterval || env.RETRY_INTERVAL_MINUTES) || DEFAULT_RETRY_INTERVAL_MINUTES,
    barkServer: s.barkServer || env.BARK_SERVER || "",
    barkKey: s.barkKey || env.BARK_KEY || "",
    notifySuccess: s.notifySuccess !== undefined ? Boolean(s.notifySuccess) : (env.BARK_NOTIFY_SUCCESS !== "0"),
    notifyAlert: s.notifyAlert !== undefined ? Boolean(s.notifyAlert) : (env.BARK_NOTIFY_ALERT !== "0"),
    notifyDevice: s.notifyDevice !== undefined ? Boolean(s.notifyDevice) : (env.BARK_NOTIFY_DEVICE !== "0")
  };
}

export async function saveConfig(env = {}, newConfig = {}) {
  const kv = env.PARSEFREE_KV || env.KV;
  if (kv && typeof kv.put === "function") {
    const current = await getSavedConfig(env);
    const updated = { ...current, ...newConfig };
    await kv.put("PARSEFREE_CONFIG", JSON.stringify(updated));
    return { success: true, kvBound: true, config: updated };
  }
  return { success: true, kvBound: false, message: "本地已保存，全局建议配置在CF环境变量" };
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
export async function resolveSubscriptionData({
  requestedSource = "", requestedType = "", requestedInterval = null,
  forceRefresh = false, env = {}, ctx = null, triggerSource = "订阅拉取触发"
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
        const already = await isAlreadyNotified(`success-${todayStr}`, 86400);
        if (!already) {
          const p = sendSuccessPush({ todayStr, sourceType: cType, triggerSource, env, savedConfig });
          if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p); else await p;
        }
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
          dataVersion: memoryState.dataVersion || 1, lastNotifiedSuccessDate: memoryState.lastNotifiedSuccessDate, lastAlertSlots: memoryState.lastAlertSlots
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
export async function handleScheduledTask(env = {}, ctx = null) {
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);
  const bjHour = bjNow.getHours();
  const savedConfig = await getSavedConfig(env);

  let data = null;
  try {
    data = await resolveSubscriptionData({ forceRefresh: true, env, ctx, triggerSource: "定时巡检" });
  } catch (err) {
    console.warn(`[Cron] 探测今日源异常:`, err.message);
  }

  if (data && data.isToday) {
    const already = await isAlreadyNotified(`success-${todayStr}`, 86400);
    if (!already) {
      const p = sendSuccessPush({ todayStr, sourceType: data.type || savedConfig.type || "clash", triggerSource: "定时巡检", env, savedConfig });
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p); else await p;
    }
    return { success: true, isToday: true, date: todayStr, message: `今日新源已锁定 [${todayStr}]` };
  }

  if ([9, 12, 18].includes(bjHour)) {
    const already = await isAlreadyNotified(`alert-${todayStr}-${bjHour}`, 7200);
    if (!already) {
      const p = sendAlertPush({
        hour: bjHour, todayStr, fallbackDate: (data && data.sourceDate) || memoryState.date || "最新有效",
        retryMinutes: savedConfig.retryInterval, env, savedConfig
      });
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p); else await p;
    }
  }
  return { success: true, isToday: false, date: (data && data.sourceDate) || memoryState.date, message: "今日新源待发布，已回退数据" };
}
