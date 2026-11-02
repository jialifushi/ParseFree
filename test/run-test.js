import assert from "assert";
import worker from "../src/index.js";
import distWorkerModule from "../dist/worker.js";
import rootWorkerModule from "../_worker.js";
import { handleScheduledTask } from "../src/manager.js";

async function runTests() {
  console.log("=== 开始测试 ParseFree 全新功能（自动日期/V2Ray/手动模式/鉴权） ===");

  // 1. 测试自动模式下的根路径与回退机制
  console.log("1. 测试 GET / (自动日期模式与状态概览)...");
  const reqHtml = new Request("http://localhost:8787/", {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  const resHtml = await worker.fetch(reqHtml, {});
  assert.strictEqual(resHtml.status, 200, "状态码应为 200");
  const htmlText = await resHtml.text();
  assert(htmlText.includes("ParseFree 免费节点自动同步与转换服务"), "应包含服务标题");
  assert(htmlText.includes("自动日期递增模式"), "应包含自动模式标签");
  assert(htmlText.includes("手动编辑指定地址模式"), "应包含手动编辑模式选项");
  console.log("   ✓ 根路径 HTML 与控制面板选项渲染正常");

  // 2. 测试自动模式获取节点列表 (兼容今日/回退昨日)
  console.log("2. 测试 GET /sub (自动日期模式下的节点输出)...");
  const reqSub = new Request("http://localhost:8787/sub");
  const resSub = await worker.fetch(reqSub, {});
  assert.strictEqual(resSub.status, 200, "状态码应为 200");
  const subText = await resSub.text();
  const lines = subText.split("\n").map(l => l.trim()).filter(Boolean);
  assert(lines.length > 0, "应解析出节点");
  console.log(`   ✓ 自动模式成功解析出 ${lines.length} 个节点，首个节点: ${lines[0].substring(0, 40)}...`);

  // 3. 测试手动指定地址模式 (?source=...)
  console.log("3. 测试手动指定地址模式 (?source=https://free.datiya.com/uploads/20261102-clash.yaml)...");
  const reqManual = new Request("http://localhost:8787/sub?source=https://free.datiya.com/uploads/20261102-clash.yaml");
  const resManual = await worker.fetch(reqManual, {});
  assert.strictEqual(resManual.status, 200, "手动模式状态码应为 200");
  const manualText = await resManual.text();
  assert(manualText.includes("://"), "手动模式应成功解析出节点链接");
  console.log("   ✓ 手动指定地址模式测试通过");

  // 4. 测试 V2Ray 格式源模式 (?type=v2ray)
  console.log("4. 测试 V2Ray 格式源模式 (?type=v2ray)...");
  const reqV2ray = new Request("http://localhost:8787/?type=v2ray", {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  const resV2ray = await worker.fetch(reqV2ray, {});
  assert.strictEqual(resV2ray.status, 200, "V2Ray 模式状态码应为 200");
  const v2rayHtml = await resV2ray.text();
  assert(v2rayHtml.includes("V2Ray 格式 (.txt)"), "页面应显示 V2Ray 格式状态");
  console.log("   ✓ V2Ray 模式切换与识别测试通过");

  // 5. 测试账号密码访问鉴权设置 (AUTH_USERNAME & AUTH_PASSWORD)
  console.log("5. 测试账号密码认证机制...");
  const authEnv = {
    AUTH_USERNAME: "admin",
    AUTH_PASSWORD: "mypassword123"
  };

  // 5.1 未携带凭证 -> 返回 401
  const reqNoAuth = new Request("http://localhost:8787/sub");
  const resNoAuth = await worker.fetch(reqNoAuth, authEnv);
  assert.strictEqual(resNoAuth.status, 401, "未认证时应返回 401");

  // 5.2 URL 参数携带正确 token -> 放行 200
  const reqTokenAuth = new Request("http://localhost:8787/sub?token=mypassword123");
  const resTokenAuth = await worker.fetch(reqTokenAuth, authEnv);
  assert.strictEqual(resTokenAuth.status, 200, "正确 token 应放行 200");
  console.log("   ✓ URL ?token=mypassword123 成功通过验证");

  // 6. 测试定时任务 Cron Trigger 触发逻辑
  console.log("6. 测试 scheduled 定时任务触发执行...");
  await handleScheduledTask({});
  console.log("   ✓ scheduled 任务执行完成");

  // 7. 测试打包文件 dist/worker.js 与 _worker.js
  console.log("7. 测试打包产物 dist/worker.js 与 _worker.js 独立运行...");
  const resDist = await distWorkerModule.fetch(new Request("http://localhost:8787/sub?token=mypassword123"), authEnv);
  assert.strictEqual(resDist.status, 200, "dist/worker.js 应放行 200");
  const resRoot = await rootWorkerModule.fetch(new Request("http://localhost:8787/sub?token=mypassword123"), authEnv);
  assert.strictEqual(resRoot.status, 200, "_worker.js 应放行 200");
  console.log("   ✓ 打包产物独立运行正常");

  console.log("\n🎉 全部功能与回归测试全部通过！");
}

runTests().catch(err => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
