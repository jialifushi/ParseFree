# ParseFree - 免费节点订阅自动抓取与格式转换服务

[![Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**ParseFree** 是一个轻量级、无外部运行时依赖的 **Cloudflare Worker** 代理订阅抓取与格式转换服务。

它能够自动订阅并抓取免费节点发布网站（如 `free.datiya.com`）每日更新的 Clash 配置，智能提取各节点信息，并将其统一转换为纯文本标准节点链接列表（输出格式与通用客户端的节点分享链接完全一致），支持直接作为订阅源导入各类主流客户端。

---

## 📑 目录

- [架构与工作原理](#-架构与工作原理)
- [核心特性](#-核心特性)
- [支持协议与转换对照](#-支持协议与转换对照)
- [部署教程](#-部署教程)
  - [方式一：Cloudflare Dashboard 网页端部署（推荐，0门槛）](#方式一cloudflare-dashboard-网页端部署推荐0门槛)
  - [方式二：Wrangler 命令行部署（开发者适用）](#方式二wrangler-命令行部署开发者适用)
  - [进阶：绑定自定义域名](#进阶绑定自定义域名)
- [订阅接口与参数详解](#-订阅接口与参数详解)
- [常见客户端配置指南](#-常见客户端配置指南)
- [本地开发与测试](#-本地开发与测试)
- [常见问题 (FAQ)](#-常见问题-faq)
- [免责声明](#-免责声明)

---

## 🛠 架构与工作原理

```mermaid
flowchart LR
    A["客户端 / 浏览器"] -->|"请求 /sub 或 /"| B["Cloudflare Worker (ParseFree)"]
    B -->|"检查边缘缓存"| C{"命中缓存?"}
    C -->|"是"| D["立即秒级返回"]
    C -->|"否"| E["动态抓取源站 (free.datiya.com)"]
    E -->|"解析最新文章 / 智能日期回退"| F["获取最新 Clash YAML"]
    F -->|"提取代理节点"| G["轻量 YAML 解析器"]
    G -->|"协议转换引擎"| H["生成通用节点 URI 列表"]
    H -->|"写入 Cloudflare 缓存"| D
```

1. **智能动态探测**：优先访问源站首页，提取最新发布的文章链接并抓取其当期绑定的 Clash YAML。若网站凌晨尚未发布新文章，会自动启动**多日回溯探测机制**（回溯 1~3 天），保证 24 小时随时获取可用节点。
2. **纯自研轻量解析**：Worker 内部内置了纯原生实现的 Clash Flow/Block 两种风格 YAML 语法解析器，零 npm 外部打包负担，执行速度极快。
3. **边缘加速与防封缓存**：默认利用 Cloudflare Cache API 缓存 30 分钟，既可免除源站防刷封控，又可提供全球毫秒级订阅更新响应。

---

## ✨ 核心特性

- 🔄 **每日自动同步**：无需手动每天修改订阅地址或日期，Worker 自动定位并同步最新节点。
- 🛡️ **高可用容错机制**：源站未更新或网络抖动时自动降级回退，永不返回空白 404。
- 🎯 **全协议兼容**：支持 VMess、Shadowsocks、AnyTLS、Trojan、VLESS、Hysteria 2、TUIC。
- 💻 **优雅后台控制台**：直接在浏览器访问即可查看节点总数、状态列表，并支持一键复制到剪贴板。
- ⚡ **开箱即用**：提供开箱即用的单文件版 [`dist/worker.js`](dist/worker.js)，复制粘贴即可一键部署。

---

## 📋 支持协议与转换对照

转换生成的节点格式与 [`格式.txt`](格式.txt) 完全对齐：

| 协议类型 | 输出节点 URI 格式 | 说明 |
| :--- | :--- | :--- |
| **VMess** | `vmess://<Base64-JSON>` | 采用 V2RayN 标准 JSON 格式，全平台通用，自动保留 TLS/WS 等参数 |
| **Shadowsocks** | `ss://<Base64(cipher:password)>@host:port#name` | SIP002 标准格式 |
| **AnyTLS** | `anytls://password@host:port?security=tls&sni=...#name` | AnyTLS 协议标准分享链接 |
| **Trojan** | `trojan://password@host:port?security=tls&sni=...#name` | 标准 Trojan 链接 |
| **VLESS** | `vless://uuid@host:port?security=...&sni=...#name` | 标准 VLESS 链接 |
| **Hysteria 2** | `hysteria2://password@host:port?sni=...#name` | 标准 Hysteria2 链接 |
| **TUIC** | `tuic://uuid:password@host:port?sni=...#name` | 标准 TUIC 链接 |

---

## 🚀 部署教程

### 方式一：Cloudflare Dashboard 网页端部署（推荐，0门槛）

适合无 Node.js 环境或希望快速上线的用户，仅需 1 分钟：

1. **注册或登录 Cloudflare**
   - 打开 [Cloudflare 控制台](https://dash.cloudflare.com/) 并登录账号。
2. **创建 Worker 服务**
   - 在左侧菜单栏点击 **Compute (Workers) -> Workers & Pages**。
   - 点击页面右上方的 **Create Worker**（创建 Worker）。
   - 填写您喜欢的名称（例如 `parsefree`），点击右下角的 **Deploy**。
3. **粘贴代码并发布**
   - 部署成功后，在当前页面点击右上角的 **Edit Code**（编辑代码）。
   - 打开本项目中的 [**`dist/worker.js`**](dist/worker.js) 文件，复制其**全部代码**。
   - 回到 Cloudflare 的网页代码编辑器中，按 `Ctrl+A`（Mac 为 `Cmd+A`）全选原有的示例代码并按 Backspace 删除。
   - 将复制的 `dist/worker.js` 代码粘贴进去。
   - 点击右上角蓝色的 **Save and Deploy**（保存并部署）按钮。
4. **验证上线**
   - 点击编辑器左上角返回，在 Worker 详情页复制分配的 `workers.dev` 域名（例如 `https://parsefree.yourname.workers.dev`）。
   - 在浏览器中打开该地址，若能正常展示节点可视化面板，即表示部署成功！

---

### 方式二：Wrangler 命令行部署（开发者适用）

如果您习惯使用本地命令行工具：

1. **克隆代码到本地**
   ```bash
   git clone https://github.com/jialifushi/ParseFree.git
   cd ParseFree
   ```
2. **安装依赖**
   ```bash
   npm install
   ```
3. **登录 Cloudflare 账号**
   ```bash
   npx wrangler login
   ```
4. **本地开发调试（可选）**
   ```bash
   npm run dev
   ```
5. **构建并一键部署**
   ```bash
   npm run build
   npm run deploy
   ```

---

### 进阶：绑定自定义域名

若您所在网络访问 `*.workers.dev` 受到限制，可以在 Cloudflare 控制台直接绑定自己的域名：

1. 在 Cloudflare Dashboard 打开已部署的 Worker。
2. 点击 **Settings (设置)** -> **Domains & Routes (域和路由)**。
3. 点击 **Add -> Custom Domain (自定义域)**。
4. 输入您托管在 Cloudflare 上的二级域名（如 `sub.yourdomain.com`），点击 **Add Custom Domain**。
5. 等待 1~2 分钟 SSL 证书自动签发后，即可使用您的专属域名作为订阅地址！

---

## 📡 订阅接口与参数详解

部署完成后，将 `https://your-worker.workers.dev` 替换为您的实际服务地址：

| 接口 / 参数 | 完整示例 | 用途说明 |
| :--- | :--- | :--- |
| **Web 首页** | `https://your-worker.workers.dev/` | 浏览器直接打开，可视化查看可用节点总数、状态及一键复制 |
| **通用明文订阅** | `https://your-worker.workers.dev/sub` | **与 `格式.txt` 结构一致**，每行一个节点，适用于现代客户端 |
| **Base64 订阅** | `https://your-worker.workers.dev/sub?b64=1` | 输出 Base64 编码文本，兼容仅识别 Base64 的旧版客户端 |
| **地区关键词过滤** | `https://your-worker.workers.dev/sub?filter=香港` | 仅拉取节点名称中包含“香港”的节点 |
| **指定外部源** | `https://your-worker.workers.dev/sub?source=https://...` | 传入任意外部 Clash YAML 链接或订阅进行在线解析与格式转换 |
| **强制刷新缓存** | `https://your-worker.workers.dev/sub?refresh=1` | 立即穿透 Cloudflare 边缘缓存，重新抓取最新源站数据 |

---

## 📱 常见客户端配置指南

### 1. Shadowrocket (小火箭 - iOS)
1. 打开 Shadowrocket，点击右上角 `+` 号。
2. 类型选择 **Subscribe (订阅)**。
3. URL 填入 `https://your-worker.workers.dev/sub`。
4. 备注填写 `ParseFree`，点击右上角“完成”。
5. 下拉列表即可刷新并获取全部节点。

### 2. v2rayN (Windows)
1. 点击上方菜单栏 **订阅分组** -> **订阅分组设置**。
2. 点击 **添加**，在“可选地址 (url)”一栏填入 `https://your-worker.workers.dev/sub`（或带有 `?b64=1` 的链接）。
3. 别名填写 `ParseFree`，点击确定。
4. 点击菜单栏 **订阅分组** -> **更新全部订阅(不通过代理)** 即可。

### 3. Sing-box / NekoBox (Android / 多平台)
1. 打开客户端，在分组/订阅处新建配置。
2. 类型选择格式为常规订阅链接，输入 `https://your-worker.workers.dev/sub`。
3. 更新订阅后即可使用。

---

## 🧪 本地开发与测试

本项目提供了完整的自动化集成测试，覆盖了 Web 路由、订阅解析、Base64 编码、单文件打包等所有路径：

```bash
# 运行单元与集成测试
npm test

# 重新打包单文件 dist/worker.js
npm run build
```

---

## ❓ 常见问题 (FAQ)

#### Q1: 凌晨访问时，网站还没发布当天的订阅怎么办？
**答**：Worker 内置了多日容错算法。若当天尚未发文，会按当前时间依次探测前 1 天、前 2 天的配置，确保始终返回最新有效的可用节点，不会报 404 或返回空列表。

#### Q2: 客户端订阅更新时提示“超时”或“连接失败”？
**答**：因部分地区的网络运营商可能会对 `*.workers.dev` 域名做 DNS 污染或限速。建议参考 [进阶：绑定自定义域名](#进阶绑定自定义域名) 章节绑定一个自己的二级域名。

#### Q3: 为什么有的节点连接不通？
**答**：上游网站的节点来自网络免费收集与分享，可能受网络波动或服务商策略影响。建议在客户端中使用“延迟测试/批量连通性测试”筛选出低延迟节点使用。

---

## ⚖️ 免责声明

1. 本项目仅供网络技术研究、Cloudflare Workers 开发学习与个人网络调试使用。
2. 抓取的节点均来自互联网公开渠道，本项目不对节点的可用性、稳定性与安全性作任何承诺。
3. 使用本项目时请严格遵守所在国家与地区的法律法规。
