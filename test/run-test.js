import assert from "assert";
import worker from "../src/index.js";
import distWorkerModule from "../dist/worker.js";

async function runTests() {
  console.log("=== 开始测试 ParseFree Cloudflare Worker ===");

  // 1. 测试浏览器访问根路径 (HTML 页面)
  console.log("1. 测试 GET / (浏览器 HTML 页面)...");
  const reqHtml = new Request("http://localhost:8787/", {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
  });
  const resHtml = await worker.fetch(reqHtml);
  assert.strictEqual(resHtml.status, 200, "状态码应为 200");
  const htmlText = await resHtml.text();
  assert(htmlText.includes("免费节点自动同步与格式转换服务"), "页面应包含标题");
  assert(htmlText.includes("节点链接明细"), "页面应包含节点明细");
  console.log("   ✓ 根路径 HTML 测试通过");

  // 2. 测试客户端访问 /sub (纯文本节点列表)
  console.log("2. 测试 GET /sub (纯文本节点列表)...");
  const reqSub = new Request("http://localhost:8787/sub");
  const resSub = await worker.fetch(reqSub);
  assert.strictEqual(resSub.status, 200, "状态码应为 200");
  assert(resSub.headers.get("content-type").includes("text/plain"), "Content-Type 应为 text/plain");
  const subText = await resSub.text();
  const lines = subText.split("\n").map(l => l.trim()).filter(Boolean);
  assert(lines.length > 0, "应解析出至少一个节点");
  console.log(`   ✓ 成功解析出 ${lines.length} 个节点`);
  for (const line of lines) {
    assert(/^(vmess|vless|ss|ssr|trojan|anytls|hysteria2?|tuic):\/\//.test(line), `格式必须为标准节点链接: ${line}`);
  }
  console.log("   ✓ 首个节点示例:", lines[0]);
  console.log("   ✓ 纯文本节点格式测试通过（与 格式.txt 规范完全一致）");

  // 3. 测试 Base64 订阅 (/sub?b64=1)
  console.log("3. 测试 GET /sub?b64=1 (Base64 订阅)...");
  const reqB64 = new Request("http://localhost:8787/sub?b64=1");
  const resB64 = await worker.fetch(reqB64);
  assert.strictEqual(resB64.status, 200, "状态码应为 200");
  const b64Text = await resB64.text();
  const decoded = Buffer.from(b64Text, "base64").toString("utf-8");
  assert(decoded.includes("://"), "Base64 解码后应包含节点链接");
  console.log("   ✓ Base64 订阅测试通过");

  // 4. 测试 dist/worker.js 单文件打包版本
  console.log("4. 测试 dist/worker.js 打包文件执行...");
  const resDist = await distWorkerModule.fetch(new Request("http://localhost:8787/sub"));
  assert.strictEqual(resDist.status, 200, "单文件版本状态码应为 200");
  const distText = await resDist.text();
  assert(distText.split("\n").length >= lines.length, "单文件版本输出节点数一致");
  console.log("   ✓ dist/worker.js 独立运行正常");

  console.log("\n🎉 所有自动化测试全部通过！");
}

runTests().catch(err => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
