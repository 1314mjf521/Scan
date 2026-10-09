<!--
 * @Author: 1314mjf521 18037564366@163.com
 * @Date: 2026-10-08 15:00:53
 * @LastEditors: 1314mjf521 18037564366@163.com
 * @LastEditTime: 2026-10-08 15:01:00
 * @FilePath: \Scan\UPLOAD_FILES.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
LICENSE
deploy.sh
scripts/generate-private-cert.sh
deploy/nginx/asset-desk-private-tls.conf.example
Dockerfile
docker-compose.yml
.dockerignore
package.json
package-lock.json
index.html
vite.config.ts
tsconfig.json
tsconfig.app.json
tsconfig.node.json
tsconfig.server.json
server/index.ts
src/App.tsx
src/App.css
src/index.css
src/dashboard.css
src/main.tsx
src/assets/hero.png
```

保留 `server/` 和 `src/` 目录结构。上传后在服务器执行：

```sh
cd /opt/asset-desk
chmod +x deploy.sh
sudo ./deploy.sh
```

脚本提供容器和本机 Node.js 两种部署选择。容器方式要求服务器已安装 Docker Compose v2，或 Podman 与 `podman-compose`；本机方式要求 Node.js 22+、npm 和 systemd。首次执行会交互配置服务绑定地址、端口、HTTP/HTTPS 和模块管理员账号。

`README.md`、`DEPLOYMENT.md`、`SECURITY.md` 和 `.env.example` 建议一并上传，方便查阅项目说明、部署、安全政策和环境变量模板。不要上传任何 SSH 密码、现有数据库或服务器上的主系统配置。
