import assert from "assert";
import worker from "../src/index.js";
import distWorkerModule from "../dist/worker.js";
import rootWorkerModule from "../_worker.js";

async function runTests() {
  console.log("=== 开始测试 ParseFree Cloudflare Worker ===");

  // 1. 测试默认无认证模式下的浏览器访问根路径 (HTML 页面)
  console.log("1. 测试 GET / (无认证模式下浏览器访问)...");
  const reqHtml = new Request("http://localhost:8787/", {
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
  });
  const resHtml = await worker.fetch(reqHtml, {});
  assert.strictEqual(resHtml.status, 200, "状态码应为 200");
  const htmlText = await resHtml.text();
  assert(htmlText.includes("免费节点自动同步与格式转换服务"), "页面应包含标题");
  assert(htmlText.includes("未开启 (公开访问)"), "应显示未开启访问保护");
  console.log("   ✓ 根路径 HTML 测试通过");

  // 2. 测试客户端访问 /sub (纯文本节点列表)
  console.log("2. 测试 GET /sub (纯文本节点列表)...");
  const reqSub = new Request("http://localhost:8787/sub");
  const resSub = await worker.fetch(reqSub, {});
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
  const resB64 = await worker.fetch(reqB64, {});
  assert.strictEqual(resB64.status, 200, "状态码应为 200");
  const b64Text = await resB64.text();
  const decoded = Buffer.from(b64Text, "base64").toString("utf-8");
  assert(decoded.includes("://"), "Base64 解码后应包含节点链接");
  console.log("   ✓ Base64 订阅测试通过");

  // 4. 测试账号密码访问鉴权设置 (AUTH_USERNAME & AUTH_PASSWORD)
  console.log("4. 测试账号密码认证机制...");
  const authEnv = {
    AUTH_USERNAME: "admin",
    AUTH_PASSWORD: "mypassword123"
  };

  // 4.1 未携带凭证 -> 返回 401
  const reqNoAuth = new Request("http://localhost:8787/sub");
  const resNoAuth = await worker.fetch(reqNoAuth, authEnv);
  assert.strictEqual(resNoAuth.status, 401, "未认证时应返回 401");
  assert(resNoAuth.headers.get("www-authenticate").includes("Basic"), "应包含 WWW-Authenticate Basic 头");
  console.log("   ✓ 无凭证时成功被 401 拦截");

  // 4.2 错误密码 -> 返回 401
  const reqWrongAuth = new Request("http://localhost:8787/sub?token=wrongpass");
  const resWrongAuth = await worker.fetch(reqWrongAuth, authEnv);
  assert.strictEqual(resWrongAuth.status, 401, "错误凭证时应返回 401");
  console.log("   ✓ 错误凭据被成功拦截");

  // 4.3 URL 参数携带正确 token -> 放行 200
  const reqTokenAuth = new Request("http://localhost:8787/sub?token=mypassword123");
  const resTokenAuth = await worker.fetch(reqTokenAuth, authEnv);
  assert.strictEqual(resTokenAuth.status, 200, "正确 token 应放行 200");
  console.log("   ✓ URL ?token=mypassword123 成功通过验证");

  // 4.4 HTTP Basic Auth Header 携带正确凭据 -> 放行 200
  const basicCreds = Buffer.from("admin:mypassword123").toString("base64");
  const reqHeaderAuth = new Request("http://localhost:8787/sub", {
    headers: { "Authorization": `Basic ${basicCreds}` }
  });
  const resHeaderAuth = await worker.fetch(reqHeaderAuth, authEnv);
  assert.strictEqual(resHeaderAuth.status, 200, "正确 Basic Auth 请求头应放行 200");
  console.log("   ✓ HTTP Basic Auth 请求头成功通过验证");

  // 4.5 浏览器访问带密码时的首页 -> 显示“已开启 (密码保护)”
  const reqHtmlAuth = new Request("http://localhost:8787/?token=mypassword123", {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  const resHtmlAuth = await worker.fetch(reqHtmlAuth, authEnv);
  assert.strictEqual(resHtmlAuth.status, 200);
  const authHtmlText = await resHtmlAuth.text();
  assert(authHtmlText.includes("已开启 (密码保护)"), "页面应显示已开启密码保护");
  assert(authHtmlText.includes("token=mypassword123"), "复制订阅链接应自动包含 token");
  console.log("   ✓ 网页控制台展示密码保护状态且订阅链接自动附加 token");

  // 5. 测试 dist/worker.js 与 _worker.js 单文件版本
  console.log("5. 测试打包文件 dist/worker.js 与 _worker.js 执行...");
  const resDist = await distWorkerModule.fetch(new Request("http://localhost:8787/sub?token=mypassword123"), authEnv);
  assert.strictEqual(resDist.status, 200, "dist/worker.js 应正常放行 200");
  const resRoot = await rootWorkerModule.fetch(new Request("http://localhost:8787/sub?token=mypassword123"), authEnv);
  assert.strictEqual(resRoot.status, 200, "_worker.js 应正常放行 200");
  console.log("   ✓ dist/worker.js 与 _worker.js 独立运行正常");

  console.log("\n🎉 所有自动化测试全部通过！");
}

runTests().catch(err => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
