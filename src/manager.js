/**
 * 订阅源与每日更新状态管理模块
 * 支持自动日期递增模式、V2Ray/Clash源切换、手动编辑地址及成功获取后停止探测机制
 */

import { getBeijingDate, formatDate, DEFAULT_BASE_URL } from "./utils.js";

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
export function buildSourceUrl(dateStr, type = "clash", baseUrl = DEFAULT_BASE_URL) {
  const ext = type.toLowerCase() === "v2ray" ? "v2ray.txt" : "clash.yaml";
  return `${baseUrl}/uploads/${dateStr}-${ext}`;
}

/**
 * 从 KV 或环境变量中加载手动保存的持久化配置
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
export async function resolveSubscriptionData({
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
export async function handleScheduledTask(env = {}) {
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
