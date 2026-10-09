#!/usr/bin/env bash
###
 # @Author: 1314mjf521 18037564366@163.com
 # @Date: 2026-10-08 14:59:34
 # @LastEditors: 1314mjf521 18037564366@163.com
 # @LastEditTime: 2026-10-08 14:59:34
 # @FilePath: \Scan\deploy.sh
 # @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
### 
set -Eeuo pipefail

APP_NAME="asset-desk"
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
DEFAULT_PORT="3001"
DEFAULT_BIND_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
DEFAULT_BIND_IP="${DEFAULT_BIND_IP:-127.0.0.1}"
NEW_ADMIN_PASSWORD=""

fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
need_root() { [[ "$(id -u)" -eq 0 ]] || fail "请使用 root 或 sudo 运行：sudo bash deploy.sh"; }
ask() {
  local prompt="$1" default="$2" answer
  read -r -p "$prompt [$default]: " answer
  printf '%s' "${answer:-$default}"
}

[[ -f "$APP_DIR/package.json" && -f "$APP_DIR/package-lock.json" && -f "$APP_DIR/docker-compose.yml" && -f "$APP_DIR/src/main.tsx" && -f "$APP_DIR/server/index.ts" ]] || fail "部署文件不完整，请按 UPLOAD_FILES.md 上传到同一个目录。"
need_root

printf '\n资产管理模块一键部署\n'
printf '部署目录：%s\n' "$APP_DIR"
printf '1) Podman/Docker 容器部署（推荐）\n'
printf '2) 本机 Node.js + systemd 部署\n'
read -r -p '请选择部署方式 [1/2]: ' DEPLOY_MODE
case "$DEPLOY_MODE" in
  1|2) ;;
  *) fail "请输入 1 或 2" ;;
esac

BIND_IP="$(ask '服务绑定 IP（建议内网网卡 IP；127.0.0.1 仅本机可访问）' "$DEFAULT_BIND_IP")"
APP_PORT="$(ask '服务端口' "$DEFAULT_PORT")"
[[ "$APP_PORT" =~ ^[0-9]{1,5}$ ]] && (( APP_PORT >= 1 && APP_PORT <= 65535 )) || fail "端口必须是 1 到 65535 的数字。"

if ss -ltn "sport = :$APP_PORT" 2>/dev/null | tail -n +2 | grep -q .; then
  fail "端口 $APP_PORT 已被占用。请重新运行脚本并选择其他端口；脚本不会停止或覆盖现有服务。"
fi

printf '\n访问方式：\n'
printf '1) HTTP（可信内网临时/受控使用）\n'
printf '2) HTTPS（TLS 已由 Nginx、Higress 或其他反向代理终止）\n'
TLS_MODE="$(ask '请选择访问方式 [1/2]' '1')"
case "$TLS_MODE" in
  1) COOKIE_SECURE=false; ACCESS_SCHEME=http ;;
  2) COOKIE_SECURE=true; ACCESS_SCHEME=https ;;
  *) fail "请输入 1 或 2" ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  ADMIN_USERNAME="$(sed -n 's/^ADMIN_USERNAME=//p' "$ENV_FILE" | tail -n 1)"
  ADMIN_PASSWORD="$(sed -n 's/^ADMIN_PASSWORD=//p' "$ENV_FILE" | tail -n 1)"
  SESSION_SECRET="$(sed -n 's/^SESSION_SECRET=//p' "$ENV_FILE" | tail -n 1)"
  [[ -n "$ADMIN_PASSWORD" && -n "$SESSION_SECRET" ]] || fail "$ENV_FILE 已存在但缺少管理员密码或会话密钥，请先修正后重新执行。"
  ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
  printf '检测到已有 .env。\n'
  printf '1) 保留现有模块管理员账号和密码\n'
  printf '2) 重新设置/生成模块管理员凭据（适用于未完成部署）\n'
  CREDENTIAL_MODE="$(ask '请选择凭据处理方式 [1/2]' '1')"
  case "$CREDENTIAL_MODE" in
    1) printf '保留现有模块管理员凭据。\n' ;;
    2)
      ADMIN_USERNAME="$(ask '模块管理员账号' "$ADMIN_USERNAME")"
      [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "管理员账号只能包含英文字母、数字、点、下划线和短横线。"
      read -r -s -p '新的管理员密码（回车自动生成一次性随机密码）: ' ADMIN_PASSWORD
      printf '\n'
      if [[ -z "$ADMIN_PASSWORD" ]]; then
        ADMIN_PASSWORD="$(openssl rand -hex 20)"
        NEW_ADMIN_PASSWORD="$ADMIN_PASSWORD"
      elif [[ ! "$ADMIN_PASSWORD" =~ ^[A-Za-z0-9._~-]{12,128}$ ]]; then
        fail "密码需为 12 到 128 位，仅使用英文字母、数字、点、下划线、短横线或波浪号；也可直接回车生成随机密码。"
      fi
      SESSION_SECRET="$(openssl rand -hex 48)"
      ;;
    *) fail "请输入 1 或 2" ;;
  esac
