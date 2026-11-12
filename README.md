# ParseFree - 免费节点订阅自动抓取与格式转换服务

[![Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**ParseFree** 是一个轻量级、无外部运行时依赖的 **Cloudflare Worker / Pages** 代理订阅抓取与格式转换服务。

它能够自动订阅并抓取免费节点发布网站（如 `free.datiya.com`）每日更新的节点配置，智能提取各节点信息，并将其统一转换为纯文本标准节点链接列表（输出格式与通用客户端的节点分享链接完全一致），支持直接作为订阅源导入各类主流客户端。

---

## 📑 目录

- [核心工作机制（自动递增、锁定与失败重试退避）](#-核心工作机制自动递增锁定与失败重试退避)
- [🏷️ 节点清洗与自动日后缀 (02/03) 识别更新](#️-节点清洗与自动日后缀-0203-识别更新)
- [核心特性](#-核心特性)
- [支持协议与转换对照](#-支持协议与转换对照)
- [部署教程](#-部署教程)
  - [方式一：Cloudflare 连接 GitHub 仓库自动部署（推荐，CI/CD 自动化）](#方式一cloudflare-连接-github-仓库自动部署推荐cicd-自动化)
  - [方式二：Cloudflare Dashboard 网页端直接粘贴代码部署（0门槛极速）](#方式二cloudflare-dashboard-网页端直接粘贴代码部署0门槛极速)
  - [方式三：Wrangler 命令行部署（开发者适用）](#方式三wrangler-命令行部署开发者适用)
  - [进阶：绑定自定义域名](#进阶绑定自定义域名)
- [🔄 运行模式、数据源与探测间隔配置](#-运行模式数据源与探测间隔配置)
- [🔐 账号密码与访问鉴权设置](#-账号密码与访问鉴权设置)
- [📡 订阅接口与参数详解](#-订阅接口与参数详解)
- [📱 常见客户端配置指南](#-常见客户端配置指南)
- [🧪 本地开发与测试](#-本地开发与测试)
- [❓ 常见问题 (FAQ)](#-常见问题-faq)
- [⚖️ 免责声明](#-免责声明)

---

## 🔄 核心工作机制（自动递增、锁定与失败重试退避）

```mermaid
flowchart TD
    A["每日 00:00 (北京时间 UTC+8)"] --> B["目标日期自动递增为今日 YYYYMMDD"]
    B --> C{"今日数据是否已成功获取?"}
    C -->|"是 (已锁定)"| D["停止定时探测，直接返回今日最新数据"]
    C -->|"否 (未就绪)"| E{"是否在失败重试冷却期内?"}
    E -->|"是 (冷却中)"| F["避免频繁请求！直接返回最新已获取到的数据 (自动回退)"]
    E -->|"否 (间隔期满)"| G["发起今日地址探测 (https://.../YYYYMMDD-clash.yaml)"]
    G --> H{"今日源已上传并可用?"}
    H -->|"成功"| I["锁定今日状态并清空失败标记，彻底停止后续探测！"]
    H -->|"失败 (404/空内容)"| J["记录失败时间戳，启动间隔退避，回退返回最新有效数据"]
    I --> D
    J --> F
```

1. **每日 00 点后自动递增**：每天北京时间 00:00 之后，目标地址日期自动切换为当天（`YYYYMMDD`，例如 `20261102`、`20261103`、`20261104` 依此类推）。
2. **今日一旦拿到数据立即停止探测**：成功抓取到当天新文件后，状态机立刻锁定并标记为已就绪，当天后续所有请求与 Cron 定时任务**完全停止多余的定时探测**。
3. **合理的失败重试冷却间隔（支持自定义）**：
   - 00 点后若当天新源尚未上传（源站 404），系统会启动失败退避机制（默认间隔 **10 分钟**，可在 Web 界面、环境变量或参数中自定义）；
   - **在失败冷却期内，系统不会频繁向源站发起重复网络请求，而是自动平滑回退显示“最新获取到的有效数据”**；
   - 只有当重试间隔期满后，新的请求或 Cron 任务才会再次发起探测。
4. **实时请求时间与动态倒计时（成功后锁定至次日0点）**：
   - Web 控制台界面与订阅响应标头实时展示**本次请求北京时间**、**下一次请求北京时间**与**动态跳动倒计时**；
   - **一旦请求成功拿到今日新数据**，下一次请求时间将自动设定为**接下来一天的 00:00:00（北京时间）**，倒计时自动计算直至次日0点；
   - 若今日源尚未上传，下一次请求时间为退避冷却结束点，倒计时结束后方允许再次探测。

---

## 🏷️ 节点清洗与自动日后缀 (02/03) 识别更新

源数据中的节点名称往往混有推广广告（例如首节点的 `tg频道:@freenodedaily`），导入小火箭/代理软件后十分影响体验。

ParseFree 内置了强大的**广告清洗、日期识别与节点重命名引擎**：

| 节点类型 | 原始节点示例 | 转换清洗后在客户端的展示 | 业务意义 |
| :--- | :--- | :--- | :--- |
| **首节点 / 推广广告** | `tg频道:@freenodedaily` | **`HOS Daily官方维护02`**（当前源为02日）<br>**`HOS Daily官方维护03`**（当更新为03日） | **在客户端一眼识别今天是否已经更新了！** |
| **普通节点** | `🇭🇰 香港` | **`HOS自动化线路 🇭🇰 香港`** | 统一附带线路前缀 |
| **普通节点 2** | `🇯🇵 日本` | **`HOS自动化线路 🇯🇵 日本`** | 统一附带线路前缀 |

### 🛠️ 自定义配置方式（支持环境变量与 URL 参数）

- **首节点名称**（默认：`HOS Daily官方维护`，自动追加当天数据日部分如 `02`）
  - 环境变量：`FIRST_NODE_NAME=我的专线`（首节点将显示为 `我的专线02`）
  - URL 参数：`?first_name=我的专线`
- **普通节点前缀**（默认：`HOS自动化线路 `）
  - 环境变量：`NODE_PREFIX=极速专线-`
  - URL 参数：`?prefix=极速专线-`
- **失败重试间隔**（默认：`10` 分钟）
  - 环境变量：`RETRY_INTERVAL_MINUTES=15`
  - URL 参数：`?retry_interval=15`

在浏览器打开 Worker 首页，在“节点命名与广告清理设置”卡片中可直接修改并即时预览效果！

---

## ✨ 核心特性

- 🔄 **自动日期更新 + 成功后停止探测**：无需手动修改日期，每日 00 点后自动递增并智能锁定。
- ⏱️ **失败重试间隔退避 + 自动回退最新数据**：失败期间避免频繁请求，平滑回退最新有效数据，支持自定义重试间隔。
- 🏷️ **首节点日期日后缀识别 (02/03)**：首节点清洗广告并自动追加来源日，一目了然确认今日更新状态。
- 📝 **支持手动编辑地址**：在 Web 界面或环境变量中随时手动指定、编辑任何固定订阅地址。
- 🌐 **双格式源支持 (Clash / V2Ray)**：支持从 Clash (`.yaml`) 或 V2Ray (`.txt`) 获取源数据，并具备防漏发自动兜底机制。
- 🔒 **访问安全鉴权**：支持配置账号密码保护（`AUTH_PASSWORD` / `AUTH_USERNAME`），防止订阅被他人盗用。
- 🔔 **Bark 推送与 CF 边缘缓存自动清理**：支持更新成功即刻推送、9/12/18点未发布告警、设备拉取通知，定时任务成功自动刷新全球边缘缓存。
- 🎯 **全协议标准转换**：实时将节点转换为标准节点 URI 链接（与 [`格式.txt`](格式.txt) 完全对齐），支持小火箭、v2rayN、Sing-box 等。

---

## 📋 支持协议与转换对照

转换生成的节点格式与 [`格式.txt`](格式.txt) 完全对齐：

| 协议类型 | 输出节点 URI 格式 | 说明 |
| :--- | :--- | :--- |
| **VMess** | `vmess://<Base64-JSON>` | 采用 V2RayN 标准 JSON 格式，全平台通用，自动保留 TLS/WS 等参数 |
| **Shadowsocks** | `ss://<Base64(cipher:password)>@host:port#name` | SIP002 标准格式，名称已统一重命名 |
| **AnyTLS** | `anytls://password@host:port?security=tls&sni=...#name` | AnyTLS 协议标准分享链接 |
| **Trojan** | `trojan://password@host:port?security=tls&sni=...#name` | 标准 Trojan 链接 |
| **VLESS** | `vless://uuid@host:port?security=...&sni=...#name` | 标准 VLESS 链接 |
| **Hysteria 2** | `hysteria2://password@host:port?sni=...#name` | 标准 Hysteria2 链接 |
| **TUIC** | `tuic://uuid:password@host:port?sni=...#name` | 标准 TUIC 链接 |

---

## 🚀 部署教程

### 方式一：Cloudflare 连接 GitHub 仓库自动部署（推荐，CI/CD 自动化）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)，进入 **Workers & Pages -> Create Application -> Continue with GitHub**。
2. 授权并选中仓库：**`jialifushi/ParseFree`**。
3. 构建参数：
   - **Framework preset**：选择 **None**；
   - **Build command** 与 **Build output directory**：留空即可（项目根目录自带 `_worker.js`）。
4. 环境变量（可选）：
   - `AUTH_PASSWORD`：访问密码（如 `MySecret2026`）
   - `RETRY_INTERVAL_MINUTES`：探测重试间隔分钟数（默认 `10`）
   - `FIRST_NODE_NAME`：首节点基础名称（默认 `HOS Daily官方维护`）
   - `NODE_PREFIX`：普通节点前缀（默认 `HOS自动化线路 `）
5. 点击 **Save and Deploy** 即可完成！

---

### 方式二：Cloudflare Dashboard 网页端直接粘贴代码部署（0门槛极速）

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，点击 **Workers & Pages -> Create Worker -> Deploy -> Edit Code**。
2. 打开本项目中的 [**`dist/worker.js`**](dist/worker.js) 文件，复制全部代码并粘贴覆盖。
3. 点击 **Save and Deploy** 即可完成！

---

### 方式三：Wrangler 命令行部署（开发者适用）

```bash
git clone https://github.com/jialifushi/ParseFree.git
cd ParseFree
npm install
npx wrangler login
npm run build
npm run deploy
```

---

## 🔔 Bark 推送服务与 CF 边缘缓存自动清理

### 1. 自动触发推送条件
- **触发条件 1（每日成功更新）**：定时任务一旦成功获取并锁定今日新数据，立刻向 Bark 发送详情推送，当天仅推送 1 次。
- **触发条件 2（9/12/18点未发布告警）**：若在早 9:00、中 12:00、晚 18:00 定时探测时今日数据仍未发布，自动推送未检测今日节点并提示当前已回退至最新有效数据。
- **触发条件 3（设备拉取通知）**：当有移动端设备（如小火箭、v2rayN、Clash 等）请求节点订阅时触发，内置 **5 分钟防刷节流机制**，防止频繁刷屏。

### 2. 配置方式（支持网页即时修改与环境变量两种途径）
- **途径一（网页可视化配置，推荐）**：在部署后的 Web 控制面板中，直接在【Bark 配置】卡片填写**服务器地址**（如自建 `https://apple.hertzhe.dpdns.org` 或官方 `https://api.day.app`）和**设备Key**，点击【测试通知】即可秒级验证！
- **途径二（CF 环境变量基线）**：
  - `BARK_SERVER`：Bark 推送服务器地址（默认 `https://api.day.app`）
  - `BARK_KEY`：您的 Bark 设备 Key
  - `BARK_NOTIFY_SUCCESS`：是否开启更新成功推送（默认 `1`）
  - `BARK_NOTIFY_ALERT`：是否开启 9/12/18 点未发布告警（默认 `1`）
  - `BARK_NOTIFY_DEVICE`：是否开启设备端拉取通知（默认 `1`，可设为 `0` 关闭）
  - `BARK_THROTTLE_MINUTES`：设备拉取通知防刷节流分钟数（默认 `5`）

### 3. CF 边缘缓存自动清理机制
每当定时任务拉取并锁定当天新数据时，系统会自动递增内部数据版本号 `dataVersion`，彻底废除 Cloudflare 全球 CDN 的旧节点缓存，确保移动端设备即刻拉取到今日最新节点！

---

## 📡 订阅接口与参数详解

| 接口 / 参数 | 完整示例 | 用途说明 |
| :--- | :--- | :--- |
| **Web 控制台** | `https://your-domain/?token=xxx` | 可视化查看状态、切换模式、调整重试间隔及一键复制 |
| **通用明文订阅** | `https://your-domain/sub?token=xxx` | **首节点带 02/03 日期标识，其他节点带前缀**，小火箭首选 |
| **Base64 订阅** | `https://your-domain/sub?b64=1&token=xxx` | 输出 Base64 编码文本，兼容仅识别 Base64 的旧版客户端 |
| **自定义重试间隔** | `https://your-domain/sub?retry_interval=15&token=xxx` | 设置失败探测间隔（分钟） |
| **自定义首节点名称** | `https://your-domain/sub?first_name=我的专线&token=xxx` | 首节点将显示为“我的专线02” |
| **自定义普通节点前缀** | `https://your-domain/sub?prefix=专线-&token=xxx` | 覆盖默认的“HOS自动化线路 ” |
| **指定 V2Ray 源** | `https://your-domain/sub?type=v2ray&token=xxx` | 切换为拉取 V2Ray 格式源（空内容自动兜底） |
| **手动指定外部源** | `https://your-domain/sub?source=https://...&token=xxx` | 传入任意外部 Clash/V2Ray 链接进行在线解析转换 |
| **地区关键词过滤** | `https://your-domain/sub?filter=香港&token=xxx` | 仅拉取节点名称中包含“香港”的节点 |
| **强制刷新缓存** | `https://your-domain/sub?refresh=1&token=xxx` | 立即穿透缓存，重新向源站探测 |

---

## 📱 常见客户端配置指南

### 1. Shadowrocket (小火箭 - iOS)
1. 打开 Shadowrocket，点击右上角 `+` 号。
2. 类型选择 **Subscribe (订阅)**。
3. URL 填入订阅链接（推荐使用 Base64 格式）：
   - **推荐格式（Base64 订阅）**：`https://your-worker.workers.dev/sub?b64=1&token=您的密码`
   - **通用明文格式**：`https://your-worker.workers.dev/sub?token=您的密码`
4. 备注填写 `ParseFree`，点击右上角“完成”。
5. 下拉列表刷新后，首节点将清晰展示为 **`HOS Daily官方维护02`**（依更新日期而变），普通节点均带有 **`HOS自动化线路 `** 前缀！

> 💡 **为什么此前导入过小火箭后，再次更新名称依然是旧的？**
> 1. **小火箭本地防覆盖机制**：小火箭为了防止冲掉用户自行手改的节点名称，如果节点服务器地址与端口已存在于本地数据库中，明文更新默认保留本地已有备注；**建议优先使用 Base64 订阅链接**，或在小火箭中**左滑删除旧订阅后重新添加**即可彻底更新！
> 2. **边缘缓存击穿**：ParseFree v3.2.0 已默认针对客户端下发 `no-cache, no-store` 标头，并在 CacheKey 中注入版本号，避免 Cloudflare 边缘节点缓存旧数据。如需立即强刷，可在链接后加上 `&refresh=1`。

---

## 🧪 本地开发与测试

```bash
# 运行全部集成、鉴权、重命名与重试间隔自动化测试
npm test

# 重新构建单文件 dist/worker.js 与 _worker.js
npm run build
```

---

## ⚖️ 免责声明

1. 本项目仅供网络技术研究、Cloudflare Workers 开发学习与个人网络调试使用。
2. 抓取的节点均来自互联网公开渠道，本项目不对节点的可用性、稳定性与安全性作任何承诺。
3. 使用本项目时请严格遵守所在国家与地区的法律法规。
