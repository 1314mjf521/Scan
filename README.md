# 栈点资产管理

面向仓库与行政团队的轻量资产档案和出入库管理 Web 应用，提供条码/二维码扫描、批量库存操作、CSV 导入导出、操作员账号管理和 SQLite 持久化。

Asset Desk is a lightweight inventory and asset-tracking web application for small teams. Its source code is publicly available under a **noncommercial** license; commercial use is not permitted.

> **许可提示：**本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。该许可允许符合许可条件的非商业使用，但不允许商业使用，因此并非 OSI 定义下的开源许可证。请阅读完整许可文本；商业授权需另行取得权利人书面许可。

## 功能

- 资产档案、分类、库位及库存总览。
- 手机摄像头识别二维码和常见一维条码；兼容 USB HID 扫码枪和手动输入。
- 单笔/批量入库与出库；后端校验库存，并以事务保证批量操作全有或全无。
- CSV 资产导入、模板下载、资产和流水导出。
- 管理员与操作员角色、操作员启停/有效期/密码管理。
- 管理员修订流水用途和时间，修订字段写入后台审计表。
- SQLite 持久化；首次启动默认创建空白数据库，不写入演示资产。

## 技术栈

- 前端：React、TypeScript、Vite
- API：Node.js、Express 5
- 数据库：SQLite（better-sqlite3）
- 扫码：ZXing Browser

## 环境要求

- Node.js 22 或更高版本及 npm
- 摄像头扫码需要 HTTPS 或浏览器认可的 `localhost` 安全上下文

## 快速开始

```sh
npm ci
```

创建本地环境变量文件：

```sh
# macOS / Linux / Git Bash
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

编辑 `.env`，至少将 `ADMIN_PASSWORD` 改为本地强密码，并把 `SESSION_SECRET` 替换为随机长密钥。然后启动开发服务：

```sh
npm run dev
```

打开 Vite 输出的地址（默认 `http://localhost:5173`）。API 默认运行于 `http://localhost:3001`，Vite 会将 `/api` 请求代理到 API。开发数据库默认位于 `data/assets.sqlite`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动 API 与 Vite 开发服务器 |
| `npm run build` | 检查 TypeScript 并构建生产前端 |
| `npm run typecheck:server` | 单独检查 API TypeScript |
| `npm run lint` | 运行 Oxlint |
| `npm start` | 启动 Express；生产模式托管 `dist/` |

## 配置

完整模板见 [`.env.example`](.env.example)。生产环境必须通过环境变量或秘密管理系统提供强管理员密码与会话密钥。不要将真实 `.env`、数据库、备份或证书私钥提交到 Git。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | API 监听端口 |
| `DATABASE_PATH` | `./data/assets.sqlite` | SQLite 数据库路径 |
| `ADMIN_USERNAME` | `admin` | 首次初始化的管理员账号 |
| `ADMIN_PASSWORD` | 本地开发占位值 | 管理员密码；生产环境必须显式设置 |
| `SESSION_SECRET` | 本地开发占位值 | 会话密钥；生产环境至少 32 个字符且必须随机 |
| `COOKIE_SECURE` | 随运行环境推断 | HTTPS 反向代理部署时应启用 Secure Cookie |
| `SEED_DEMO_DATA` | `false` | 仅首次初始化空数据库时设为 `true`，写入演示数据 |

首次启动时会创建管理员账号，密码以 bcrypt 哈希保存。显式配置 `ADMIN_PASSWORD` 后，服务启动时会更新管理员密码。初始化后请妥善保管环境变量和数据库。

## 部署与安全

生产部署、Docker、Linux/systemd、HTTPS、私有 CA、iframe 集成、备份与升级说明见[部署指南](DEPLOYMENT.md)。服务器手动部署所需文件见[上传文件清单](UPLOAD_FILES.md)。

- 不要将 API 端口直接暴露到不可信公网；远程访问应使用 HTTPS 反向代理并限制网络入口。
- 生产环境必须设置 `ADMIN_PASSWORD` 和至少 32 个字符的 `SESSION_SECRET`。
- SQLite 数据目录、环境变量文件、备份和 TLS 私钥必须存放在访问受控的位置。
- SQLite 使用 WAL 模式；在线备份请使用 SQLite 一致性备份方式，或停止写入后再复制数据库及相关 WAL 文件。
- 资产读取接口当前无需登录；写入操作由后端按角色校验。当前版本未接入 SSO，也不提供审计日志读取 API。
- 摄像头扫码需要 HTTPS/安全上下文及浏览器摄像头权限；USB 扫码枪按键盘输入设备工作。

发现安全问题时，请优先通过 GitHub 私下安全公告渠道联系维护者；请勿在公开 Issue 中发布可利用细节。参见 [SECURITY.md](SECURITY.md)。

## 贡献

欢迎通过 GitHub Issues 讨论问题和改进建议，通过 Pull Request 提交变更。提交前请运行：

```sh
npm run build
npm run lint
```

贡献内容也按本仓库的非商业许可提供。请勿提交个人数据、真实凭据、生产数据库或私钥。

## 许可与第三方依赖

本项目自身代码和文档依照 [PolyForm Noncommercial License 1.0.0](LICENSE) 提供。该许可不允许商业目的的使用、部署、分发或制作衍生作品；具体范围以许可证原文为准。需要商业用途时，必须事先取得权利人单独书面授权。

第三方依赖、字体、图像和其他资产可能受各自许可证约束，不因本项目许可证而改变。使用或再分发前请分别核对其许可证和归属要求。