else
  ADMIN_USERNAME="$(ask '模块管理员账号' 'admin')"
  [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "管理员账号只能包含英文字母、数字、点、下划线和短横线。"
  read -r -s -p '模块管理员密码（回车自动生成一次性随机密码）: ' ADMIN_PASSWORD
  printf '\n'
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(openssl rand -hex 20)"
    NEW_ADMIN_PASSWORD="$ADMIN_PASSWORD"
  elif [[ ! "$ADMIN_PASSWORD" =~ ^[A-Za-z0-9._~-]{12,128}$ ]]; then
    fail "密码需为 12 到 128 位，仅使用英文字母、数字、点、下划线、短横线或波浪号；也可直接回车生成随机密码。"
  fi
  SESSION_SECRET="$(openssl rand -hex 48)"
fi

umask 077
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$APP_PORT
DATABASE_PATH=$APP_DIR/data/assets.sqlite
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$SESSION_SECRET
COOKIE_SECURE=$COOKIE_SECURE
ASSET_BIND_IP=$BIND_IP
ASSET_PORT=$APP_PORT
EOF
chmod 600 "$ENV_FILE"
mkdir -p "$APP_DIR/data"

if [[ "$TLS_MODE" == "1" ]]; then
  printf '\n警告：HTTP 下管理员会话 Cookie 不使用 Secure 标志，摄像头扫码通常会被浏览器禁用。\n'
  printf '请仅在可信内网访问，不要将此端口暴露到公网。\n'
else
  printf '\n请确认 HTTPS 反向代理已把 %s 的请求转发到 %s:%s，并传递 X-Forwarded-Proto。\n' "$BIND_IP" "$BIND_IP" "$APP_PORT"
fi

if [[ "$DEPLOY_MODE" == "1" ]]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE=(podman-compose)
  elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    COMPOSE=(podman compose)
  else
    fail "未找到 Docker Compose 或 Podman Compose。请先安装 Podman + podman-compose，或 Docker Engine + Compose v2。"
  fi
  printf '\n使用容器引擎：%s\n' "${COMPOSE[*]}"
  cd "$APP_DIR"
  "${COMPOSE[@]}" -p "$APP_NAME" -f docker-compose.yml config >/dev/null
  "${COMPOSE[@]}" -p "$APP_NAME" -f docker-compose.yml up -d --build
  HEALTH_URL="http://127.0.0.1:$APP_PORT/api/health"
else
  command -v node >/dev/null 2>&1 || fail "本机部署需要预先安装 Node.js 22+ 和 npm。容器部署不需要在主机安装 Node.js。"
  command -v npm >/dev/null 2>&1 || fail "未找到 npm。"
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
  (( NODE_MAJOR >= 22 )) || fail "当前 Node.js 为 $(node --version)，需要 22 或更高版本。"
  cd "$APP_DIR"
  npm ci
  npm run build
  id assetdesk >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin assetdesk
  chown -R root:assetdesk "$APP_DIR"
  chown -R assetdesk:assetdesk "$APP_DIR/data"
  chmod 750 "$APP_DIR/data"
  NPM_BIN="$(command -v npm)"
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Asset Desk inventory module
After=network.target

[Service]
Type=simple
User=assetdesk
Group=assetdesk
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=PATH=$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
ExecStart=$NPM_BIN start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR/data

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$APP_NAME"
  systemctl restart "$APP_NAME"
  HEALTH_URL="http://127.0.0.1:$APP_PORT/api/health"
fi

printf '\n等待健康检查'
HEALTH_OK=false
for _ in $(seq 1 60); do
  if curl --silent --show-error --fail "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  printf '.'
  sleep 2
done
printf '\n'
$HEALTH_OK || {
  if [[ "$DEPLOY_MODE" == "1" ]]; then
    "${COMPOSE[@]}" -p "$APP_NAME" -f "$APP_DIR/docker-compose.yml" logs --tail=100
  else
    journalctl -u "$APP_NAME" --no-pager -n 100
  fi
  fail "健康检查未通过。请根据上方日志排查；数据目录和 .env 已保留。"
}

printf '\n部署成功\n访问地址：%s://%s:%s/\n健康检查：%s\n' "$ACCESS_SCHEME" "$BIND_IP" "$APP_PORT" "$HEALTH_URL"
if [[ "$DEPLOY_MODE" == "1" ]]; then
  printf '数据位置：Podman/Docker 命名卷 %s_asset-data\n' "$APP_NAME"
else
  printf '数据目录：%s/data\n' "$APP_DIR"
fi
if [[ "$ACCESS_SCHEME" == "http" ]]; then
  printf '安全提示：该地址为 HTTP，仅限可信内网；手机摄像头扫码可能不可用。\n'
fi
if [[ -n "$NEW_ADMIN_PASSWORD" ]]; then
  printf '\n首次管理员账号：%s\n首次管理员密码：%s\n请立即保存该密码。\n' "$ADMIN_USERNAME" "$NEW_ADMIN_PASSWORD"
fi
if [[ "$DEPLOY_MODE" == "1" ]]; then
  printf '\n容器状态查看：%s -p %s -f %s/docker-compose.yml ps\n' "${COMPOSE[*]}" "$APP_NAME" "$APP_DIR"
else
  printf '\n服务状态查看：systemctl status %s\n日志查看：journalctl -u %s -f\n' "$APP_NAME" "$APP_NAME"
fi
