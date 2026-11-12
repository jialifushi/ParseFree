import assert from "assert";
import worker from "../src/index.js";
import { sendSuccessPush, sendAlertPush, sendClientFetchPush } from "../src/bark.js";
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
  const sourceDate = decodeURIComponent(resSub.headers.get("X-Source-Date") || "");
  const dayPart = sourceDate.slice(-2);
  const expectedFirstName = `HOS Daily官方维护${dayPart}`;
  assert(firstNode.includes(encodeURIComponent(expectedFirstName)), `首节点名称必须包含数据源日后缀 '${dayPart}'，如 ${expectedFirstName}`);
  console.log(`   ✓ 首节点成功显示为: ${expectedFirstName} (可通过第一条直观识别更新状态)`);

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
  let secondName = "";
  if (secondNode.startsWith("vmess://")) {
    const vmessObj = JSON.parse(Buffer.from(secondNode.replace("vmess://", ""), "base64").toString("utf-8"));
    secondName = vmessObj.ps;
  } else if (secondNode.includes("#")) {
    secondName = decodeURIComponent(secondNode.split("#")[1]);
  }
  console.log("   第二节点名称:", secondName);
  assert(secondName.startsWith("HOS自动化线路 "), "普通节点名称前面必须带有 'HOS自动化线路 ' 前缀");
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

  // 3.1 测试 Bark API 接口 (/api/test-bark 与 /api/save-bark)
  console.log("3.1 测试 Bark 接口 (/api/test-bark 与 /api/save-bark)...");
  const resBarkEmpty = await worker.fetch(new Request("http://localhost:8787/api/test-bark", { method: "POST" }), {});
  assert.strictEqual(resBarkEmpty.status, 400, "无 Key 时应返回 400");
  const resSaveNoKv = await worker.fetch(new Request("http://localhost:8787/api/save-bark", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ barkKey: "test" })
  }), {});
  assert.strictEqual(resSaveNoKv.status, 200, "无 KV 时保存也应成功返回 200");
  const jsonSaveNoKv = await resSaveNoKv.json();
  assert.strictEqual(jsonSaveNoKv.success, true);
  console.log("   ✓ Bark API 校验与无 KV 安全保存正常");

  // 3.2 测试 Cron 主动触发端点 (/api/cron)
  console.log("3.2 测试 Cron 主动触发端点 (/api/cron)...");
  const resCron = await worker.fetch(new Request("http://localhost:8787/api/cron"), {});
  assert.strictEqual(resCron.status, 200, "/api/cron 状态码应为 200");
  const jsonCron = await resCron.json();
  assert.strictEqual(jsonCron.success, true, "/api/cron 执行应成功");
  console.log("   ✓ Cron 主动触发端点验证正常:", jsonCron.message);

  // 3.3 测试定时检查通知与设备拉取通知的内容及分组区分
  console.log("3.3 验证定时巡检通知与设备拉取通知内容/分组差异...");
  const capturedPayloads = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedPayloads.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ code: 200, message: "success" }), { status: 200 });
  };
  try {
    const mockEnv = { BARK_KEY: "test-key", BARK_SERVER: "https://api.day.app" };
    await sendSuccessPush({ todayStr: "20261112", sourceType: "clash", triggerSource: "定时巡检", env: mockEnv });
    await sendAlertPush({ hour: 9, todayStr: "20261112", fallbackDate: "20261111", env: mockEnv });
    await sendClientFetchPush({
      clientUa: "Shadowrocket/2100", clientIp: "1.2.3.4", region: "CN-Shanghai",
      format: "Base64", sourceType: "clash", nodeCount: 30, sourceDate: "20261112", env: mockEnv
    });
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.strictEqual(capturedPayloads.length, 3, "应发送3条通知");
  assert(capturedPayloads[0].title.includes("[定时巡检]") && capturedPayloads[0].group === "ParseFree-定时巡检");
  assert(capturedPayloads[1].title.includes("[定时巡检]") && capturedPayloads[1].group === "ParseFree-定时巡检");
  assert(capturedPayloads[2].title.includes("[访问审计]") && capturedPayloads[2].group === "ParseFree-拉取记录");
  assert(capturedPayloads[2].body.includes("Shadowrocket") && capturedPayloads[2].body.includes("1.2.3.4 (CN-Shanghai)"));
  console.log("   ✓ 定时巡检通知与设备拉取通知在标题、正文、分组上均已明确区分");

  // 4. 测试自定义首节点与前缀参数 (?first_name=定制官方节点&prefix=线路前缀-)
  console.log("4. 测试自定义首节点参数 (附带02日后缀)...");
  const reqCustom = new Request("http://localhost:8787/sub?first_name=定制官方节点&prefix=线路前缀-");
  const resCustom = await worker.fetch(reqCustom, {});
  const cLines = (await resCustom.text()).split("\n").map(l => l.trim()).filter(Boolean);
  const expectedCustomFirst = `定制官方节点${dayPart}`;
  assert(cLines[0].includes(encodeURIComponent(expectedCustomFirst)), `自定义首节点名称同样应自动附加 '${dayPart}' 后缀`);
  console.log(`   ✓ 自定义名称自动追加日后缀验证通过: ${expectedCustomFirst}`);

  // 5. 测试小火箭 Base64 订阅输出 (?b64=1)
  console.log("5. 测试 Base64 订阅输出 (?b64=1)...");
  const resB64 = await worker.fetch(new Request("http://localhost:8787/sub?b64=1"), {});
  assert.strictEqual(resB64.status, 200);
  const b64Text = await resB64.text();
  const decodedFromB64 = Buffer.from(b64Text, "base64").toString("utf-8");
  assert(decodedFromB64.includes(encodeURIComponent(expectedFirstName)), "Base64 解码后必须包含正确的首节点");
  console.log("   ✓ Base64 订阅输出与解码验证通过");

  // 6. 测试打包产物 dist/worker.js 与 _worker.js
  console.log("6. 测试打包产物 dist/worker.js 与 _worker.js 独立运行...");
  const resDist = await distWorkerModule.fetch(new Request("http://localhost:8787/sub"), {});
  assert.strictEqual(resDist.status, 200);
  const distLines = (await resDist.text()).split("\n").map(l => l.trim()).filter(Boolean);
  assert(distLines[0].includes(encodeURIComponent(expectedFirstName)), "打包版首节点日后缀正常");
  const resRoot = await rootWorkerModule.fetch(new Request("http://localhost:8787/sub"), {});
  assert.strictEqual(resRoot.status, 200);

  // 6.1 验证打包产物中的 Bark 接口
  const resDistBark = await distWorkerModule.fetch(new Request("http://localhost:8787/api/test-bark", { method: "POST" }), {});
  assert.strictEqual(resDistBark.status, 400);
  const resRootBark = await rootWorkerModule.fetch(new Request("http://localhost:8787/api/test-bark", { method: "POST" }), {});
  assert.strictEqual(resRootBark.status, 400);
  console.log("   ✓ 打包产物完全正常 (含 Bark 模块完整性校验)");

  console.log("\n🎉 全部功能与回归测试全部通过！");
}

runTests().catch(err => {
  console.error("❌ 测试失败:", err);
  process.exit(1);
});
