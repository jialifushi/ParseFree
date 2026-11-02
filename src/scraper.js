/**
 * 目标节点源动态探测与抓取模块
 * 针对 free.datiya.com 等每日更新网站提供智能文章抓取与多日容错回退机制
 */

const DEFAULT_BASE_URL = "https://free.datiya.com";

/**
 * 获取当前北京时间 (UTC+8) 的 Date 对象
 */
function getBeijingDate() {
  const now = new Date();
  return new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
}

/**
 * 格式化日期为 YYYYMMDD
 */
function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * 智能定位最新的 Clash YAML 订阅链接
 */
export async function discoverLatestClashUrl(baseUrl = DEFAULT_BASE_URL) {
  // 1. 尝试从网站首页解析最新发布的文章
  try {
    const homeRes = await fetch(`${baseUrl}/`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    if (homeRes.ok) {
      const homeHtml = await homeRes.text();
      const postMatch = homeHtml.match(/\/post\/(\d{8})\/?/);
      if (postMatch) {
        const postUrl = `${baseUrl}/post/${postMatch[1]}/`;
        const postRes = await fetch(postUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
        });
        if (postRes.ok) {
          const postHtml = await postRes.text();
          const yamlMatch = postHtml.match(/https?:\/\/[^\s"'<>]+\/uploads\/\d{8}-clash\.yaml/);
          if (yamlMatch) {
            return {
              url: yamlMatch[0],
              sourceDate: postMatch[1],
              method: "article_discovery"
            };
          }
        }
      }
    }
  } catch (err) {
    console.warn("HomePage scraping failed, proceeding to date fallback:", err.message);
  }

  // 2. 容错机制：按当前北京时间往前探测 3 天（今日、昨日、前日）
  const bjNow = getBeijingDate();
  for (let offset = 0; offset <= 3; offset++) {
    const targetDate = new Date(bjNow.getTime() - offset * 86400000);
    const dateStr = formatDate(targetDate);
    const candidateUrl = `${baseUrl}/uploads/${dateStr}-clash.yaml`;
    try {
      const probeRes = await fetch(candidateUrl, { method: "HEAD" });
      if (probeRes.ok) {
        return {
          url: candidateUrl,
          sourceDate: dateStr,
          method: "date_probe"
        };
      }
    } catch (err) {}
  }

  // 默认兜底尝试昨日
  const yesterday = new Date(bjNow.getTime() - 86400000);
  const fallbackDate = formatDate(yesterday);
  return {
    url: `${baseUrl}/uploads/${fallbackDate}-clash.yaml`,
    sourceDate: fallbackDate,
    method: "fallback"
  };
}

/**
 * 抓取目标订阅内容
 * 支持用户传入自定义 source 或自动探测
 */
export async function fetchSubscriptionData(customSourceUrl) {
  let targetUrl = customSourceUrl;
  let meta = { sourceDate: "custom", method: "custom_url" };

  if (!targetUrl) {
    const discovery = await discoverLatestClashUrl();
    targetUrl = discovery.url;
    meta = discovery;
  }

  const response = await fetch(targetUrl, {
    headers: {
      "User-Agent": "ClashforWindows/0.20.39",
      "Accept": "*/*"
    }
  });

  if (!response.ok) {
    throw new Error(`获取订阅源失败 [HTTP ${response.status}]: ${targetUrl}`);
  }

  const content = await response.text();
  return {
    content,
    targetUrl,
    meta
  };
}
