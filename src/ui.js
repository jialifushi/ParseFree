/**
 * Web 控制台页面渲染模块
 * 遵循 Element Plus 企业级风格，简洁、专业、克制
 * 支持自动日期模式 / 手动编辑地址模式切换，支持 V2Ray / Clash 源切换与节点重命名规则自定义
 */

export function renderDashboardHtml({
  subUrl,
  b64SubUrl,
  nodes,
  targetUrl,
  sourceDate,
  isToday,
  mode,
  type,
  authInfo = {},
  renameOptions = {},
  retryMinutes = 10,
  statusMsg = "",
  timing = {},
  barkConfig = {}
}) {
  const nodeCount = nodes.length;
  const escapedNodes = JSON.stringify(nodes);
  const isProtected = Boolean(authInfo.active);
  const isAutoMode = mode !== "manual";
  const isV2ray = type === "v2ray";
  const firstName = renameOptions.firstName || "HOS Daily官方维护";
  const prefix = renameOptions.prefix !== undefined ? renameOptions.prefix : "HOS自动化线路 ";
  const lastReqTime = timing.lastRequestTimeStr || "-";
  const nextReqTime = timing.nextRequestTimeStr || "-";
  const countdownSec = Number(timing.countdownSeconds) || 0;
  const barkServer = barkConfig.barkServer || "";
  const barkKey = barkConfig.barkKey || "";
  const notifySuccess = barkConfig.notifySuccess !== false;
  const notifyAlert = barkConfig.notifyAlert !== false;
  const notifyDevice = Boolean(barkConfig.notifyDevice);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费节点自动同步与转换服务 - ParseFree</title>
  <style>
    :root {
      --el-color-primary: #409eff; --el-color-success: #67c23a; --el-color-warning: #e6a23c;
      --el-color-info: #909399; --el-color-danger: #f56c6c; --el-bg-color: #f5f7fa;
      --el-text-primary: #303133; --el-text-regular: #606266; --el-text-secondary: #909399;
      --el-border-color: #dcdfe6; --el-border-light: #e4e7ed; --card-bg: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background-color: var(--el-bg-color); color: var(--el-text-primary);
      line-height: 1.6; padding: 24px 16px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .card { background: var(--card-bg); border: 1px solid var(--el-border-light); border-radius: 6px; padding: 20px 24px; margin-bottom: 20px; }
    .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid var(--el-color-primary); padding-left: 10px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .meta-item { background: #fafafa; border: 1px solid var(--el-border-light); padding: 12px; border-radius: 4px; }
    .meta-label { font-size: 12px; color: var(--el-text-secondary); margin-bottom: 4px; }
    .meta-value { font-size: 14px; font-weight: 600; word-break: break-all; }
    .input-group { display: flex; gap: 8px; margin-bottom: 12px; }
    .input-control { flex: 1; padding: 8px 12px; border: 1px solid var(--el-border-color); border-radius: 4px; font-size: 13px; background: #fafafa; color: var(--el-text-primary); }
    .btn { padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 500; border: 1px solid transparent; transition: all 0.2s; }
    .btn-primary { background: var(--el-color-primary); color: #fff; }
    .btn-primary:hover { background: #66b1ff; }
    .btn-default { background: #fff; border-color: var(--el-border-color); color: var(--el-text-regular); }
    .btn-default:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
    .node-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--el-border-light); border-radius: 4px; }
    .node-item { padding: 9px 12px; font-size: 12px; font-family: monospace; border-bottom: 1px solid var(--el-border-light); word-break: break-all; background: #fff; }
    .node-item:nth-child(even) { background: #fafafa; }
    .tag { display: inline-block; padding: 2px 6px; font-size: 11px; border-radius: 3px; font-weight: 600; margin-right: 8px; }
    .tag-vmess { background: #ecf5ff; color: #409eff; border: 1px solid #d9ecff; }
    .tag-ss { background: #f0f9eb; color: #67c23a; border: 1px solid #e1f3d8; }
    .tag-anytls { background: #fdf6ec; color: #e6a23c; border: 1px solid #faecd8; }
    .tag-other { background: #f4f4f5; color: #909399; border: 1px solid #e9e9eb; }
    .radio-label { margin-right: 18px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #fff; padding: 8px 18px; border-radius: 4px; font-size: 13px; display: none; z-index: 9999; }
  </style>
</head>
<body>
  <div class="toast" id="toast">复制成功</div>
  <div class="container">
    <div class="card" style="margin-bottom: 16px;">
      <h1 style="font-size: 18px; font-weight: 600; margin-bottom: 6px;">ParseFree 免费节点自动同步与转换服务</h1>
      <p style="font-size: 13px; color: var(--el-text-regular);">每日00点后自动更新地址，一旦获取成功自动停止探测并锁定。首节点附带日期标识，失败期间自动回退最新有效数据。</p>
    </div>

    <!-- 1. 运行状态卡片 -->
    <div class="card">
      <div class="card-title">当前同步状态</div>
      <div class="meta-grid">
        <div class="meta-item"><div class="meta-label">已解析可用节点</div><div class="meta-value" style="color: var(--el-color-success);">${nodeCount} 个</div></div>
        <div class="meta-item"><div class="meta-label">数据来源日期</div><div class="meta-value">${sourceDate} (${isAutoMode ? (isToday ? "今日已锁定" : "自动回退中") : "手动"})</div></div>
        <div class="meta-item"><div class="meta-label">探测与回退状态</div><div class="meta-value" style="font-size: 13px; color: ${isToday ? 'var(--el-color-success)' : 'var(--el-color-warning)'};">${statusMsg || (isToday ? "已成功锁定今日数据" : "自动回退使用最新有效数据")}</div></div>
        <div class="meta-item"><div class="meta-label">安全鉴权状态</div><div class="meta-value" style="color: ${isProtected ? 'var(--el-color-success)' : 'var(--el-color-info)'};">${isProtected ? "已开启密码保护" : "公开访问"}</div></div>
        <div class="meta-item"><div class="meta-label">本次请求 (北京时间)</div><div class="meta-value" style="font-size: 13px;">${lastReqTime}</div></div>
        <div class="meta-item"><div class="meta-label">下一次请求 (北京时间)</div><div class="meta-value" style="font-size: 13px; color: var(--el-color-primary);">${nextReqTime} ${isToday ? "(明日0点)" : "(重试探测)"}</div></div>
        <div class="meta-item"><div class="meta-label">距离下一次请求倒计时</div><div class="meta-value" id="countdownBox" style="font-size: 14px; font-weight: 700; color: var(--el-color-primary); font-family: monospace;">计算中...</div></div>
      </div>
      <div class="meta-label">当前生效的上游源地址：</div>
      <div style="font-size: 13px; color: var(--el-text-regular); font-family: monospace; word-break: break-all; margin-top: 4px;">${targetUrl}</div>
    </div>

    <!-- 2. 数据源模式设置与手动编辑卡片 -->
    <div class="card">
      <div class="card-title">数据源模式与探测间隔设置</div>
      <div style="margin-bottom: 14px;">
        <span style="font-size: 13px; font-weight: 600; margin-right: 12px;">运行模式：</span>
        <label class="radio-label"><input type="radio" name="workMode" value="auto" ${isAutoMode ? "checked" : ""} onchange="switchMode('auto')"> 自动日期递增模式 (每日00点后自动更新)</label>
        <label class="radio-label"><input type="radio" name="workMode" value="manual" ${!isAutoMode ? "checked" : ""} onchange="switchMode('manual')"> 手动编辑指定地址模式</label>
      </div>
      <div style="margin-bottom: 14px;">
        <span style="font-size: 13px; font-weight: 600; margin-right: 12px;">源文件类型：</span>
        <label class="radio-label"><input type="radio" name="srcType" value="clash" ${!isV2ray ? "checked" : ""} onchange="switchType('clash')"> Clash (.yaml)</label>
        <label class="radio-label"><input type="radio" name="srcType" value="v2ray" ${isV2ray ? "checked" : ""} onchange="switchType('v2ray')"> V2Ray (.txt)</label>
      </div>
      <div id="manualBox" style="${isAutoMode ? 'display: none;' : ''}">
        <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 6px;">输入自定义或指定日期的节点订阅地址：</div>
        <div class="input-group">
          <input type="text" class="input-control" id="customInput" value="${targetUrl}" placeholder="例如: https://free.datiya.com/uploads/20261102-clash.yaml">
          <button class="btn btn-primary" onclick="applyManualUrl()">应用此地址</button>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
        <span style="font-size: 13px; color: var(--el-text-regular);">失败重试探测间隔 (分钟)：</span>
        <input type="number" min="1" max="1440" class="input-control" id="intervalInput" value="${retryMinutes}" style="width: 100px; flex: none;">
        <button class="btn btn-default" onclick="applyInterval()">更新间隔</button>
      </div>
    </div>

    <!-- 3. 自定义节点命名与广告清理卡片 -->
    <div class="card">
      <div class="card-title">节点命名与广告清理设置</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 12px;">
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">首节点名称 (将自动附带日期后2位)：</div>
          <input type="text" class="input-control" id="firstNameInput" value="${firstName}" style="width: 100%;">
          <div style="font-size: 11px; color: var(--el-text-secondary); margin-top: 2px;">例如数据源为 02日，首节点将自动显示为：“${firstName}02”</div>
        </div>
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">普通节点线路前缀：</div>
          <input type="text" class="input-control" id="prefixInput" value="${prefix}" style="width: 100%;">
          <div style="font-size: 11px; color: var(--el-text-secondary); margin-top: 2px;">后续所有节点前面都统一加上该前缀</div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="applyRenameOptions()">应用命名规则</button>
    </div>

    <!-- 4. 订阅地址获取卡片 -->
    <div class="card">
      <div class="card-title">客户端订阅链接</div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">1. Base64 订阅链接 (🔥 推荐小火箭 Shadowrocket / v2rayN 导入，全量同步覆盖备注)：</div>
        <div class="input-group"><input type="text" class="input-control" readonly id="b64SubInput" value="${b64SubUrl}"><button class="btn btn-primary" onclick="copyText('${b64SubUrl}')">复制 Base64 订阅</button></div>
      </div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">2. 通用明文订阅链接 (单行 URI 格式，与 格式.txt 一致)：</div>
        <div class="input-group"><input type="text" class="input-control" readonly id="subInput" value="${subUrl}"><button class="btn btn-default" onclick="copyText('${subUrl}')">复制明文链接</button></div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
        <button class="btn btn-primary" onclick="copyAllNodes()">一键复制全部 ${nodeCount} 个节点链接</button>
        <button class="btn btn-default" onclick="forceRefreshData()">强制刷新源数据并穿透缓存</button>
      </div>
      <div style="background: #fdf6ec; border: 1px solid #faecd8; border-radius: 4px; padding: 10px 12px; font-size: 12px; color: #e6a23c; line-height: 1.5;">
        <strong>💡 小火箭更新提示：</strong>小火箭对已导入过的节点默认会保留本地旧备注。若小火箭拉取后名称未更新，建议在小火箭中<strong>左滑删除旧订阅重新添加</strong>，或优先使用上方 <strong>Base64 订阅链接</strong> 下拉刷新。
      </div>
    </div>

    <!-- 5. Bark 配置卡片 -->
    <div class="card">
      <div class="card-title">Bark 配置</div>
      <div style="margin-bottom: 12px;"><div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">服务器地址</div><input type="text" class="input-control" id="barkServerInput" value="${barkServer}" placeholder="例如: https://apple.hertzhe.dpdns.org" style="width: 100%;"></div>
      <div style="margin-bottom: 12px;"><div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 4px;">设备Key</div><input type="text" class="input-control" id="barkKeyInput" value="${barkKey}" placeholder="例如: fyvLzgWrWJKraAkhSa7EUc" style="width: 100%;"></div>
      <div style="margin-bottom: 14px; font-size: 13px;">
        <label class="radio-label"><input type="checkbox" id="barkNotifySuccess" ${notifySuccess ? 'checked' : ''}> 每日更新成功推送</label>
        <label class="radio-label"><input type="checkbox" id="barkNotifyAlert" ${notifyAlert ? 'checked' : ''}> 9/12/18点未发布告警</label>
        <label class="radio-label"><input type="checkbox" id="barkNotifyDevice" ${notifyDevice ? 'checked' : ''}> 设备拉取节点通知 (5分钟防抖)</label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-primary" onclick="saveBarkConfig()">保存配置</button>
        <button class="btn btn-default" style="background: #5a626d; color: #fff;" onclick="testBarkNotification()">测试通知</button>
      </div>
    </div>

    <!-- 6. 节点列表预览卡片 -->
    <div class="card">
      <div class="card-title">节点明细预览 (${nodeCount})</div>
      <div class="node-list">
        ${nodes.map(n => {
          const proto = (n.split("://")[0] || "node").toLowerCase();
          let cls = "tag-other";
          if (proto === "vmess") cls = "tag-vmess";
          else if (proto === "ss") cls = "tag-ss";
          else if (proto === "anytls") cls = "tag-anytls";
          return `<div class="node-item"><span class="tag ${cls}">${proto.toUpperCase()}</span>${n}</div>`;
        }).join("")}
      </div>
    </div>
  </div>

  <script>
    const allNodes = ${escapedNodes};
    let leftSec = ${countdownSec};
    function updateCountdown() {
      const el = document.getElementById("countdownBox");
      if (!el) return;
      if (leftSec <= 0) { el.innerText = "00分00秒 (已到期可探测)"; return; }
      const h = Math.floor(leftSec / 3600);
      const m = Math.floor((leftSec % 3600) / 60);
      const s = leftSec % 60;
      el.innerText = (h > 0 ? h + "小时" : "") + String(m).padStart(2, "0") + "分" + String(s).padStart(2, "0") + "秒";
      leftSec--;
    }
    updateCountdown();
    setInterval(updateCountdown, 1000);

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg; t.style.display = "block";
      setTimeout(() => { t.style.display = "none"; }, 2000);
    }
    function copyText(val) {
      navigator.clipboard.writeText(val).then(() => showToast("已复制到剪贴板")).catch(() => prompt("请复制：", val));
    }
    function copyAllNodes() { copyText(allNodes.join("\\n")); }

    function forceRefreshData() {
      const u = new URL(window.location.href);
      u.searchParams.set("refresh", "1");
      window.location.href = u.toString();
    }
    async function testBarkNotification() {
      const server = document.getElementById("barkServerInput").value.trim();
      const key = document.getElementById("barkKeyInput").value.trim();
      if (!key) return alert("请先填写设备Key");
      showToast("正在发送测试通知...");
      try {
        const u = new URL("/api/test-bark", window.location.href);
        new URL(window.location.href).searchParams.forEach((v, k) => u.searchParams.set(k, v));
        const res = await fetch(u.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server, key }) });
        const text = await res.text();
        let d = {};
        try { d = JSON.parse(text); } catch(err) {
          if (text.includes("<!DOCTYPE") || text.includes("<html")) {
            return alert("接口返回了 HTML 页面。可能原因：Cloudflare 正在部署最新代码（通常需1-2分钟），请稍候刷新重试；或当前开启了密码保护，请确保网址带有 ?token=密码。");
          }
          return alert("接口响应异常: " + text.slice(0, 80));
        }
        if (d.success) showToast("✓ 测试通知已成功送达 Bark"); else alert("测试失败: " + (d.error || "未知错误"));
      } catch (e) { alert("网络异常: " + e.message); }
    }
    async function saveBarkConfig() {
      const barkServer = document.getElementById("barkServerInput").value.trim();
      const barkKey = document.getElementById("barkKeyInput").value.trim();
      const notifySuccess = document.getElementById("barkNotifySuccess").checked;
      const notifyAlert = document.getElementById("barkNotifyAlert").checked;
      const notifyDevice = document.getElementById("barkNotifyDevice").checked;
      try {
        const u = new URL("/api/save-bark", window.location.href);
        new URL(window.location.href).searchParams.forEach((v, k) => u.searchParams.set(k, v));
        const res = await fetch(u.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ barkServer, barkKey, notifySuccess, notifyAlert, notifyDevice }) });
        const text = await res.text();
        let d = {};
        try { d = JSON.parse(text); } catch(err) { return alert("接口未就绪，请等待 Cloudflare 部署完成或在环境变量中配置。"); }
        if (d.success) showToast("✓ Bark 配置已成功保存至 KV"); else alert("保存提示: " + (d.error || "未绑定 KV，更推荐直接在 CF 环境变量中设置"));
      } catch (e) { alert("保存失败: " + e.message); }
    }
    function switchMode(m) {
      document.getElementById("manualBox").style.display = m === "manual" ? "block" : "none";
      if (m === "auto") { const u = new URL(window.location.href); u.searchParams.delete("source"); u.searchParams.delete("mode"); window.location.href = u.toString(); }
    }
    function switchType(t) { const u = new URL(window.location.href); u.searchParams.set("type", t); window.location.href = u.toString(); }
    function applyManualUrl() {
      const val = document.getElementById("customInput").value.trim();
      if (!val) return alert("请输入有效地址");
      const u = new URL(window.location.href); u.searchParams.set("source", val); window.location.href = u.toString();
    }
    function applyInterval() {
      const val = document.getElementById("intervalInput").value.trim();
      const u = new URL(window.location.href); if (val) u.searchParams.set("retry_interval", val); window.location.href = u.toString();
    }
    function applyRenameOptions() {
      const fn = document.getElementById("firstNameInput").value.trim();
      const p = document.getElementById("prefixInput").value;
      const u = new URL(window.location.href);
      if (fn) u.searchParams.set("first_name", fn); else u.searchParams.delete("first_name");
      if (p) u.searchParams.set("prefix", p); else u.searchParams.delete("prefix");
      window.location.href = u.toString();
    }
  </script>
</body>
</html>`;
}
