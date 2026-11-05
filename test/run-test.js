import assert from "assert";
import worker from "../src/index.js";
import distWorkerModule from "../dist/worker.js";
import rootWorkerModule from "../_worker.js";

async function runTests() {
  console.log("=== 开始测试 ParseFree 首节点日后缀 (02) 与重试探测间隔机制 ===");

  // 1. 测试首节点自动附带日部分（20261102 -> HOS Daily官方维护02）
  console.log("1. 测试首节点名称是否自动附带数据源日部分 (例如 'HOS Daily官方维护02')...");
  const reqSub = new Request("http://localhost:8787/sub");
  const resSub = await worker.fetch(reqSub, {});
  assert.strictEqual(resSub.status, 200, "状态码应为 200");
  const subText = await resSub.text();
  const lines = subText.split("\n").map(l => l.trim()).filter(Boolean);
  assert(lines.length > 0, "应解析出节点");

  const firstNode = lines[0];
  console.log("   首节点完整 URI:", firstNode);
  // 必须包含 "HOS Daily官方维护02"（当前回退到02日）
  assert(firstNode.includes(encodeURIComponent("HOS Daily官方维护02")), "首节点名称必须包含日后缀 '02'，如 HOS Daily官方维护02");
  console.log("   ✓ 首节点成功显示为: HOS Daily官方维护02 (可通过第一条直观识别更新状态)");

  // 1.1 校验针对小火箭的订阅标头与防缓存标头
  assert.strictEqual(resSub.headers.get("Cache-Control"), "no-cache, no-store, must-revalidate", "客户端响应必须下发 no-cache 防小火箭本地缓存");
  assert(resSub.headers.get("Subscription-Userinfo"), "必须下发 Subscription-Userinfo 触发小火箭托管订阅更新");
  assert.strictEqual(resSub.headers.get("Profile-Update-Interval"), "6", "必须下发 Profile-Update-Interval 自动更新周期");
  assert(resSub.headers.get("X-Last-Request-Time"), "必须包含本次请求北京时间标头");
  assert(resSub.headers.get("X-Next-Request-Time"), "必须包含下次请求北京时间标头");
  assert(resSub.headers.get("X-Countdown-Seconds"), "必须包含倒计时秒数标头");
  console.log("   ✓ 小火箭托管订阅标头与时间戳/倒计时标头验证通过");

  // 2. 验证普通节点前缀 (HOS自动化线路)
  const secondNode = lines[1];
  const b64 = secondNode.replace("vmess://", "");
  const vmessObj = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  console.log("   第二节点 ps 字段:", vmessObj.ps);
  assert(vmessObj.ps.startsWith("HOS自动化线路 "), "普通节点名称前面必须带有 'HOS自动化线路 ' 前缀");
  console.log("   ✓ 普通节点前缀验证正常");

  // 3. 测试重试间隔参数 (?retry_interval=15) 与时间元数据展示
  console.log("3. 测试重试间隔配置 (?retry_interval=15) 与请求时间/实时倒计时展示...");
  const reqInterval = new Request("http://localhost:8787/?retry_interval=15", {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  const resInterval = await worker.fetch(reqInterval, {});
  assert.strictEqual(resInterval.status, 200);
  const html = await resInterval.text();
  assert(html.includes('value="15"'), "页面应包含设置的 15 分钟重试间隔");
  assert(html.includes("本次请求 (北京时间)"), "页面应包含本次请求北京时间展示");
  assert(html.includes("下一次请求 (北京时间)"), "页面应包含下一次请求北京时间展示");
  assert(html.includes("countdownBox"), "页面应包含倒计时元素 countdownBox");
  assert(html.includes("Bark 配置"), "页面应包含 Bark 配置卡片");
  assert(html.includes("barkServerInput"), "页面应包含 Bark 服务器地址输入框");
  assert(html.includes("barkKeyInput"), "页面应包含 Bark 设备Key输入框");
  assert(html.includes("测试通知"), "页面应包含 测试通知 按钮");
  console.log("   ✓ 重试间隔设置、倒计时与 Bark 配置卡片展示正常");

  // 3.1 测试 Bark API 接口 (/api/test-bark)
  console.log("3.1 测试 Bark 接口 (/api/test-bark)...");
  const resBarkEmpty = await worker.fetch(new Request("http://localhost:8787/api/test-bark", { method: "POST" }), {});
  assert.strictEqual(resBarkEmpty.status, 400, "无 Key 时应返回 400");
  const jsonBarkEmpty = await resBarkEmpty.json();
  assert.strictEqual(jsonBarkEmpty.success, false);
  console.log("   ✓ Bark API 校验与错误处理正常");

  // 4. 测试自定义首节点与前缀参数 (?first_name=定制官方节点&prefix=线路前缀-)
  console.log("4. 测试自定义首节点参数 (附带02日后缀)...");
  const reqCustom = new Request("http://localhost:8787/sub?first_name=定制官方节点&prefix=线路前缀-");
  const resCustom = await worker.fetch(reqCustom, {});
  const cLines = (await resCustom.text()).split("\n").map(l => l.trim()).filter(Boolean);
  assert(cLines[0].includes(encodeURIComponent("定制官方节点02")), "自定义首节点名称同样应自动附加 '02' 后缀");
  console.log("   ✓ 自定义名称自动追加日后缀验证通过: 定制官方节点02");

  // 5. 测试小火箭 Base64 订阅输出 (?b64=1)
  console.log("5. 测试 Base64 订阅输出 (?b64=1)...");
  const resB64 = await worker.fetch(new Request("http://localhost:8787/sub?b64=1"), {});
  assert.strictEqual(resB64.status, 200);
  const b64Text = await resB64.text();
  const decodedFromB64 = Buffer.from(b64Text, "base64").toString("utf-8");
  assert(decodedFromB64.includes(encodeURIComponent("HOS Daily官方维护02")), "Base64 解码后必须包含正确的首节点");
  console.log("   ✓ Base64 订阅输出与解码验证通过");

  // 6. 测试打包产物 dist/worker.js 与 _worker.js
  console.log("6. 测试打包产物 dist/worker.js 与 _worker.js 独立运行...");
  const resDist = await distWorkerModule.fetch(new Request("http://localhost:8787/sub"), {});
  assert.strictEqual(resDist.status, 200);
  const distLines = (await resDist.text()).split("\n").map(l => l.trim()).filter(Boolean);
  assert(distLines[0].includes(encodeURIComponent("HOS Daily官方维护02")), "打包版首节点日后缀正常");
  const resRoot = await rootWorkerModule.fetch(new Request("http://localhost:8787/sub"), {});
  assert.strictEqual(resRoot.status, 200);
  console.log("   ✓ 打包产物完全正常");

  console.log("\n🎉 全部功能与回归测试全部通过！");
}

runTests().catch(err => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
