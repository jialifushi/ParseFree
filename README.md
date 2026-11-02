# ParseFree - 免费节点订阅自动抓取与格式转换服务

[![Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**ParseFree** 是一个轻量级、无外部运行时依赖的 **Cloudflare Worker / Pages** 代理订阅抓取与格式转换服务。

它能够自动订阅并抓取免费节点发布网站（如 `free.datiya.com`）每日更新的 Clash 配置，智能提取各节点信息，并将其统一转换为纯文本标准节点链接列表（输出格式与通用客户端的节点分享链接完全一致），支持直接作为订阅源导入各类主流客户端。

---

## 📑 目录

- [架构与工作原理](#-架构与工作原理)
- [核心特性](#-核心特性)
- [支持协议与转换对照](#-支持协议与转换对照)
- [部署教程](#-部署教程)
  - [方式一：Cloudflare 连接 GitHub 仓库自动部署（推荐，CI/CD 自动化）](#方式一cloudflare-连接-github-仓库自动部署推荐cicd-自动化)
  - [方式二：Cloudflare Dashboard 网页端直接粘贴代码部署（0门槛极速）](#方式二cloudflare-dashboard-网页端直接粘贴代码部署0门槛极速)
  - [方式三：Wrangler 命令行部署（开发者适用）](#方式三wrangler-命令行部署开发者适用)
  - [进阶：绑定自定义域名](#进阶绑定自定义域名)
- [🔐 账号密码与访问鉴权设置](#-账号密码与访问鉴权设置)
- [📡 订阅接口与参数详解](#-订阅接口与参数详解)
- [📱 常见客户端配置指南](#-常见客户端配置指南)
- [🧪 本地开发与测试](#-本地开发与测试)
- [❓ 常见问题 (FAQ)](#-常见问题-faq)
- [⚖️ 免责声明](#-免责声明)

---

## 🛠 架构与工作原理

```mermaid
flowchart LR
    A["客户端 / 浏览器"] -->|"携带 Token 或 Basic Auth"| B["Cloudflare Worker (ParseFree)"]
    B -->|"校验环境变量密码"| Auth{"身份鉴权通过?"}
    Auth -->|"否"| Err["401 Unauthorized (弹出登录弹窗)"]
    Auth -->|"是"| C{"命中边缘缓存?"}
    C -->|"是"| D["立即秒级返回"]
    C -->|"否"| E["动态抓取源站 (free.datiya.com)"]
    E -->|"解析最新文章 / 智能日期回退"| F["获取最新 Clash YAML"]
    F -->|"提取代理节点"| G["轻量 YAML 解析器"]
    G -->|"协议转换引擎"| H["生成通用节点 URI 列表"]
    H -->|"写入 Cloudflare 缓存"| D
```

1. **安全鉴权防护**：支持配置环境变量密码，未授权访问自动拦截，防止订阅泄露或滥用。
2. **智能动态探测**：优先访问源站首页，提取最新发布的文章链接并抓取其当期绑定的 Clash YAML。若网站凌晨尚未发布新文章，会自动启动**多日回溯探测机制**（回溯 1~3 天），保证 24 小时随时获取可用节点。
3. **纯自研轻量解析**：Worker 内部内置了纯原生实现的 Clash Flow/Block 两种风格 YAML 语法解析器，零 npm 外部打包负担，执行速度极快。
4. **边缘加速与防封缓存**：利用 Cloudflare Cache API 缓存 30 分钟，既可免除源站防刷封控，又可提供全球毫秒级订阅更新响应。

---

## ✨ 核心特性

- 🔄 **每日自动同步**：无需手动每天修改订阅地址或日期，Worker 自动定位并同步最新节点。
- 🔒 **访问安全鉴权**：支持配置账号密码或 Token 访问，支持 HTTP Basic Auth 及 URL `?token=xxx` 参数。
- 🛡️ **高可用容错机制**：源站未更新或网络抖动时自动降级回退，永不返回空白 404。
- 🎯 **全协议兼容**：支持 VMess、Shadowsocks、AnyTLS、Trojan、VLESS、Hysteria 2、TUIC。
- 💻 **优雅后台控制台**：直接在浏览器访问即可查看节点总数、鉴权状态，并支持一键复制。
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

无需连接 GitHub，适合不想授权仓库的用户：

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

## 🔐 账号密码与访问鉴权设置

本项目支持通过 Cloudflare **环境变量 (Environment Variables)** 配置安全认证，防止他人未授权盗用您的订阅服务。

### 1. 环境变量配置说明

在 Cloudflare 项目的 **Settings (设置) -> Variables and Secrets (变量和密码)** 中添加以下变量：

| 变量名称 | 是否必填 | 示例值 | 说明 |
| :--- | :--- | :--- | :--- |
| **`AUTH_PASSWORD`** | 推荐 | `MySecret2026` | 访问密钥 / 密码（也可设置 `AUTH_TOKEN`） |
| **`AUTH_USERNAME`** | 可选 | `admin` | 访问用户名（若不填，则只需匹配密码即可） |

> **提示**：若未配置任何上述变量，服务默认处于**公开访问**模式。

---

### 2. 携带凭证的访问方式

一旦开启了访问鉴权，可以通过以下任意一种方式完成鉴权认证：

#### 方式 A：URL 查询参数（最简便，推荐导入客户端使用）
在订阅链接或页面地址末尾追加 `?token=您的密码`：
```
https://your-worker.workers.dev/sub?token=MySecret2026
```
*(若同时配置了 `AUTH_USERNAME`，可使用 `?user=admin&token=MySecret2026`)*

#### 方式 B：标准 URL 认证格式
直接将账号密码嵌入到 URL 前缀中：
```
https://admin:MySecret2026@your-worker.workers.dev/sub
```

#### 方式 C：浏览器原生弹窗认证（网页端）
直接在浏览器中访问 `https://your-worker.workers.dev/`：
- 浏览器会自动弹出原生的 **HTTP Basic Auth 登录对话框**；
- 输入您设置的用户名与密码即可登录；
- 登录成功后，Web 控制台的“一键复制订阅链接”按钮会**自动附带**您的凭据参数，直接复制即可使用！

---

## 📡 订阅接口与参数详解

| 接口 / 参数 | 完整示例 | 用途说明 |
| :--- | :--- | :--- |
| **Web 首页** | `https://your-domain/?token=xxx` | 可视化查看可用节点总数、鉴权状态及一键复制 |
| **通用明文订阅** | `https://your-domain/sub?token=xxx` | **与 `格式.txt` 结构一致**，每行一个节点，现代客户端首选 |
| **Base64 订阅** | `https://your-domain/sub?b64=1&token=xxx` | 输出 Base64 编码文本，兼容仅识别 Base64 的旧版客户端 |
| **地区关键词过滤** | `https://your-domain/sub?filter=香港&token=xxx` | 仅拉取节点名称中包含“香港”的节点 |
| **指定外部源** | `https://your-domain/sub?source=https://...&token=xxx` | 传入任意外部 Clash YAML 链接或订阅进行在线解析转换 |
| **强制刷新缓存** | `https://your-domain/sub?refresh=1&token=xxx` | 立即穿透 Cloudflare 边缘缓存，重新抓取最新源站数据 |

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

#### Q1: 开启密码保护后，客户端更新提示 401 Unauthorized？
**答**：请检查客户端填写的订阅链接中是否附带了 `?token=您的密码` 参数，或者密码是否与 Cloudflare 中配置的 `AUTH_PASSWORD` 一致。

#### Q2: 凌晨访问时，网站还没发布当天的订阅怎么办？
**答**：Worker 内置了多日容错算法。若当天尚未发文，会按当前时间依次探测前 1 天、前 2 天的配置，确保始终返回最新有效的可用节点，不会报 404 或返回空列表。

#### Q3: 为什么有的节点连接不通？
**答**：上游网站的节点来自网络免费收集与分享，可能受网络波动或服务商策略影响。建议在客户端中使用“延迟测试/批量连通性测试”筛选出低延迟节点使用。

---

## ⚖️ 免责声明

1. 本项目仅供网络技术研究、Cloudflare Workers 开发学习与个人网络调试使用。
2. 抓取的节点均来自互联网公开渠道，本项目不对节点的可用性、稳定性与安全性作任何承诺。
3. 使用本项目时请严格遵守所在国家与地区的法律法规。
