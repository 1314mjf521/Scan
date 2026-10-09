# 部署与主系统集成

本文档覆盖开发机本地运行、Docker 容器运行、远程 Linux 主机运行，以及通过 iframe 将资产模块嵌入现有主系统。当前版本是一个独立 Web 模块：前端、API 和 SQLite 数据库一起部署；与主系统之间通过浏览器嵌入或 HTTP API 边界协作，不要求把 React 源码合并进主系统。

## 服务器手动一键部署

将 [上传文件清单](UPLOAD_FILES.md) 中列出的项目文件按目录结构上传到服务器同一目录，例如 `/opt/asset-desk`。不要上传本机 `.env`、数据库、`node_modules`、`dist` 或 `.git`。然后在服务器终端执行：

```sh
cd /opt/asset-desk
chmod +x deploy.sh
sudo ./deploy.sh
```

脚本会让你选择容器部署或本机 Node.js + systemd 部署、绑定 IP、端口以及 HTTP/HTTPS 模式；会自动配置管理员、构建启动服务并执行健康检查。容器方式要求 Docker Compose v2 或 Podman + `podman-compose`；本机方式要求 Node.js 22+、npm 和 systemd。首次部署时可手动输入模块管理员密码，或回车让脚本生成随机密码并在成功后显示一次。已有 `.env` 时可选择保留现有模块管理员凭据，或重置为新密码（适用于之前中断的部署）。SSH 账号密码不参与此脚本，也无需在服务器上保存。

建议绑定服务器内网 IP 或回环地址，默认端口 `3001`。如需由主系统访问，请确认服务器防火墙/云安全组仅允许可信来源访问。脚本不会自动开放防火墙端口，也不会停止或修改主系统已有容器。

### HTTP 与 HTTPS 选择

- 选择 **HTTPS**：仅当已有 Nginx/Higress/其他 TLS 反向代理把 HTTPS 请求转发到本模块端口时选择。模块将启用 Secure Cookie；代理需传递 `X-Forwarded-Proto: https`。TLS 证书应由组织 CA 或可信 CA 签发。
- 选择 **HTTP**：适合隔离内网试用或由上层 HTTPS 网关终止 TLS 的场景；模块会关闭 Secure Cookie。不要让该端口从公网可达。手机摄像头扫码要求浏览器处于 HTTPS 或 localhost 安全上下文，因此远程 HTTP 页面不能保证能用摄像头；USB 扫码枪键盘输入不受此限制。

### 私有 CA 证书（手机内网访问）

项目提供 `scripts/generate-private-cert.sh`。在 Linux 服务器或安全的部署机上安装 OpenSSL 后运行；参数必须是手机地址栏中实际使用的主机名/IP，可以同时传入 DNS 名称和 IPv4 地址，都会写入证书 SAN：

```sh
cd /opt/asset-desk
chmod +x scripts/generate-private-cert.sh
./scripts/generate-private-cert.sh assets.example.internal 10.20.30.40
```

将 `assets.example.internal` 替换为手机可解析到服务器的内网域名，`10.20.30.40` 替换为服务器实际内网 IP；若只通过 IP 访问，就只传 IP。脚本生成的文件位于项目 `certs/`（该目录已加入 `.gitignore`）：`ca.crt` 是要在手机上安装并信任的根证书，`server.crt` 和 `server.key` 是 Nginx 使用的站点证书/私钥，`private-ca.key` 是签发 CA 私钥。

**保护 CA 私钥：**`private-ca.key` 只留在受控部署机并离线备份，不能复制到手机、Nginx、容器、Web 目录或代码仓库。服务器只安装站点证书和 `server.key`。生成器会拒绝覆盖现有证书；遗失 CA 私钥时应新建 CA，并重新在每台手机安装新的 `ca.crt`。

在同一台服务器运行 Nginx 时，将站点文件复制到系统证书目录并限制私钥权限：

