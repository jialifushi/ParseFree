import assert from "assert";
import worker from "../src/index.js";
import distWorkerModule from "../dist/worker.js";
import rootWorkerModule from "../_worker.js";

async function runTests() {
  console.log("=== 开始测试 ParseFree 节点名称清洗与重命名优化 ===");

  // 1. 测试默认重命名行为（首节点清洗为 "HOS Daily官方维护"，普通节点加前缀 "HOS自动化线路 "）
  console.log("1. 测试默认重命名逻辑 (首节点替换为 HOS Daily官方维护，后续节点带前缀)...");
  const reqSub = new Request("http://localhost:8787/sub");
  const resSub = await worker.fetch(reqSub, {});
  assert.strictEqual(resSub.status, 200, "状态码应为 200");
  const subText = await resSub.text();
  const lines = subText.split("\n").map(l => l.trim()).filter(Boolean);
  assert(lines.length > 0, "应解析出节点");

  // 验证第1个节点 (原 tg频道:@freenodedaily)
  const firstNode = lines[0];
  console.log("   首节点完整链接:", firstNode);
  assert(!firstNode.includes("freenodedaily"), "宣传广告信息 tg频道:@freenodedaily 必须被清理");
  assert(firstNode.includes(encodeURIComponent("HOS Daily官方维护")), "首节点必须命名为 HOS Daily官方维护");
  console.log("   ✓ 广告宣传节点成功识别并更换为: HOS Daily官方维护");

  // 验证第2个节点 (原 🇭🇰 香港)
  const secondNode = lines[1];
  console.log("   第二节点完整链接:", secondNode);
  // VMess 链接解 base64 验证 ps
  const b64 = secondNode.replace("vmess://", "");
  const jsonStr = Buffer.from(b64, "base64").toString("utf-8");
  const vmessObj = JSON.parse(jsonStr);
  console.log("   第二节点 ps 字段:", vmessObj.ps);
  assert(vmessObj.ps.startsWith("HOS自动化线路 "), "普通节点名称前面必须带有 'HOS自动化线路 ' 前缀");
  console.log("   ✓ 普通节点成功自动加上前缀: 'HOS自动化线路 '");

  // 2. 测试自定义参数 (?first_name=xxx&prefix=yyy)
  console.log("2. 测试自定义首节点名称与前缀参数 (?first_name=定制维护节点&prefix=极速专线-)...");
  const reqCustom = new Request("http://localhost:8787/sub?first_name=定制维护节点&prefix=极速专线-");
  const resCustom = await worker.fetch(reqCustom, {});
  assert.strictEqual(resCustom.status, 200);
  const customLines = (await resCustom.text()).split("\n").map(l => l.trim()).filter(Boolean);
  assert(customLines[0].includes(encodeURIComponent("定制维护节点")), "首节点应使用自定义名称");
  const cVmess = JSON.parse(Buffer.from(customLines[1].replace("vmess://", ""), "base64").toString("utf-8"));
  assert(cVmess.ps.startsWith("极速专线-"), "普通节点应使用自定义前缀");
  console.log("   ✓ 自定义名称与前缀参数验证通过");

  // 3. 测试 Web 页面渲染与输入框
  console.log("3. 测试 Web 控制台页面渲染...");
  const reqHtml = new Request("http://localhost:8787/", { headers: { "user-agent": "Mozilla/5.0" } });
  const resHtml = await worker.fetch(reqHtml, {});
  const html = await resHtml.text();
  assert(html.includes("HOS Daily官方维护"), "页面应包含首节点默认名称");
  assert(html.includes("HOS自动化线路"), "页面应包含默认前缀");
  console.log("   ✓ Web 控制面板自定义控件渲染正常");

  // 4. 测试打包产物 dist/worker.js 与 _worker.js
  console.log("4. 测试打包产物 dist/worker.js 与 _worker.js 独立运行...");
  const resDist = await distWorkerModule.fetch(new Request("http://localhost:8787/sub"), {});
  assert.strictEqual(resDist.status, 200);
  const distLines = (await resDist.text()).split("\n").map(l => l.trim()).filter(Boolean);
  assert(distLines[0].includes(encodeURIComponent("HOS Daily官方维护")), "打包版本首节点重命名正常");
  const resRoot = await rootWorkerModule.fetch(new Request("http://localhost:8787/sub"), {});
  assert.strictEqual(resRoot.status, 200);
  console.log("   ✓ 打包产物独立运行完全正常");

  console.log("\n🎉 所有测试用例全部通过！");
}

runTests().catch(err => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
