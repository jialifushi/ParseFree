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
  const notifyDevice = kvConfig.notifyDevice !== undefined ? Boolean(kvConfig.notifyDevice) : (env.BARK_NOTIFY_DEVICE === "1");
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

/**
 * 发送今日更新成功通知
 */
export async function sendSuccessPush({ todayStr, env, savedConfig }) {
  const cfg = getBarkConfig(env, savedConfig);
  if (!cfg.enabled || !cfg.notifySuccess) return;
  const dayPart = todayStr.slice(-2);
  return sendBarkNotification({
    server: cfg.server,
    key: cfg.key,
    title: `${cfg.titlePrefix} 今日节点更新成功 🚀`,
    body: `已锁定今日（${todayStr}）节点数据。\n首节点附带日期标识【${dayPart}】\nCloudflare 边缘缓存已同步清理。`,
    group: "ParseFree"
  }).catch(() => {});
}

/**
 * 发送 09:00 / 12:00 / 18:00 未发布告警通知
 */
export async function sendAlertPush({ hour, todayStr, fallbackDate, retryMinutes = 10, env, savedConfig }) {
  const cfg = getBarkConfig(env, savedConfig);
  if (!cfg.enabled || !cfg.notifyAlert) return;
  const hourStr = String(hour).padStart(2, "0");
  return sendBarkNotification({
    server: cfg.server,
    key: cfg.key,
    title: `${cfg.titlePrefix} 今日免费节点暂未发布告警 ⚠️`,
    body: `${hourStr}:00 检测到今日（${todayStr}）免费节点尚未发布。\n已自动回退使用【${fallbackDate || '最新有效'}】数据。\n后台重试间隔: ${retryMinutes} 分钟。`,
    group: "ParseFree"
  }).catch(() => {});
}

/**
 * 发送设备端拉取订阅通知 (带防刷节流)
 */
export async function sendClientFetchPush({ clientUa = "", clientIp = "", format = "明文", nodeCount = 0, sourceDate = "", env, savedConfig }) {
  const cfg = getBarkConfig(env, savedConfig);
  if (!cfg.enabled || !cfg.notifyDevice) return;

  const throttleKey = `${clientIp}_${clientUa.slice(0, 30)}`;
  if (shouldThrottleClientFetch(throttleKey, cfg.throttleMinutes)) {
    return; // 节流期内不发送
  }

  // 简要识别客户端名称
  let clientName = "未知设备";
  const ua = clientUa.toLowerCase();
  if (ua.includes("shadowrocket")) clientName = "Shadowrocket (小火箭)";
  else if (ua.includes("clash")) clientName = "Clash";
  else if (ua.includes("v2ray")) clientName = "v2rayN";
  else if (ua.includes("sing-box")) clientName = "sing-box";
  else if (ua.includes("quantumult")) clientName = "Quantumult X";
  else if (ua.includes("surge")) clientName = "Surge";
  else if (ua.includes("curl") || ua.includes("wget")) clientName = "命令行 (cURL)";

  return sendBarkNotification({
    server: cfg.server,
    key: cfg.key,
    title: `${cfg.titlePrefix} 设备拉取节点通知 📱`,
    body: `客户端：${clientName}\n格式：${format}\nIP：${clientIp || '未知'}\n下发节点数：${nodeCount} 个 (${sourceDate || '未知'})\n时间：${new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    group: "ParseFree"
  }).catch(() => {});
}