```sh
sudo install -d -m 750 /etc/asset-desk/tls
sudo install -o root -g root -m 644 certs/server.crt /etc/asset-desk/tls/server.crt
sudo install -o root -g root -m 600 certs/server.key /etc/asset-desk/tls/server.key
sudo cp deploy/nginx/asset-desk-private-tls.conf.example /etc/nginx/sites-available/asset-desk
```

编辑 Nginx 配置中的 `server_name` 为手机访问的域名。若使用本机 IP 访问，可保留/替换为该 IP；证书 SAN 必须包含地址栏中完全相同的域名或 IP。确保应用仅绑定本机回环地址 `127.0.0.1:3001`，启用 Nginx 站点、执行 `nginx -t` 后重载 Nginx。运行 `deploy.sh` 时选择 HTTPS；若手工配置 Compose，则设置 `COOKIE_SECURE=true`。反向代理会将 HTTPS 请求转发到本机应用，并传递 `X-Forwarded-Proto: https`。

Debian/Ubuntu 可按以下命令启用站点并检查配置：

```sh
sudo ln -s /etc/nginx/sites-available/asset-desk /etc/nginx/sites-enabled/asset-desk
sudo nginx -t
sudo systemctl reload nginx
```

#### RHEL 系远程服务器

Rocky Linux、AlmaLinux、Alibaba Cloud Linux 和 RHEL 通常可使用 `dnf` 安装 Nginx；具体命令请按目标系统版本确认。以下 `192.0.2.10` 为文档示例地址，需替换为你自己的证书 SAN 和服务器地址：

```sh
dnf install -y nginx
systemctl enable --now nginx
```

安装服务器证书和私钥。不要把 `private-ca.key` 复制到 Nginx：

```sh
install -d -m 750 /etc/asset-desk/tls
install -o root -g root -m 644 /opt/asset-desk/certs/server.crt /etc/asset-desk/tls/server.crt
install -o root -g root -m 600 /opt/asset-desk/certs/server.key /etc/asset-desk/tls/server.key
```

确认应用健康接口可从本机访问，且后端端口没有监听公网地址：

```sh
curl -fsS http://127.0.0.1:3001/api/health
ss -lntp | grep ':3001'
```

若健康检查失败或应用端口绑定不正确，请检查 `/opt/asset-desk/.env` 中的绑定地址。同机 Nginx 推荐使用 `127.0.0.1`，并确认 `COOKIE_SECURE=true`：

```sh
sed -i 's/^ASSET_BIND_IP=.*/ASSET_BIND_IP=127.0.0.1/; s/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' /opt/asset-desk/.env
```

保存后按实际使用的容器方式重建服务（Docker Compose：`cd /opt/asset-desk && docker compose up -d --build`；Podman Compose：`cd /opt/asset-desk && podman-compose up -d --build`）。如果是 systemd 本机服务，确认 `.env` 的 `PORT=3001`、`COOKIE_SECURE=true` 后执行 `systemctl restart asset-desk`。重测 `curl -fsS http://127.0.0.1:3001/api/health` 成功再继续。

创建 Nginx 站点配置 `/etc/nginx/conf.d/asset-desk.conf`：

```nginx
server {
  listen 443 ssl;
  server_name 192.0.2.10;

  ssl_certificate /etc/asset-desk/tls/server.crt;
  ssl_certificate_key /etc/asset-desk/tls/server.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

然后检查并加载配置：

```sh
nginx -t
systemctl reload nginx
curl -kfsS --resolve 192.0.2.10:443:127.0.0.1 https://192.0.2.10/api/health
```

在云安全组和主机防火墙中仅允许可信来源访问 TCP `443`，不要开放 TCP `3001` 到公网。将 `/opt/asset-desk/certs/ca.crt` 安全传到手机并安装/信任；随后使用证书 SAN 中的地址访问 HTTPS 并允许摄像头权限。`curl -k` 仅用于临时连通性验证，不代表设备已经信任 CA。

把 `certs/ca.crt` 通过 USB、受控文件传输或组织设备管理分发到手机，不要公开放在应用网页目录。安装并启用系统信任后，用 `https://assets.example.internal/` 或证书 SAN 中的 IP 访问：

