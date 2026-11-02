import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const utilsCode = fs.readFileSync(path.join(rootDir, "src/utils.js"), "utf8");
const formatterCode = fs.readFileSync(path.join(rootDir, "src/formatter.js"), "utf8");
const parserCode = fs.readFileSync(path.join(rootDir, "src/parser.js"), "utf8");
const scraperCode = fs.readFileSync(path.join(rootDir, "src/scraper.js"), "utf8");
const uiCode = fs.readFileSync(path.join(rootDir, "src/ui.js"), "utf8");
const authCode = fs.readFileSync(path.join(rootDir, "src/auth.js"), "utf8");
const indexCode = fs.readFileSync(path.join(rootDir, "src/index.js"), "utf8");

function cleanModule(code) {
  return code
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, "")
    .replace(/^export\s+(async\s+function|function|const|let|var)\s+/gm, "$1 ")
    .trim();
}

const cleanedUtils = cleanModule(utilsCode);
const cleanedFormatter = cleanModule(formatterCode);
const cleanedParser = cleanModule(parserCode);
const cleanedScraper = cleanModule(scraperCode);
const cleanedUi = cleanModule(uiCode);
const cleanedAuth = cleanModule(authCode);
const cleanedIndex = indexCode.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, "").trim();

const bundleContent = `/**
 * ParseFree - Cloudflare Worker / Pages 单文件独立运行版本
 * 适合直接复制全文粘贴到 Cloudflare Dashboard 在线代码编辑器中一键保存并部署
 * 或作为 Pages _worker.js 自动运行
 *
 * 核心功能：
 * 1. 每日自动抓取免费节点站点（free.datiya.com 等）最新的 Clash 配置
 * 2. 智能容错回退机制（今日未更新自动探测前 1~3 天可用数据）
 * 3. 实时将 Clash YAML 节点转为标准节点 URI（与 格式.txt 结构一致）
 * 4. 支持账号密码访问保护（AUTH_USERNAME / AUTH_PASSWORD / AUTH_TOKEN 环境变量）
 * 5. 支持浏览器 Web 可视化面板、通用明文订阅 (/sub)、Base64 订阅 (?b64=1)
 */

// ==================== 1. 通用工具模块 ====================
${cleanedUtils}

// ==================== 2. 协议格式化模块 ====================
${cleanedFormatter}

// ==================== 3. 节点解析模块 ====================
${cleanedParser}

// ==================== 4. 动态抓取与容错模块 ====================
${cleanedScraper}

// ==================== 5. 账号密码鉴权模块 ====================
${cleanedAuth}

// ==================== 6. UI 渲染模块 ====================
${cleanedUi}

// ==================== 7. Worker 主入口 ====================
${cleanedIndex}
`;

const distDir = path.join(rootDir, "dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(path.join(distDir, "worker.js"), bundleContent, "utf8");
fs.writeFileSync(path.join(rootDir, "_worker.js"), bundleContent, "utf8");
console.log("打包成功: dist/worker.js 与 _worker.js");
