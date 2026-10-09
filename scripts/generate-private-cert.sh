#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  printf '用法：%s <手机访问的域名或IP> [其他域名或IP... ]\n' "$0" >&2
  printf '示例：%s assets.example.internal 192.168.1.20\n' "$0" >&2
  exit 2
fi

command -v openssl >/dev/null 2>&1 || { printf '未找到 openssl，请先安装 OpenSSL。\n' >&2; exit 1; }

declare -a san_entries=()
san_index=0
for name in "$@"; do
  if [[ "$name" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    san_index=$((san_index + 1))
    san_entries+=("IP.$san_index = $name")
  elif [[ "$name" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$name" != *..* ]]; then
    san_index=$((san_index + 1))
    san_entries+=("DNS.$san_index = $name")
  else
    printf '无效的 DNS 名称或 IPv4 地址：%s\n' "$name" >&2
    exit 2
  fi
done

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cert_dir="${CERT_DIR:-$app_dir/certs}"
mkdir -p "$cert_dir"
chmod 700 "$cert_dir"

for file in private-ca.key ca.crt server.key server.crt; do
  if [[ -e "$cert_dir/$file" ]]; then
    printf '拒绝覆盖现有文件：%s\n' "$cert_dir/$file" >&2
    printf '备份或移走现有证书后再运行；轮换 CA 会要求重新安装手机信任证书。\n' >&2
    exit 1
  fi
done

# EN: Keep private keys readable only by the account that generated them.
# 中文：限制私钥仅由执行生成操作的系统账号读取。
umask 077
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cat > "$tmp_dir/ca.cnf" <<'EOF'
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3_ca

[dn]
CN = Asset Desk Private Root CA
O = Asset Desk

[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

{
  cat <<'EOF'
[req]
distinguished_name = dn
prompt = no
req_extensions = server_ext

[dn]
EOF
  printf 'CN = %s\n\n' "$1"
  cat <<'EOF'
[server_ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
subjectAltName = @alt_names

[alt_names]
EOF
  printf '%s\n' "${san_entries[@]}"
} > "$tmp_dir/server.cnf"

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$cert_dir/private-ca.key"
openssl req -x509 -new -sha256 -days 3650 -key "$cert_dir/private-ca.key" -config "$tmp_dir/ca.cnf" -out "$cert_dir/ca.crt"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$cert_dir/server.key"
openssl req -new -sha256 -key "$cert_dir/server.key" -config "$tmp_dir/server.cnf" -out "$tmp_dir/server.csr"
openssl x509 -req -sha256 -days 397 -in "$tmp_dir/server.csr" -CA "$cert_dir/ca.crt" -CAkey "$cert_dir/private-ca.key" -CAcreateserial -out "$cert_dir/server.crt" -extfile "$tmp_dir/server.cnf" -extensions server_ext

chmod 600 "$cert_dir/private-ca.key" "$cert_dir/server.key"
chmod 644 "$cert_dir/ca.crt" "$cert_dir/server.crt"
printf '\n证书已生成：%s\n' "$cert_dir"
printf '服务器证书：%s/server.crt\n服务器私钥：%s/server.key\n手机安装的 CA 证书：%s/ca.crt\n' "$cert_dir" "$cert_dir" "$cert_dir"
printf 'CA 私钥仅用于签发证书，请离线安全备份，不要复制到手机、Nginx 或代码仓库。\n'
openssl x509 -in "$cert_dir/server.crt" -noout -subject -issuer -dates -ext subjectAltName