- **iPhone/iPad：**打开 `.crt` 安装描述文件，然后到“设置 → 通用 → 关于本机 → 证书信任设置”启用该根证书的完全信任。受组织管理的设备可由 MDM 下发 CA。
- **Android：**在“设置 → 安全/隐私 → 加密与凭据 → 安装证书 → CA 证书”安装；不同厂商菜单名称略有差异。之后用 Chrome 访问 HTTPS 地址并允许摄像头权限。

私有 CA 只在安装并信任该 CA 的设备上有效，不会自动成为公网可信证书。证书仅用于可信内网/VPN，不要因此把应用端口或管理页面暴露到公网。生成器目前接受 DNS 名称和 IPv4 地址；不支持 IPv6 SAN。

如果服务器已有网关或其他服务，请先确认端口可用，并由现有 HTTPS 网关配置独立资产子域转发到应用端口。

## 部署方式选择

| 方式 | 适用场景 | 地址/入口 | 数据保存 |
| --- | --- | --- | --- |
| 本地开发 | 开发、演示、单机试用 | Vite 默认 `http://localhost:5173` | `data/assets.sqlite` |
| Docker Compose | 单机服务器、内网服务器、交付部署 | 宿主机仅监听 `127.0.0.1:3001` | Docker 命名卷 `asset-data` |
| 远程 Linux 主机 | 已有 Node.js 运维体系或 systemd/Nginx | HTTPS 域名，经 Nginx 转发 | 配置的 `DATABASE_PATH` |
| 嵌入主系统 | 将模块放进现有门户页面 | 同一主域名下的资产子域 iframe | 仍由模块服务器持有 |

## 配置与安全要求

Node.js 版本为 22 或更新版本。生产运行必须设置 `ADMIN_PASSWORD` 和 `SESSION_SECRET`；生产启动会拒绝缺少配置或保留示例占位值。会话密钥至少 32 个字符。示例生成方式：

```sh
openssl rand -base64 36
```

常用变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | Express 监听端口 |
| `DATABASE_PATH` | `./data/assets.sqlite` | SQLite 数据库文件绝对或相对路径 |
| `ADMIN_USERNAME` | `admin` | 管理员账号 |
| `ADMIN_PASSWORD` | 开发默认值 | 管理员密码；生产必须显式配置 |
| `SESSION_SECRET` | 开发默认值 | Cookie 会话签名密钥；生产必须使用 32 位以上随机值 |
| `SEED_DEMO_DATA` | `false` | 仅首次初始化空数据库时设为 `true`，写入演示资产；默认为空白系统 |

`ADMIN_PASSWORD` 在服务启动时写入数据库密码哈希；修改环境变量并重启会更新管理员密码。不要把 `.env`、数据库、SQLite WAL/SHM 文件、证书私钥或备份放进镜像、代码仓库或公开 Web 目录。新数据库默认空白；已有数据库升级时不会自动清理数据。

**远程访问安全边界：**资产读取接口可公开访问；新建/导入资产以及单笔/批量出入库必须先登录模块账号，管理员专属的资产删除、流水修订和操作员账号管理由服务端按角色校验。流水记录登录账号名。当前账号仅由模块管理员维护，尚未接入主系统 SSO 或用户身份同步。不要把端口直接暴露到公网；远程使用应限制在可信内网/VPN，或由已有 SSO 反向代理保护整个模块入口。

## 本地运行

Windows PowerShell：

```powershell
npm ci
Copy-Item .env.example .env
# 编辑 .env，设置仅供本机使用的管理员密码和随机会话密钥
npm run dev
```

