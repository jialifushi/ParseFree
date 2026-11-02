# ParseFree - 免费节点订阅自动抓取与格式转换服务

[![Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**ParseFree** 是一个轻量级、无外部运行时依赖的 **Cloudflare Worker / Pages** 代理订阅抓取与格式转换服务。

它能够自动订阅并抓取免费节点发布网站（如 `free.datiya.com`）每日更新的节点配置，智能提取各节点信息，并将其统一转换为纯文本标准节点链接列表（输出格式与通用客户端的节点分享链接完全一致），支持直接作为订阅源导入各类主流客户端。

---

## 📑 目录

- [核心工作机制（自动递增与停止探测）](#-核心工作机制自动递增与停止探测)
- [核心特性](#-核心特性)
- [支持协议与转换对照](#-支持协议与转换对照)
- [部署教程](#-部署教程)
  - [方式一：Cloudflare 连接 GitHub 仓库自动部署（推荐，CI/CD 自动化）](#方式一cloudflare-连接-github-仓库自动部署推荐cicd-自动化)
  - [方式二：Cloudflare Dashboard 网页端直接粘贴代码部署（0门槛极速）](#方式二cloudflare-dashboard-网页端直接粘贴代码部署0门槛极速)
  - [方式三：Wrangler 命令行部署（开发者适用）](#方式三wrangler-命令行部署开发者适用)
  - [进阶：绑定自定义域名](#进阶绑定自定义域名)
- [🔄 运行模式与数据源配置](#-运行模式与数据源配置)
  - [1. 自动日期递增模式 (Auto Date Mode)](#1-自动日期递增模式-auto-date-mode)
  - [2. 手动编辑地址模式 (Manual Mode)](#2-手动编辑地址模式-manual-mode)
  - [3. Clash 与 V2Ray 格式源支持](#3-clash-与-v2ray-格式源支持)
- [🔐 账号密码与访问鉴权设置](#-账号密码与访问鉴权设置)
- [📡 订阅接口与参数详解](#-订阅接口与参数详解)
- [📱 常见客户端配置指南](#-常见客户端配置指南)
- [🧪 本地开发与测试](#-本地开发与测试)
- [❓ 常见问题 (FAQ)](#-常见问题-faq)
- [⚖️ 免责声明](#-免责声明)

---

## 🔄 核心工作机制（自动递增与停止探测）

```mermaid
flowchart TD
    A["每日 00:00 (北京时间 UTC+8)"] --> B["目标日期自动递增为今日 YYYYMMDD"]
    B --> C{"今日数据是否已成功获取?"}
    C -->|"是 (已就绪)"| D["锁定状态：停止定时探测，直接返回今日数据"]
    C -->|"否 (未就绪)"| E["探测今日地址：https://free.datiya.com/uploads/YYYYMMDD-clash.yaml"]
    E --> F{"今日源已上传并可用?"}
    F -->|"是"| G["成功获取！保存并标记已就绪，立即停止后续探测"]
    F -->|"否 (404/暂未发布)"| H["自动平滑回退使用昨日有效数据，保证服务不中断"]
    H --> I["等待下次请求或 Cron 定时任务继续探测今日新源"]
    G --> D
```

1. **每日 00 点后自动递增**：每天北京时间 00:00 之后，系统自动将目标地址的日期递增为当天，例如：
   - `https://free.datiya.com/uploads/20261102-clash.yaml`
   - `https://free.datiya.com/uploads/20261103-clash.yaml`
   - `https://free.datiya.com/uploads/20261104-clash.yaml`（以此类推）
2. **一旦拿到数据立即停止探测**：今日最新数据一旦成功抓取，系统立即在内存/缓存中锁定标记为“今日已就绪”，当天后续的全部访问与 Cron 定时任务均直接使用该数据，**完全停止多余的定时探测**，既不浪费 Cloudflare 请求次数，又不会对源站造成额外压力。
3. **凌晨未发布平滑回溯**：若源站站长在当天凌晨尚未上传当天新文件（返回 404），系统自动向前回溯使用昨天或前天的有效节点，确保客户端订阅永不中断。

---

## ✨ 核心特性

- 🔄 **自动日期更新 + 成功后停止探测**：无需手动修改日期，每日 00 点后自动更新并智能锁定。
- 📝 **支持手动编辑地址**：在 Web 界面或环境变量中随时手动指定、编辑任何固定订阅地址。
- 🌐 **双格式源支持 (Clash / V2Ray)**：支持从 Clash (`.yaml`) 或 V2Ray (`.txt`) 获取源数据，并具备防漏发自动兜底机制。
- 🔒 **访问安全鉴权**：支持配置账号密码保护（`AUTH_PASSWORD` / `AUTH_USERNAME`），防止订阅被他人盗用。
- 🎯 **全协议标准转换**：实时将节点转换为标准节点 URI 链接（与 [`格式.txt`](格式.txt) 完全对齐），支持小火箭、v2rayN、Sing-box 等。
- 💻 **优雅后台控制台**：浏览器直接打开即可切换模式、编辑地址、查看可用节点列表并一键复制。
- ⚡ **开箱即用**：提供开箱即用的单文件版 [`dist/worker.js`](dist/worker.js) 与根目录 [`_worker.js`](_worker.js)，全平台自适应。

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

### 方式一：Cloudflare 连接 GitHub 仓库自动部署（推荐，CI/CD 自动化）

通过 Cloudflare 直接连接您的 GitHub 仓库完成部署，以后仓库每次更新代码，Cloudflare 都会自动拉取并重新构建发布！

1. **在 Cloudflare 创建项目**
   - 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
   - 在左侧菜单中进入 **Compute (Workers) -> Workers & Pages**。
   - 点击 **Create (创建)** -> **Create Application (创建应用程序)**。
   - 在“创建新项目”列表中，点击 **Continue with GitHub (通过 GitHub 继续)**。
2. **选择代码仓库**
   - 授权 Cloudflare 访问您的 GitHub，并从仓库列表中选择：**`jialifushi/ParseFree`**。
3. **配置构建与环境变量**
   - **项目名称 (Project name)**：自定义（如 `parsefree`）。
   - **框架预设 (Framework preset)**：选择 **None**。
   - **构建命令 (Build command)**：留空（或填 `npm run build`）。
   - **输出目录 (Build output directory)**：留空（项目根目录自带 `_worker.js` 与 `wrangler.toml`，Cloudflare 会自动识别）。
   - **环境变量 (Environment variables)**（可选，配置账号密码）：
     - 点击展开 **Environment variables**；
     - 添加 `AUTH_PASSWORD`，填入您的密码（如 `MySecret2026`）；
     - 可选添加 `AUTH_USERNAME`，填入用户名（如 `admin`）。
4. **保存并部署**
   - 点击底部的 **Save and Deploy (保存并部署)**。
   - 等待约 30 秒，项目即部署完成并生成专属访问域名！

---

### 方式二：Cloudflare Dashboard 网页端直接粘贴代码部署（0门槛极速）

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，点击 **Workers & Pages -> Create Worker**。
2. 命名后点击 **Deploy**，接着点击右上角 **Edit Code**。
3. 打开本项目中的 [**`dist/worker.js`**](dist/worker.js) 文件，复制其全部代码。
4. 清空网页编辑器中的默认代码，粘贴复制的内容，点击右上角 **Save and Deploy** 即可完成！
5. 如需设置密码：在 Worker 详情页进入 **Settings -> Variables and Secrets** 添加 `AUTH_PASSWORD` 即可。

---

### 方式三：Wrangler 命令行部署（开发者适用）

```bash
# 1. 克隆代码
git clone https://github.com/jialifushi/ParseFree.git
cd ParseFree

# 2. 安装依赖并登录
npm install
npx wrangler login

# 3. 本地调试与部署
npm run build
npm run deploy
```

---

### 进阶：绑定自定义域名

若您所在地区访问 `*.workers.dev` 受到干扰，建议绑定自己的二级域名：

1. 在 Cloudflare Dashboard 打开已部署的项目。
2. 点击 **Settings (设置)** -> **Domains & Routes (域和路由)**。
3. 点击 **Add -> Custom Domain (自定义域)**，输入托管在 Cloudflare 上的域名（如 `sub.yourdomain.com`）。
4. 稍等 1~2 分钟证书生效后，即可使用该专属域名作为订阅地址！

---

## 🔄 运行模式与数据源配置

### 1. 自动日期递增模式 (Auto Date Mode)
- **默认模式**：无需任何配置，系统自动计算北京时间。
- 每天 00:00 自动将日期递增为当天，自动探测当天地址（例如 `.../20261103-clash.yaml`）；
- **一旦拿到数据，立即停止后续定时获取并锁定**；
- 若当天未出，自动回退使用昨日有效节点。

### 2. 手动编辑地址模式 (Manual Mode)
- **Web 界面即时编辑**：在浏览器打开 Worker 首页，切换到“手动编辑指定地址模式”，在输入框中填入任意地址并点击“应用此地址”，系统会实时解析该地址并生成对应的订阅链接。
- **URL 参数直连**：直接在订阅链接追加 `?source=目标URL`：
  ```text
  https://your-worker.workers.dev/sub?source=https://free.datiya.com/uploads/20261102-clash.yaml
  ```
- **环境变量固定**：在 Cloudflare 环境变量中添加 `CUSTOM_SOURCE_URL=https://...` 即可全局固定源地址。

### 3. Clash 与 V2Ray 格式源支持
- 支持获取 Clash 格式（`...-clash.yaml`）或 V2Ray 格式（`...-v2ray.txt`）；
- 在 Web 控制台可一键切换，或在链接追加 `?type=v2ray` / `?type=clash`；
- **防漏发兜底机制**：若源站某天上传的 `v2ray.txt` 出现空白或未更新，系统会自动切换读取同期的 `clash.yaml`，确保始终能拿到节点！

---

## 🔐 账号密码与访问鉴权设置

### 1. 环境变量配置说明

在 Cloudflare 项目的 **Settings (设置) -> Variables and Secrets (变量和密码)** 中添加以下变量：

| 变量名称 | 是否必填 | 示例值 | 说明 |
| :--- | :--- | :--- | :--- |
| **`AUTH_PASSWORD`** | 推荐 | `MySecret2026` | 访问密钥 / 密码（也可设置 `AUTH_TOKEN`） |
| **`AUTH_USERNAME`** | 可选 | `admin` | 访问用户名（若不填，客户端只需匹配密码即可） |

---

### 2. 携带凭证的访问方式

- **方式 A：URL 查询参数（最简便，推荐导入客户端）**
  在客户端填写的订阅链接末尾直接追加 `?token=您的密码`：
  ```text
  https://your-worker.workers.dev/sub?token=MySecret2026
  ```
- **方式 B：标准 URL 认证格式**
  ```text
  https://admin:MySecret2026@your-worker.workers.dev/sub
  ```
- **方式 C：浏览器 Web 控制台原生登录**
  直接在浏览器中打开 Worker 地址，会自动弹出 HTTP Basic Auth 登录对话框，输入用户名和密码即可。登录后复制订阅链接会自动附带您的 token 参数！

---

## 📡 订阅接口与参数详解

| 接口 / 参数 | 完整示例 | 用途说明 |
| :--- | :--- | :--- |
| **Web 控制台** | `https://your-domain/?token=xxx` | 可视化查看状态、切换模式、手动编辑地址及一键复制 |
| **通用明文订阅** | `https://your-domain/sub?token=xxx` | **与 `格式.txt` 结构一致**，每行一个节点，现代客户端首选 |
| **Base64 订阅** | `https://your-domain/sub?b64=1&token=xxx` | 输出 Base64 编码文本，兼容仅识别 Base64 的旧版客户端 |
| **指定 V2Ray 源** | `https://your-domain/sub?type=v2ray&token=xxx` | 切换为拉取 V2Ray 格式源（空内容自动兜底） |
| **手动指定外部源** | `https://your-domain/sub?source=https://...&token=xxx` | 传入任意外部 Clash/V2Ray 链接进行在线解析转换 |
| **地区关键词过滤** | `https://your-domain/sub?filter=香港&token=xxx` | 仅拉取节点名称中包含“香港”的节点 |
| **强制刷新缓存** | `https://your-domain/sub?refresh=1&token=xxx` | 立即穿透缓存，重新向源站探测 |

---

## 📱 常见客户端配置指南

### 1. Shadowrocket (小火箭 - iOS)
1. 打开 Shadowrocket，点击右上角 `+` 号。
2. 类型选择 **Subscribe (订阅)**。
3. URL 填入带凭证的链接：`https://your-worker.workers.dev/sub?token=您的密码`。
4. 备注填写 `ParseFree`，点击右上角“完成”。
5. 下拉列表即可刷新并获取全部节点。

### 2. v2rayN (Windows)
1. 点击上方菜单栏 **订阅分组** -> **订阅分组设置**。
2. 点击 **添加**，在“可选地址 (url)”一栏填入带凭证的链接。
3. 别名填写 `ParseFree`，点击确定。
4. 点击菜单栏 **订阅分组** -> **更新全部订阅(不通过代理)** 即可。

### 3. Sing-box / NekoBox (Android / 多平台)
1. 打开客户端，在分组/订阅处新建配置。
2. 类型选择格式为常规订阅链接，输入 `https://your-worker.workers.dev/sub?token=您的密码`。
3. 更新订阅后即可使用。

---

## 🧪 本地开发与测试

```bash
# 运行全部集成与鉴权自动化测试
npm test

# 重新构建单文件 dist/worker.js 与 _worker.js
npm run build
```

---

## ❓ 常见问题 (FAQ)

#### Q1: 00点刚过，源站还没发布当天的订阅怎么办？
**答**：Worker 具有多日容错回溯算法。00 点后探测当天地址若返回 404，会自动回退使用昨天（或前天）的有效节点，保证客户端订阅不断线；待后续源站上传后，会自动抓取今日新数据并立刻锁定。

#### Q2: 开启密码保护后，客户端更新提示 401 Unauthorized？
**答**：请检查客户端填写的订阅链接中是否附带了 `?token=您的密码` 参数，或者密码是否与 Cloudflare 中配置的 `AUTH_PASSWORD` 一致。

#### Q3: 为什么有的节点连接不通？
**答**：上游网站的节点来自网络免费收集与分享，可能受网络波动或服务商策略影响。建议在客户端中使用“延迟测试/批量连通性测试”筛选出低延迟节点使用。

---

## ⚖️ 免责声明

1. 本项目仅供网络技术研究、Cloudflare Workers 开发学习与个人网络调试使用。
2. 抓取的节点均来自互联网公开渠道，本项目不对节点的可用性、稳定性与安全性作任何承诺。
3. 使用本项目时请严格遵守所在国家与地区的法律法规。
