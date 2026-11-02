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
  renameOptions = {}
}) {
  const nodeCount = nodes.length;
  const escapedNodes = JSON.stringify(nodes);
  const isProtected = Boolean(authInfo.active);
  const isAutoMode = mode !== "manual";
  const isV2ray = type === "v2ray";
  const firstName = renameOptions.firstName || "HOS Daily官方维护";
  const prefix = renameOptions.prefix !== undefined ? renameOptions.prefix : "HOS自动化线路 ";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费节点自动同步与转换服务 - ParseFree</title>
  <style>
    :root {
      --el-color-primary: #409eff;
      --el-color-success: #67c23a;
      --el-color-warning: #e6a23c;
      --el-color-info: #909399;
      --el-color-danger: #f56c6c;
      --el-bg-color: #f5f7fa;
      --el-text-primary: #303133;
      --el-text-regular: #606266;
      --el-text-secondary: #909399;
      --el-border-color: #dcdfe6;
      --el-border-light: #e4e7ed;
      --card-bg: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background-color: var(--el-bg-color); color: var(--el-text-primary);
      line-height: 1.6; padding: 24px 16px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .card {
      background: var(--card-bg); border: 1px solid var(--el-border-light);
      border-radius: 6px; padding: 20px 24px; margin-bottom: 20px;
    }
    .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid var(--el-color-primary); padding-left: 10px; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 16px; }
    .meta-item { background: #fafafa; border: 1px solid var(--el-border-light); padding: 12px; border-radius: 4px; }
    .meta-label { font-size: 12px; color: var(--el-text-secondary); margin-bottom: 4px; }
    .meta-value { font-size: 14px; font-weight: 600; word-break: break-all; }
    .input-group { display: flex; gap: 8px; margin-bottom: 12px; }
    .input-control {
      flex: 1; padding: 8px 12px; border: 1px solid var(--el-border-color);
      border-radius: 4px; font-size: 13px; background: #fafafa; color: var(--el-text-primary);
    }
    .btn {
      padding: 8px 16px; border-radius: 4px; font-size: 13px; cursor: pointer;
      font-weight: 500; border: 1px solid transparent; transition: all 0.2s;
    }
    .btn-primary { background: var(--el-color-primary); color: #fff; }
    .btn-primary:hover { background: #66b1ff; }
    .btn-default { background: #fff; border-color: var(--el-border-color); color: var(--el-text-regular); }
    .btn-default:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
    .node-list { max-height: 360px; overflow-y: auto; border: 1px solid var(--el-border-light); border-radius: 4px; }
    .node-item {
      padding: 9px 12px; font-size: 12px; font-family: monospace;
      border-bottom: 1px solid var(--el-border-light); word-break: break-all; background: #fff;
    }
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
      <p style="font-size: 13px; color: var(--el-text-regular);">每日00点后自动更新地址，一旦获取成功自动停止探测并锁定。广告信息自动清理，节点名称统一规范化。</p>
    </div>

    <!-- 1. 运行状态卡片 -->
    <div class="card">
      <div class="card-title">当前同步状态</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">已解析可用节点</div>
          <div class="meta-value" style="color: var(--el-color-success);">${nodeCount} 个</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">数据来源与日期</div>
          <div class="meta-value">${sourceDate} (${isAutoMode ? (isToday ? "今日已锁定" : "自动回退中") : "手动"})</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">源文件格式</div>
          <div class="meta-value">${isV2ray ? "V2Ray 格式 (.txt)" : "Clash 格式 (.yaml)"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">安全鉴权状态</div>
          <div class="meta-value" style="color: ${isProtected ? 'var(--el-color-success)' : 'var(--el-color-info)'};">${isProtected ? "已开启密码保护" : "公开访问"}</div>
        </div>
      </div>
      <div class="meta-label">当前生效的上游源地址：</div>
      <div style="font-size: 13px; color: var(--el-text-regular); font-family: monospace; word-break: break-all; margin-top: 4px;">${targetUrl}</div>
    </div>

    <!-- 2. 数据源模式设置与手动编辑卡片 -->
    <div class="card">
      <div class="card-title">数据源模式与手动编辑</div>
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
    </div>

    <!-- 3. 自定义节点命名与广告清理卡片 -->
    <div class="card">
      <div class="card-title">节点命名与广告清理设置</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-bottom: 12px;">
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 6px;">首节点 / 广告宣传替换名称：</div>
          <input type="text" class="input-control" id="firstNameInput" value="${firstName}" style="width: 100%;">
        </div>
        <div>
          <div style="font-size: 13px; color: var(--el-text-regular); margin-bottom: 6px;">普通节点线路前缀：</div>
          <input type="text" class="input-control" id="prefixInput" value="${prefix}" style="width: 100%;">
        </div>
      </div>
      <button class="btn btn-primary" onclick="applyRenameOptions()">应用节点命名规则</button>
    </div>

    <!-- 4. 订阅地址获取卡片 -->
    <div class="card">
      <div class="card-title">客户端订阅链接</div>
      <div style="margin-bottom: 12px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">1. 通用明文订阅链接 (与 格式.txt 一致，导入小火箭 / v2rayN / sing-box)：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="subInput" value="${subUrl}">
          <button class="btn btn-primary" onclick="copyText('${subUrl}')">复制订阅链接</button>
        </div>
      </div>
      <div style="margin-bottom: 14px;">
        <div style="font-size: 13px; font-weight: 500; margin-bottom: 6px;">2. Base64 编码订阅链接 (兼容仅认 base64 的旧版客户端)：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="b64SubInput" value="${b64SubUrl}">
          <button class="btn btn-default" onclick="copyText('${b64SubUrl}')">复制 Base64 链接</button>
        </div>
      </div>
      <button class="btn btn-primary" onclick="copyAllNodes()">一键复制全部 ${nodeCount} 个节点链接</button>
    </div>

    <!-- 5. 节点列表预览卡片 -->
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
    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg; t.style.display = "block";
      setTimeout(() => { t.style.display = "none"; }, 2000);
    }
    function copyText(val) {
      navigator.clipboard.writeText(val).then(() => showToast("已复制到剪贴板")).catch(() => prompt("请复制：", val));
    }
    function copyAllNodes() { copyText(allNodes.join("\\n")); }

    function switchMode(m) {
      document.getElementById("manualBox").style.display = m === "manual" ? "block" : "none";
      if (m === "auto") {
        const u = new URL(window.location.href);
        u.searchParams.delete("source"); u.searchParams.delete("mode");
        window.location.href = u.toString();
      }
    }
    function switchType(t) {
      const u = new URL(window.location.href);
      u.searchParams.set("type", t);
      window.location.href = u.toString();
    }
    function applyManualUrl() {
      const val = document.getElementById("customInput").value.trim();
      if (!val) return alert("请输入有效地址");
      const u = new URL(window.location.href);
      u.searchParams.set("source", val);
      window.location.href = u.toString();
    }
    function applyRenameOptions() {
      const fn = document.getElementById("firstNameInput").value.trim();
      const p = document.getElementById("prefixInput").value;
      const u = new URL(window.location.href);
      if (fn) u.searchParams.set("first_name", fn);
      else u.searchParams.delete("first_name");
      if (p) u.searchParams.set("prefix", p);
      else u.searchParams.delete("prefix");
      window.location.href = u.toString();
    }
  </script>
</body>
</html>`;
}