浏览器打开 `http://localhost:5173`。前端开发服务器将 `/api` 代理到 `http://localhost:3001`。摄像头仅能在 HTTPS 或 `localhost` 安全上下文中使用；扫码枪按 USB HID 键盘设备工作。

### 本地 HTTPS 调试（含手机摄像头）

只在开发电脑浏览器中调试时，`http://localhost:5173` 已属于浏览器认可的安全上下文，通常无需 HTTPS。若要用手机访问开发电脑，手机上的 `localhost` 指手机本身，必须用开发电脑的局域网 IP 访问 HTTPS；证书必须包含该电脑的实际 IP，不能使用其他服务器签发的证书来访问本机。

在 VS Code 的 **Git Bash** 终端，从项目根目录为本机地址生成独立证书。将示例 `192.0.2.10` 换成开发电脑 Wi-Fi/有线网卡的 IPv4 地址（Windows 可运行 `ipconfig` 查看）：

```sh
cd /path/to/Scan
CERT_DIR=certs/local bash scripts/generate-private-cert.sh localhost 127.0.0.1 192.0.2.10
```

在项目根目录创建 `.env.development.local`（该文件已被 Git 忽略），填写：

```dotenv
DEV_HTTPS=true
DEV_HOST=0.0.0.0
DEV_HTTPS_CERT=certs/local/server.crt
DEV_HTTPS_KEY=certs/local/server.key
```

启动开发服务：

```sh
npm run dev
```

电脑访问 `https://localhost:5173`；手机与电脑连接同一可信 Wi-Fi 后访问 `https://192.0.2.10:5173`（替换为本机 IP）。Windows 防火墙需允许开发电脑的 TCP `5173` 入站，仅限可信专用网络；不要把 Vite 开发端口暴露到公网。`/api` 仍由 Vite 代理到本机 `http://localhost:3001`，不需要给 Express 单独配置 HTTPS。

首次访问前，先把 `certs/local/ca.crt` 安装并信任在电脑和手机上。Windows 可用“当前用户证书管理器（`certmgr.msc`）→ 受信任的根证书颁发机构 → 证书 → 导入”；iPhone/iPad 安装描述文件后还需在“证书信任设置”启用完全信任；Android 从安全/凭据设置安装 CA 证书。手机浏览器首次询问摄像头权限时选择允许。开发证书只供内网调试，不要上传到生产服务器；生产 HTTPS 仍由 Nginx/正式反向代理终止。

调试结束后删除 `.env.development.local`，或将 `DEV_HTTPS=false`、`DEV_HOST=localhost`；证书留在已忽略的 `certs/local/`，不会提交到仓库。

## Docker 容器

Docker 镜像在构建阶段安装 native SQLite 编译依赖、安装 npm 包并生成前端生产资源。容器以非 root 用户运行；SQLite 文件保存在 Compose 命名卷中，容器重建不会删除卷数据。

默认首次启动只创建表和管理员凭据，不创建资产或流水。若明确需要演示数据，可在 `.env` 中添加 `SEED_DEMO_DATA=true` 后首次启动；每个数据库最多执行一次演示播种。升级不会自动清理已有数据库中的数据；管理员可在资产档案中逐项删除，删除操作也会永久删除对应流水和审计记录。

若容器构建报缺少 Node.js 模块，先确认源码与 `package.json`、`package-lock.json` 来自同一版本。按 [上传清单](UPLOAD_FILES.md) 同步上传源码和依赖清单，再检查已安装依赖：

```sh
cd /opt/asset-desk
npm ls --depth=0
```

依赖清单一致但构建仍沿用旧缓存时，使用无缓存构建：

```sh
podman-compose -p asset-desk build --no-cache
podman-compose -p asset-desk up -d
podman-compose -p asset-desk logs --tail=100
```

若使用 `docker compose`，执行 `docker compose build --no-cache` 和 `docker compose up -d`。不要只上传 `src/` 后沿用旧依赖清单；`npm ci` 严格按锁文件安装，不会因源码 import 自动补装依赖。

