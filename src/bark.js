/**
 * Bark 推送服务模块
 * 支持每日更新成功通知、9/12/18点未发布告警与客户端拉取通知 (带 5 分钟防抖节流)
 */

export const DEFAULT_BARK_SERVER = "https://api.day.app";
export const DEFAULT_TITLE_PREFIX = "【ParseFree】";

// 内存中记录的客户端拉取节流缓存: Map<IP+UA, timestamp>
const clientFetchThrottleMap = new Map();

/**
 * 获取生效的 Bark 配置
 */
export function getBarkConfig(env = {}, kvConfig = {}) {
  const server = (kvConfig.barkServer || env.BARK_SERVER || DEFAULT_BARK_SERVER).replace(/\/+$/, "");
  const key = (kvConfig.barkKey || env.BARK_KEY || "").trim();
  const titlePrefix = kvConfig.titlePrefix || env.BARK_TITLE_PREFIX || DEFAULT_TITLE_PREFIX;
  const notifySuccess = kvConfig.notifySuccess !== undefined ? Boolean(kvConfig.notifySuccess) : (env.BARK_NOTIFY_SUCCESS !== "0");
  const notifyAlert = kvConfig.notifyAlert !== undefined ? Boolean(kvConfig.notifyAlert) : (env.BARK_NOTIFY_ALERT !== "0");
  const notifyDevice = kvConfig.notifyDevice !== undefined ? Boolean(kvConfig.notifyDevice) : (env.BARK_NOTIFY_DEVICE !== "0");
  const throttleMinutes = Number(kvConfig.throttleMinutes || env.BARK_THROTTLE_MINUTES || 5);

  return {
    server,
    key,
    enabled: Boolean(key),
    titlePrefix,
    notifySuccess,
    notifyAlert,
    notifyDevice,
    throttleMinutes
  };
}

/**
 * 发送 Bark 推送消息
 */
export async function sendBarkNotification({
  server = DEFAULT_BARK_SERVER,
  key = "",
  title = "ParseFree 通知",
  body = "",
  group = "ParseFree",
  sound = "",
  icon = "",
  url = ""
} = {}) {
  if (!key) return { success: false, error: "未配置 Bark 设备 Key" };

  const cleanServer = server.replace(/\/+$/, "");
  const targetUrl = `${cleanServer}/${encodeURIComponent(key)}`;

  const payload = {
    title,
    body,
    group,
    ...(sound ? { sound } : {}),
    ...(icon ? { icon } : {}),
    ...(url ? { url } : {})
  };

  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && (data.code === 200 || data.message === "success" || data.status === "success")) {
      return { success: true, data };
    }
    return { success: false, status: res.status, error: data.message || `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 设备拉取节点防抖节流检查
 */
export function shouldThrottleClientFetch(clientKey, throttleMinutes = 5) {
  const now = Date.now();
  const lastTime = clientFetchThrottleMap.get(clientKey) || 0;
  if (now - lastTime < throttleMinutes * 60 * 1000) {
    return true; // 冷却中，应当节流
  }
  clientFetchThrottleMap.set(clientKey, now);
  if (clientFetchThrottleMap.size > 200) {
    for (const [k, t] of clientFetchThrottleMap.entries()) {
      if (now - t > 3600000) clientFetchThrottleMap.delete(k);
    }
  }
  return false;
}

function formatBjTime() {
  return new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

async function isClientThrottled(clientKey, throttleMinutes = 5) {
  if (shouldThrottleClientFetch(clientKey, throttleMinutes)) return true;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (!cache || throttleMinutes <= 0) return false;
  try {
    const req = new Request(`https://parsefree.internal/client-throttle/${encodeURIComponent(clientKey)}`);
    if (await cache.match(req)) return true;
    await cache.put(req, new Response("1", {
      headers: { "Cache-Control": `public, max-age=${Math.max(60, Math.round(throttleMinutes * 60))}` }
    }));
  } catch (e) {}
  return false;
}

/**
 * 发送今日更新成功通知 (定时巡检/自动更新分组)
 */
