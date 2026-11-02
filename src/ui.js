/**
 * Web 控制台页面渲染模块
 * 遵循 Element Plus 企业级风格，简洁、专业、克制
 */

export function renderDashboardHtml({
  subUrl,
  b64SubUrl,
  nodes,
  targetUrl,
  sourceDate,
  method,
  authInfo = {}
}) {
  const nodeCount = nodes.length;
  const escapedNodes = JSON.stringify(nodes);
  const isProtected = Boolean(authInfo.active);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>免费节点订阅解析转换服务</title>
  <style>
    :root {
      --el-color-primary: #409eff;
      --el-color-success: #67c23a;
      --el-color-warning: #e6a23c;
      --el-color-info: #909399;
      --el-color-danger: #f56c6c;
      --el-bg-color: #f5f7fa;
      --el-text-color-primary: #303133;
      --el-text-color-regular: #606266;
      --el-text-color-secondary: #909399;
      --el-border-color: #dcdfe6;
      --el-border-color-light: #e4e7ed;
      --card-bg: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--el-bg-color);
      color: var(--el-text-color-primary);
      line-height: 1.6;
      padding: 24px;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .header {
      background: var(--card-bg);
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .header h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: var(--el-text-color-primary); }
    .header p { font-size: 14px; color: var(--el-text-color-regular); }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--el-border-color-light);
      border-radius: 6px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid var(--el-color-primary); padding-left: 10px; }
    
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .meta-item { background: #fafafa; border: 1px solid var(--el-border-color-light); padding: 12px; border-radius: 4px; }
    .meta-label { font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 4px; }
    .meta-value { font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); word-break: break-all; }
    
    .sub-box { margin-bottom: 16px; }
    .sub-label { font-size: 13px; font-weight: 500; margin-bottom: 6px; color: var(--el-text-color-regular); }
    .input-group { display: flex; gap: 8px; }
    .input-control {
      flex: 1;
      padding: 9px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: 4px;
      font-size: 13px;
      background: #fafafa;
      color: var(--el-text-color-primary);
    }
    .btn {
      padding: 9px 16px;
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      border: 1px solid transparent;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-primary { background: var(--el-color-primary); color: #fff; }
    .btn-primary:hover { background: #66b1ff; }
    .btn-default { background: #fff; border-color: var(--el-border-color); color: var(--el-text-color-regular); }
    .btn-default:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
    
    .node-list { max-height: 400px; overflow-y: auto; border: 1px solid var(--el-border-color-light); border-radius: 4px; }
    .node-item {
      padding: 10px 14px;
      font-size: 13px;
      font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      border-bottom: 1px solid var(--el-border-color-light);
      word-break: break-all;
      background: #fff;
    }
    .node-item:nth-child(even) { background: #fafafa; }
    .node-item:last-child { border-bottom: none; }
    .tag {
      display: inline-block;
      padding: 2px 6px;
      font-size: 11px;
      border-radius: 3px;
      font-weight: 600;
      margin-right: 8px;
    }
    .tag-vmess { background: #ecf5ff; color: #409eff; border: 1px solid #d9ecff; }
    .tag-ss { background: #f0f9eb; color: #67c23a; border: 1px solid #e1f3d8; }
    .tag-anytls { background: #fdf6ec; color: #e6a23c; border: 1px solid #faecd8; }
    .tag-other { background: #f4f4f5; color: #909399; border: 1px solid #e9e9eb; }
    
    .toast {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      display: none;
      z-index: 9999;
    }
  </style>
</head>
<body>
  <div class="toast" id="toast">复制成功</div>
  <div class="container">
    <div class="header">
      <h1>免费节点自动同步与格式转换服务</h1>
      <p>自动抓取每日更新的节点订阅，实时转换为标准节点链接格式（与 格式.txt 结构一致）。</p>
    </div>

    <div class="card">
      <div class="card-title">节点状态概览</div>
      <div class="meta-grid">
        <div class="meta-item">
          <div class="meta-label">已解析可用节点数</div>
          <div class="meta-value" style="color: var(--el-color-success);">${nodeCount} 个</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">数据源发布日期</div>
          <div class="meta-value">${sourceDate || "最新"}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">获取机制</div>
          <div class="meta-value">${method === "article_discovery" ? "文章智能抓取" : (method === "date_probe" ? "日期轮询探测" : "自定义源")}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">访问鉴权保护</div>
          <div class="meta-value" style="color: ${isProtected ? 'var(--el-color-success)' : 'var(--el-color-info)'};">${isProtected ? "已开启 (密码保护)" : "未开启 (公开访问)"}</div>
        </div>
      </div>
      <div class="meta-label">当前解析上游源地址：</div>
      <div style="font-size: 13px; color: var(--el-text-color-regular); font-family: monospace; word-break: break-all;">${targetUrl}</div>
    </div>

    <div class="card">
      <div class="card-title">订阅地址获取</div>
      <div class="sub-box">
        <div class="sub-label">1. 通用明文订阅链接（每行一个节点，推荐导入 Shadowrocket / v2rayN / sing-box / NekoBox）：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="subInput" value="${subUrl}">
          <button class="btn btn-primary" onclick="copyText('${subUrl}')">复制订阅链接</button>
        </div>
      </div>
      <div class="sub-box">
        <div class="sub-label">2. Base64 编码订阅链接（适用于仅支持 base64 订阅的客户端）：</div>
        <div class="input-group">
          <input type="text" class="input-control" readonly id="b64SubInput" value="${b64SubUrl}">
          <button class="btn btn-default" onclick="copyText('${b64SubUrl}')">复制 Base64 链接</button>
        </div>
      </div>
      <div style="margin-top: 16px;">
        <button class="btn btn-primary" onclick="copyAllNodes()">一键复制全部节点链接</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">节点链接明细 (${nodeCount})</div>
      <div class="node-list">
        ${nodes.map((n) => {
          const proto = n.split("://")[0] || "node";
          let tagClass = "tag-other";
          if (proto === "vmess") tagClass = "tag-vmess";
          else if (proto === "ss") tagClass = "tag-ss";
          else if (proto === "anytls") tagClass = "tag-anytls";
          return `<div class="node-item"><span class="tag ${tagClass}">${proto.toUpperCase()}</span>${n}</div>`;
        }).join("")}
      </div>
    </div>
  </div>

  <script>
    const allNodes = ${escapedNodes};

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.style.display = "block";
      setTimeout(() => { t.style.display = "none"; }, 2000);
    }

    function copyText(val) {
      navigator.clipboard.writeText(val).then(() => {
        showToast("已复制到剪贴板");
      }).catch(() => {
        prompt("请手动复制：", val);
      });
    }

    function copyAllNodes() {
      const text = allNodes.join("\\n");
      copyText(text);
    }
  </script>
</body>
</html>`;
}