```sh
cp .env.example .env
```

编辑 `.env` 至少设置以下值，不能保留示例密码或会话密钥：

```dotenv
ADMIN_USERNAME=admin
ADMIN_PASSWORD=替换为强密码
SESSION_SECRET=替换为至少32位的随机密钥
```

注意：`.env.example` 中的密码和会话密钥都是占位值，不能直接用于生产。若通过云厂商控制台、`docker run` 或其他容器平台启动，而不是使用本目录的 Compose 项目，主机上的 `.env` 不会自动进入容器；请在平台的容器环境变量配置中设置 `ADMIN_PASSWORD` 和 `SESSION_SECRET`，或使用该平台支持的秘密挂载。`ADMIN_PASSWORD` 不得以 `Change-` 开头，`SESSION_SECRET` 至少 32 个字符且不得以 `replace-` 开头。设置后重建/重启容器。

可在容器内检查变量是否满足启动条件，而不打印密钥内容：

```sh
node -e "const p=process.env.ADMIN_PASSWORD||''; const s=process.env.SESSION_SECRET||''; console.log({adminPasswordConfigured:!!p&&!p.startsWith('Change-'),sessionSecretConfigured:s.length>=32&&!s.startsWith('replace-')})"
```

构建并启动：

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f asset-desk
```

默认只发布到宿主机 `127.0.0.1:3001`，便于由本机 Nginx 或其他反向代理转发。浏览器通过配置好的 HTTPS 域名访问。查看健康状态可请求 `http://127.0.0.1:3001/api/health`。升级时运行 `docker compose up -d --build`；备份前暂停写入或使用 SQLite 一致性备份工具，至少保留 `asset-data` 卷中的数据库及其 WAL 状态。确认备份后再按组织保留策略清理旧备份。

本地临时试用时可将 `docker-compose.yml` 中端口绑定改为 `"3001:3001"`，但不要在远程公网环境这样开放。

## 远程 Linux 主机

以下示例假定 Ubuntu/Debian、Node.js 22、Nginx 和域名 `assets.example.com` 已准备好。

1. 将项目发布到服务器，例如 `/opt/asset-desk`；在该目录安装依赖并构建：

```sh
cd /opt/asset-desk
npm ci
npm run build
sudo install -d -o www-data -g www-data /var/lib/asset-desk
```

2. 在秘密管理系统或 `/etc/asset-desk.env` 配置生产变量。不要将秘密放在项目目录：

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_PATH=/var/lib/asset-desk/assets.sqlite
ADMIN_USERNAME=admin
ADMIN_PASSWORD=替换为强密码
SESSION_SECRET=替换为至少32位的随机密钥
```

确保运行服务的 Linux 用户可写数据库目录。创建 `/etc/systemd/system/asset-desk.service`：

```ini
[Unit]
Description=Asset Desk web module
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/asset-desk
EnvironmentFile=/etc/asset-desk.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/asset-desk

[Install]
WantedBy=multi-user.target
```

确认服务器 `npm` 实际路径后再使用 `ExecStart`。加载并启动：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now asset-desk
sudo systemctl status asset-desk
sudo journalctl -u asset-desk -f
```

3. Nginx 将资产专用域名转发到本机服务。先为域名配置 TLS 证书；应用端口不要对公网开放：

```nginx
server {
    listen 443 ssl;
    server_name assets.example.com;

    # ssl_certificate /etc/letsencrypt/live/assets.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/assets.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

若使用 SSO 网关，应由网关保护 `/` 和 `/api/` 全部路径，不能只保护 HTML 页面。经过代理后检查 `/api/health`、静态资源、管理员登录和摄像头权限。

## 嵌入现有主系统

### 推荐：资产子域 + iframe

当前 Vite 生产资源和前端 API 都以域名根路径为基准，且前端请求固定为 `/api/...`。因此最简单可靠的集成是让模块在根路径独立运行于 `https://assets.example.com/`，主系统在页面或导航中嵌入该 URL，而不是把当前构建直接映射到 `/portal/assets/` 一类任意路径：

