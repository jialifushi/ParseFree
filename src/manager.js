/**
 * 订阅源与每日更新状态管理模块
 * 支持自动日期递增、失败重试间隔退避、失败期间自动回退最新有效数据与成功后锁定停止机制
 */

import { getBeijingDate, formatDate, DEFAULT_BASE_URL } from "./utils.js";

export const DEFAULT_RETRY_INTERVAL_MINUTES = 10;

// 内存中记录的最新状态缓存
let memoryState = {
  date: "",            // 当前提供数据的日期 (YYYYMMDD)
  type: "clash",       // 源类型: clash | v2ray
  isTodayReady: false, // 今天的数据是否已成功拿到（一旦拿到即锁定，停止定时探测）
  targetUrl: "",       // 实际使用的源地址
  content: "",         // 源订阅文本内容
  lastSuccessTime: 0,  // 最近一次成功获取的时间戳
  lastFailedTime: 0    // 最近一次探测今日失败的时间戳
};

/**
 * 根据日期和类型构造源地址
 */
export function buildSourceUrl(dateStr, type = "clash", baseUrl = DEFAULT_BASE_URL) {
  const ext = type.toLowerCase() === "v2ray" ? "v2ray.txt" : "clash.yaml";
  return `${baseUrl}/uploads/${dateStr}-${ext}`;
}

/**
 * 从 KV 或环境变量中加载持久化配置
 */
export async function getSavedConfig(env = {}) {
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
    manualUrl: env.CUSTOM_SOURCE_URL || "",
    retryInterval: Number(env.RETRY_INTERVAL_MINUTES) || DEFAULT_RETRY_INTERVAL_MINUTES
  };
}

/**
 * 抓取指定 URL 并验证有效性
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
 * 智能解析订阅数据（状态机）
 * 每天00点后自动递增，失败按设定间隔重试，失败期间自动回退最新可用数据，成功后立刻停止探测
 */
export async function resolveSubscriptionData({
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
    return {
      content,
      targetUrl: manualUrl,
      sourceDate: dateMatch ? dateMatch[1] : "manual",
      isToday: true,
      mode: "manual",
      type,
      retryMinutes
    };
  }

  // 2. 自动模式：基于北京时间 (UTC+8) 的日期自动递增
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);

  // A. 今日数据已锁定：直接返回，完全停止探测
  if (!forceRefresh && memoryState.isTodayReady && memoryState.date === todayStr && memoryState.type === type && memoryState.content) {
    return {
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: true,
      mode: "auto",
      type,
      retryMinutes,
      statusMsg: "今日数据已锁定 (停止探测)"
    };
  }

  // B. 检查失败重试冷却期：若刚失败不久且已有可用回退数据，则暂不重复探测，直接回退返回最新数据
  const timeSinceLastFail = Date.now() - memoryState.lastFailedTime;
  const isCoolingDown = !forceRefresh && memoryState.lastFailedTime > 0 && timeSinceLastFail < retryCooldownMs;

  if (isCoolingDown && memoryState.content) {
    const waitSeconds = Math.ceil((retryCooldownMs - timeSinceLastFail) / 1000);
    return {
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: false,
      mode: "auto",
      type,
      retryMinutes,
      isCoolingDown: true,
      statusMsg: `今日源待发布，冷却重试中 (已回退，${waitSeconds} 秒后允许再次探测)`
    };
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
        lastFailedTime: 0
      };
      return {
        content,
        targetUrl: todayUrl,
        sourceDate: todayStr,
        isToday: true,
        mode: "auto",
        type,
        retryMinutes,
        statusMsg: "今日数据已成功获取并锁定"
      };
    }
  }

  // D. 探测今日失败 -> 记录失败时间戳，启动间隔退避
  memoryState.lastFailedTime = Date.now();

  // 若已有历史有效数据，立即自动回退返回
  if (memoryState.content && memoryState.type === type) {
    return {
      content: memoryState.content,
      targetUrl: memoryState.targetUrl,
      sourceDate: memoryState.date,
      isToday: false,
      mode: "auto",
      type,
      retryMinutes,
      statusMsg: `今日数据尚未上传，已自动回退使用 ${memoryState.date} 数据`
    };
  }

  // E. 内存无数据时，向前回退探测前 1~3 天有效数据兜底
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
          isTodayReady: false,
          targetUrl: pastUrl,
          content,
          lastSuccessTime: Date.now(),
          lastFailedTime: Date.now()
        };
        return {
          content,
          targetUrl: pastUrl,
          sourceDate: pastDateStr,
          isToday: false,
          mode: "auto",
          type,
          retryMinutes,
          statusMsg: `已自动回退使用 ${pastDateStr} 最新有效数据`
        };
      }
    }
  }

  throw new Error(`无法获取可用节点数据，探测今日 [${todayStr}] 及前 3 日源均无有效响应。`);
}

/**
 * 定时任务 (Cron Trigger) 处理函数
 * 遵循重试间隔限制，今日一旦成功获取立即停止探测
 */
export async function handleScheduledTask(env = {}) {
  const bjNow = getBeijingDate();
  const todayStr = formatDate(bjNow);

  if (memoryState.isTodayReady && memoryState.date === todayStr) {
    console.log(`[Cron] 今日数据已锁定 [${todayStr}]，停止探测。`);
    return;
  }

  const savedConfig = await getSavedConfig(env);
  const retryCooldownMs = (savedConfig.retryInterval || DEFAULT_RETRY_INTERVAL_MINUTES) * 60 * 1000;
  if (memoryState.lastFailedTime > 0 && Date.now() - memoryState.lastFailedTime < retryCooldownMs) {
    console.log(`[Cron] 尚在探测失败重试间隔内，暂不发起探测。`);
    return;
  }

  console.log(`[Cron] 间隔期已满，开始探测今日新源 [${todayStr}]...`);
  try {
    await resolveSubscriptionData({ forceRefresh: true, env });
  } catch (err) {
    console.warn(`[Cron] 今日新源尚未发布:`, err.message);
  }
}
