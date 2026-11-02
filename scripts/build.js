import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const parserCode = fs.readFileSync(path.join(rootDir, "src/parser.js"), "utf8");
const scraperCode = fs.readFileSync(path.join(rootDir, "src/scraper.js"), "utf8");
const uiCode = fs.readFileSync(path.join(rootDir, "src/ui.js"), "utf8");
const indexCode = fs.readFileSync(path.join(rootDir, "src/index.js"), "utf8");

function cleanModule(code) {
  return code
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, "")
    .replace(/^export\s+(async\s+function|function|const|let|var)\s+/gm, "$1 ")
    .trim();
}

const cleanedParser = cleanModule(parserCode);
const cleanedScraper = cleanModule(scraperCode);
const cleanedUi = cleanModule(uiCode);
const cleanedIndex = indexCode.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, "").trim();

const bundleContent = `/**
 * ParseFree - Cloudflare Worker 单文件独立运行版本
 * 适合直接复制全文粘贴到 Cloudflare Dashboard 在线代码编辑器中一键保存并部署
 *
 * 核心功能：
 * 1. 每日自动抓取免费节点站点（free.datiya.com 等）最新的 Clash 配置
 * 2. 智能容错回退机制（今日未更新自动探测前 1~3 天可用数据）
 * 3. 实时将 Clash YAML 节点转为标准节点 URI（与 格式.txt 结构一致）
 * 4. 支持浏览器 Web 可视化面板、通用明文订阅 (/sub)、Base64 订阅 (?b64=1)
 */

// ==================== 1. UI 渲染模块 ====================
${cleanedUi}

// ==================== 2. 节点解析与转换模块 ====================
${cleanedParser}

// ==================== 3. 动态抓取与容错模块 ====================
${cleanedScraper}

// ==================== 4. Worker 主入口 ====================
${cleanedIndex}
`;

const distDir = path.join(rootDir, "dist");
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.writeFileSync(path.join(distDir, "worker.js"), bundleContent, "utf8");
console.log("打包成功: dist/worker.js");