```html
<iframe
  src="https://assets.example.com/"
  title="资产出入库"
  allow="camera"
  referrerpolicy="strict-origin-when-cross-origin"
  style="display:block;width:100%;height:calc(100vh - 64px);border:0"
></iframe>
```

摄像头需要 HTTPS。主系统顶层页面的 `Permissions-Policy` 需允许资产子域使用摄像头，例如 `camera=(self "https://assets.example.com")`；iframe 必须声明 `allow="camera"`。若主系统设置了 `Content-Security-Policy`，其 `frame-src` 要允许 `https://assets.example.com`；资产服务的 `frame-ancestors` 要允许主系统来源。不要同时发送禁止 iframe 的 `X-Frame-Options: DENY`。

建议主系统与资产模块使用同一组织域名下的子域，并通过已有登录网关为资产域提供统一入口。当前版本的管理员登录仍由模块自身处理；没有实现主系统 SSO 单点登录、用户身份同步、跨应用导航通信或直接复用主系统数据库。不要通过 iframe URL 参数传递密码、令牌或用户身份。宿主与 iframe 如需交换信息，应另行设计经来源校验的 `postMessage` 协议。

### API 集成边界

主系统后端可以通过内网地址调用模块 API，也可把资产模块作为独立页面嵌入。浏览器跨域直接请求、共享主系统登录态或合并两边用户权限目前不是现成能力；不要仅为方便而开放宽泛 CORS。当前公开接口包括：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/dashboard` | 统计摘要 |
| `GET` | `/api/assets` | 资产列表 |
| `POST` | `/api/assets` | 新建资产 |
| `POST` | `/api/assets/import` | 批量导入资产档案（最多 1000 行，全批校验） |
| `DELETE` | `/api/admin/assets/:id` | 管理员删除资产及关联流水 |
| `GET` | `/api/records` | 出入库流水，按时间倒序 |
| `POST` | `/api/movements` | 登记入库或出库 |
| `POST` | `/api/movements/batch` | 批量登记入库或出库（最多 1000 行，全批校验） |
| `GET` | `/api/auth/me` | 当前管理员或操作员会话 |
| `POST` | `/api/auth/login` | 管理员或操作员登录 |
| `POST` | `/api/auth/logout` | 退出当前账号 |
| `GET` | `/api/admin/users` | 管理员查看操作员账号 |
| `POST` | `/api/admin/users` | 管理员创建操作员账号 |
| `DELETE` | `/api/admin/users/:id` | 管理员删除操作员账号 |
| `PATCH` | `/api/admin/records/:id` | 管理员修订用途和时间 |

`admin_audit` 时间修订审计表没有 API 路由。若要让主系统操作员身份成为实际操作者，建议由主系统后端调用资产服务的内部接口，并在服务端完成可信身份映射；不要信任浏览器提交的 `actor` 字段。更完整的 SSO/API Key/OIDC、操作员角色和子路径部署支持属于后续集成改造。

## 数据备份与更新

备份 SQLite 数据库时使用 SQLite 备份 API/CLI，或先停止写入再复制数据库文件；处于 WAL 模式时只复制主 `.sqlite` 文件可能漏掉尚未 checkpoint 的提交。恢复前停止服务、备份当前数据，并确认恢复文件所有者和读写权限正确。容器方式需同时记录 Compose 配置、镜像版本和命名卷备份；镜像重建本身不会升级或删除持久化卷中的数据。

升级前先备份数据库，再发布新代码、执行 `npm ci && npm run build`（远程主机）或重新构建容器，并检查健康接口与库存/流水统计。SQLite 适合单机或低到中等写入量部署；多实例横向扩容、跨服务器共享文件系统或高并发写入前，应迁移到集中式数据库并评估会话存储方案。