export async function sendSuccessPush({ todayStr, sourceType = "clash", triggerSource = "定时巡检", env, savedConfig }) {
  const cfg = getBarkConfig(env, savedConfig);
  if (!cfg.enabled || !cfg.notifySuccess) return { success: false, skipped: true };
  const dayPart = todayStr.slice(-2);
  return sendBarkNotification({
    server: cfg.server,
    key: cfg.key,
    title: `${cfg.titlePrefix} [定时巡检] 今日节点已更新 🚀`,
    body: `状态：今日新节点已发布并锁定\n数据源：${todayStr} (${String(sourceType).toUpperCase()})\n首节点标识：已附带日期【${dayPart}】\n触发方式：${triggerSource}\n检查时间：${formatBjTime()} (北京时间)\n边缘缓存：已自动清理生效`,
    group: "ParseFree-定时巡检"
  }).catch(() => {});
}

/**
 * 发送 09:00 / 12:00 / 18:00 未发布告警通知 (定时巡检分组)
 */
export async function sendAlertPush({ hour, todayStr, fallbackDate, retryMinutes = 10, env, savedConfig }) {
  const cfg = getBarkConfig(env, savedConfig);
  if (!cfg.enabled || !cfg.notifyAlert) return { success: false, skipped: true };
  const hourStr = String(hour).padStart(2, "0");
  return sendBarkNotification({
    server: cfg.server,
    key: cfg.key,
    title: `${cfg.titlePrefix} [定时巡检] 今日节点暂未发布 ⚠️`,
    body: `巡检时段：${hourStr}:00 自动检查 (北京时间)\n状态：今日（${todayStr}）免费节点尚未发布\n回退策略：已自动回退使用【${fallbackDate || "最新有效"}】数据\n重试间隔：每 ${retryMinutes} 分钟自动探测一次`,
    group: "ParseFree-定时巡检"
  }).catch(() => {});
}

/**
 * 发送设备端拉取订阅通知 (访问审计分组，带跨实例5分钟防刷节流)
 */
export async function sendClientFetchPush({
  clientUa = "", clientIp = "", region = "", format = "明文", sourceType = "clash",
  nodeCount = 0, sourceDate = "", env, savedConfig
}) {
  const cfg = getBarkConfig(env, savedConfig);
  if (!cfg.enabled || !cfg.notifyDevice) return { success: false, skipped: true };

  const throttleKey = `${clientIp}_${clientUa.slice(0, 30)}`;
  if (await isClientThrottled(throttleKey, cfg.throttleMinutes)) {
    return { success: false, throttled: true };
  }

  let clientName = "未知设备/客户端";
  const ua = clientUa.toLowerCase();
  if (ua.includes("shadowrocket")) clientName = "Shadowrocket (小火箭)";
  else if (ua.includes("clash")) clientName = "Clash";
  else if (ua.includes("v2ray")) clientName = "v2rayN";
  else if (ua.includes("sing-box")) clientName = "sing-box";
  else if (ua.includes("quantumult")) clientName = "Quantumult X";
  else if (ua.includes("surge")) clientName = "Surge";
  else if (ua.includes("nekobox")) clientName = "NekoBox";
  else if (ua.includes("surfboard")) clientName = "Surfboard";
  else if (ua.includes("curl") || ua.includes("wget")) clientName = "命令行 (cURL/Wget)";
  else if (ua.includes("mozilla") || ua.includes("chrome") || ua.includes("safari")) clientName = "浏览器直接拉取";

  return sendBarkNotification({
    server: cfg.server,
    key: cfg.key,
    title: `${cfg.titlePrefix} [访问审计] ${clientName} 拉取了节点 📥`,
    body: `事件：检测到订阅拉取请求\n客户端：${clientName}\n拉取格式：${format} (${String(sourceType).toUpperCase()})\n来源 IP：${clientIp || "未知"}${region ? ` (${region})` : ""}\n下发节点：${nodeCount} 个 (源日期 ${sourceDate || "未知"})\n拉取时间：${formatBjTime()} (北京时间)`,
    group: "ParseFree-拉取记录"
  }).catch(() => {});
}
