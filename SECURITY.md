<!--
 * @Author: 1314mjf521 18037564366@163.com
 * @Date: 2026-10-09 11:05:31
 * @LastEditors: 1314mjf521 18037564366@163.com
 * @LastEditTime: 2026-10-09 11:05:38
 * @FilePath: \Scan\SECURITY.md
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE

如果仓库未启用私下安全公告，请通过维护者的 GitHub 账号页面寻找私下联系渠道；在建立安全联系前，不要公开漏洞利用细节。

## 支持范围

仅当前维护版本会被考虑修复。安全修复和披露时间由维护者与报告者协调；本项目不承诺服务等级或固定响应时限。

## 部署方责任

部署方需自行保护管理员凭据、会话密钥、SQLite 数据及备份，使用 HTTPS，并将服务限制在可信网络入口。不要将 `.env`、数据库文件、WAL/SHM 文件、TLS 私钥或真实用户数据提交至公开仓库。