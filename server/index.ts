/*
 * @Author: 1314mjf521 18037564366@163.com
 * @Date: 2026-10-08 10:43:29
 * @LastEditors: 1314mjf521 18037564366@163.com
 * @LastEditTime: 2026-10-08 10:43:36
 * @FilePath: \Scan\server\index.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import session from 'express-session'
import SQLite from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const databasePath = resolve(process.env.DATABASE_PATH ?? './data/assets.sqlite')
mkdirSync(dirname(databasePath), { recursive: true })
const db = new SQLite(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
// EN: Keep inventory, movement, audit, account, and session data in one SQLite database.
// 中文：将资产、流水、审计、账号和会话数据统一保存在 SQLite 数据库中。
db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    location TEXT NOT NULL DEFAULT '主仓库',
    quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
    unit TEXT NOT NULL DEFAULT '件',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL REFERENCES assets(id),
    direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    purpose TEXT NOT NULL,
    actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS movements_created_idx ON movements(created_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movement_id INTEGER NOT NULL REFERENCES movements(id),
    admin_name TEXT NOT NULL,
    field_name TEXT NOT NULL,
    previous_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS web_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS web_sessions_expired_idx ON web_sessions(expired);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'operator')),
    is_active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)
const userColumns = new Set((db.pragma('table_info(users)') as { name: string }[]).map((column) => column.name))
// EN: Add newer account fields in place so existing installations can upgrade without losing data.
// 中文：为旧数据库原位补充账号字段，升级时保留已有数据。
if (!userColumns.has('is_active')) db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1')
if (!userColumns.has('expires_at')) db.exec('ALTER TABLE users ADD COLUMN expires_at TEXT')

const assetCount = (db.prepare('SELECT COUNT(*) AS count FROM assets').get() as { count: number }).count
const demoDataSeeded = db.prepare("SELECT value FROM settings WHERE key = 'demo_data_seeded'").get()
if (process.env.SEED_DEMO_DATA === 'true' && !demoDataSeeded) {
  const seed = db.transaction(() => {
    if (assetCount === 0) {
      const insert = db.prepare('INSERT INTO assets (code, name, category, location, quantity) VALUES (?, ?, ?, ?, ?)')
      const samples = [
        ['AST-2024-001', 'MacBook Pro 14"', '电脑设备', 'A区 · 01-03', 18],
        ['AST-2024-008', 'Dell 显示器 27"', '办公设备', 'A区 · 02-01', 32],
        ['AST-2024-012', 'Sony WH-1000XM5', '音频设备', 'B区 · 01-06', 12],
        ['AST-2024-019', 'Logitech MX Keys', '办公设备', 'B区 · 03-02', 24],
        ['AST-2024-026', 'iPad Air 11"', '移动设备', 'A区 · 04-01', 9],
      ] as const
    for (const [code, name, category, location, quantity] of samples) {
      const result = insert.run(code, name, category, location, quantity)
      db.prepare("INSERT INTO movements (asset_id, direction, quantity, purpose, actor, created_at) VALUES (?, 'in', ?, '期初盘点', '系统初始化', datetime('now', '-1 day'))").run(result.lastInsertRowid, quantity)
    }
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('demo_data_seeded', 'true')").run()
  })
  seed()
}

const adminUsername = process.env.ADMIN_USERNAME ?? 'admin'
const initialPassword = process.env.ADMIN_PASSWORD ?? 'ChangeMe-2026!'
// EN: Fail closed in production instead of starting with development credentials or a weak session secret.
// 中文：生产环境缺少强凭据时拒绝启动，避免使用开发密码或弱会话密钥。
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.startsWith('Change-') || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('replace-'))) {
  throw new Error('Production requires a non-placeholder ADMIN_PASSWORD and a SESSION_SECRET of at least 32 characters')
}
const savedHash = db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get() as { value: string } | undefined
const configuredHash = bcrypt.hashSync(initialPassword, 12)
if (!savedHash) db.prepare("INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)").run(configuredHash)
else if (process.env.ADMIN_PASSWORD) db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password_hash'").run(configuredHash)
const currentAdminHash = (db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get() as { value: string }).value
const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUsername) as { id: number } | undefined
if (!adminUser) db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(adminUsername, currentAdminHash)
else if (process.env.ADMIN_PASSWORD) db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(configuredHash, adminUsername)

const app = express()
app.disable('x-powered-by')
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
const secureCookie = process.env.COOKIE_SECURE === undefined
  ? process.env.NODE_ENV === 'production'
  : process.env.COOKIE_SECURE === 'true'
app.use(express.json({ limit: '1mb' }))

class SqliteSessionStore extends session.Store {
  get(sid: string, callback: (err?: unknown, session?: session.SessionData | null) => void) {
    try {
      const row = db.prepare('SELECT sess FROM web_sessions WHERE sid = ? AND expired > ?').get(sid, Date.now()) as { sess: string } | undefined
      callback(null, row ? JSON.parse(row.sess) as session.SessionData : null)
    } catch (error) { callback(error) }
  }
  set(sid: string, value: session.SessionData, callback?: (err?: unknown) => void) {
    try {
      const expiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000
      db.prepare('INSERT OR REPLACE INTO web_sessions (sid, sess, expired) VALUES (?, ?, ?)').run(sid, JSON.stringify(value), expiry)
      callback?.()
    } catch (error) { callback?.(error) }
  }
  destroy(sid: string, callback?: (err?: unknown) => void) {
    try { db.prepare('DELETE FROM web_sessions WHERE sid = ?').run(sid); callback?.() } catch (error) { callback?.(error) }
  }
  touch(sid: string, value: session.SessionData, callback?: (err?: unknown) => void) {
    try {
      const expiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000
      db.prepare('UPDATE web_sessions SET expired = ? WHERE sid = ?').run(expiry, sid); callback?.()
    } catch (error) { callback?.(error) }
  }
}

app.use(session({
  name: 'asset.sid', secret: process.env.SESSION_SECRET ?? 'local-development-only-change-this-session-secret',
  store: new SqliteSessionStore(), resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 8 * 60 * 60 * 1000 },
function normalizeExpiryDate(value: unknown) {
  if (value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : value
}
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // EN: Re-read role and expiry from SQLite on every protected request so disabled accounts lose access immediately.
  // 中文：每次受保护请求都从数据库复核角色和有效期，确保停用账号立即失去访问权限。
  const sessionUser = (req.session as AuthSession).user
  const user = sessionUser ? db.prepare("SELECT id, username, role, is_active, expires_at FROM users WHERE id = ? AND role = 'admin'").get(sessionUser.id) as StoredUser | undefined : undefined
  if (!user || !isAccountActive(user)) { res.status(401).json({ error: '需要有效的管理员账号' }); return }
  ;(req.session as AuthSession).user = user
  next()
}
function requireUser(req: Request, res: Response, next: NextFunction) {
  const sessionUser = (req.session as AuthSession).user
  const user = sessionUser ? db.prepare('SELECT id, username, role, is_active, expires_at FROM users WHERE id = ?').get(sessionUser.id) as StoredUser | undefined : undefined
  if (!user || !isAccountActive(user)) { res.status(401).json({ error: '请先登录有效账号' }); return }
  ;(req.session as AuthSession).user = { id: user.id, username: user.username, role: user.role }
  next()
}
function parsePositiveInt(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null }
function recordsQuery() {
  return db.prepare(`SELECT m.id, a.code AS asset_code, a.name AS asset_name, m.direction, m.quantity, m.purpose, m.actor, strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) AS created_at
    FROM movements m JOIN assets a ON a.id = m.asset_id ORDER BY m.created_at DESC, m.id DESC`)
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))
app.get('/api/auth/me', (req, res) => {
  const sessionUser = (req.session as AuthSession).user
  const user = sessionUser ? db.prepare('SELECT id, username, role, is_active, expires_at FROM users WHERE id = ?').get(sessionUser.id) as StoredUser | undefined : undefined
  if (!user || !isAccountActive(user)) { res.json({ user: null }); return }
  res.json({ user: { id: user.id, username: user.username, role: user.role } })
})
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string }
  const user = typeof username === 'string' ? db.prepare('SELECT id, username, password_hash, role, is_active, expires_at FROM users WHERE username = ?').get(username.trim()) as StoredUser & { password_hash: string } | undefined : undefined
  if (!user || typeof password !== 'string' || !bcrypt.compareSync(password, user.password_hash) || !isAccountActive(user)) { res.status(401).json({ error: '账号、密码无效，或账号已停用/过期' }); return }
  req.session.regenerate((error) => {
    if (error) { res.status(500).json({ error: '无法建立管理员会话' }); return }
    const sessionUser: AuthUser = { id: user.id, username: user.username, role: user.role }
    ;(req.session as AuthSession).user = sessionUser
    req.session.save((saveError) => saveError ? res.status(500).json({ error: '无法保存用户会话' }) : res.json({ user: sessionUser }))
  })
})
app.post('/api/auth/logout', (req, res) => req.session.destroy((error) => error ? res.status(500).json({ error: '退出失败' }) : res.clearCookie('asset.sid').json({ ok: true })))
app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json(db.prepare("SELECT id, username, role, is_active, expires_at, created_at FROM users WHERE role = 'operator' ORDER BY username COLLATE NOCASE").all())
})
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, expiresAt } = req.body as { username?: unknown; password?: unknown; expiresAt?: unknown }
  const expires = normalizeExpiryDate(expiresAt)
  if (typeof username !== 'string' || !/^[A-Za-z0-9._-]{3,40}$/.test(username.trim()) || typeof password !== 'string' || password.length < 12 || password.length > 128 || expires === undefined) {
    res.status(400).json({ error: '账号需为 3 到 40 位字母、数字、点、下划线或短横线；密码需为 12 到 128 位' }); return
  }
  try {
    const result = db.prepare("INSERT INTO users (username, password_hash, role, expires_at) VALUES (?, ?, 'operator', ?)").run(username.trim(), bcrypt.hashSync(password, 12), expires)
    res.status(201).json(db.prepare('SELECT id, username, role, is_active, expires_at, created_at FROM users WHERE id = ?').get(result.lastInsertRowid))
  } catch { res.status(409).json({ error: '该账号已存在' }) }
})
app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const userId = parsePositiveInt(req.params.id)
  const body = req.body as { password?: unknown; isActive?: unknown; expiresAt?: unknown }
  if (!userId) { res.status(400).json({ error: '用户编号无效' }); return }
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'operator'").get(userId)
  if (!user) { res.status(404).json({ error: '操作员账号不存在' }); return }
  const updates: string[] = []
  const values: (string | number | null)[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ error: '账号更新数据无效' }); return }
  if (Object.hasOwn(body, 'isActive')) {
    if (typeof body.isActive !== 'boolean') { res.status(400).json({ error: '账号状态无效' }); return }
    updates.push('is_active = ?'); values.push(body.isActive ? 1 : 0)
  }
  if (Object.hasOwn(body, 'expiresAt')) {
    const expires = normalizeExpiryDate(body.expiresAt)
    if (expires === undefined) { res.status(400).json({ error: '有效期格式无效' }); return }
    updates.push('expires_at = ?'); values.push(expires)
  }
  let passwordChanged = false
  if (Object.hasOwn(body, 'password')) {
    if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) { res.status(400).json({ error: '新密码需为 12 到 128 位' }); return }
    updates.push('password_hash = ?'); values.push(bcrypt.hashSync(body.password, 12)); passwordChanged = true
  }
  if (!updates.length) { res.status(400).json({ error: '没有提供需要更新的账号信息' }); return }
  values.push(userId)
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values)
  if (passwordChanged || body.isActive === false) {
    const removeSessions = db.prepare('DELETE FROM web_sessions WHERE sid = ?')
    for (const row of db.prepare('SELECT sid, sess FROM web_sessions').all() as { sid: string; sess: string }[]) {
      try {
        const sessionData = JSON.parse(row.sess) as { user?: { id?: number } }
        if (sessionData.user?.id === userId) removeSessions.run(row.sid)
      } catch { removeSessions.run(row.sid) }
    }
  }
  res.json(db.prepare("SELECT id, username, role, is_active, expires_at, created_at FROM users WHERE id = ? AND role = 'operator'").get(userId))
})
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const userId = parsePositiveInt(req.params.id)
  if (!userId) { res.status(400).json({ error: '用户编号无效' }); return }
  const result = db.prepare("DELETE FROM users WHERE id = ? AND role = 'operator'").run(userId)
  if (!result.changes) { res.status(404).json({ error: '操作员账号不存在' }); return }
  res.json({ ok: true })
})

app.get('/api/dashboard', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS assets, COALESCE(SUM(quantity), 0) AS quantity, SUM(CASE WHEN quantity < 5 THEN 1 ELSE 0 END) AS low FROM assets').get() as { assets: number; quantity: number; low: number }
  const movement = db.prepare("SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE 0 END), 0) AS inbound, COALESCE(SUM(CASE WHEN direction = 'out' THEN quantity ELSE 0 END), 0) AS outbound FROM movements WHERE date(created_at, 'localtime') = date('now', 'localtime')").get() as { inbound: number; outbound: number }
  res.json({ totalAssets: total.assets, totalQuantity: total.quantity, lowStock: total.low ?? 0, inboundToday: movement.inbound, outboundToday: movement.outbound })
})
app.get('/api/assets', (_req, res) => res.json(db.prepare('SELECT id, code, name, category, location, quantity, unit, CASE WHEN quantity > 0 THEN \'在库\' ELSE \'缺货\' END AS status FROM assets ORDER BY name COLLATE NOCASE').all()))
app.post('/api/assets', requireUser, (req, res) => {
  const { code, name, category, location, quantity } = req.body as Record<string, unknown>
  if (typeof code !== 'string' || !code.trim() || typeof name !== 'string' || !name.trim()) { res.status(400).json({ error: '资产编码和名称为必填项' }); return }
  const count = Number(quantity)
  if (!Number.isSafeInteger(count) || count < 0) { res.status(400).json({ error: '初始库存必须为非负整数' }); return }
  try {
    const create = db.transaction(() => {
      const asset = db.prepare('INSERT INTO assets (code, name, category, location, quantity) VALUES (?, ?, ?, ?, ?)').run(code.trim(), name.trim(), String(category || '其他'), String(location || '主仓库'), count)
      if (count > 0) db.prepare("INSERT INTO movements (asset_id, direction, quantity, purpose, actor) VALUES (?, 'in', ?, '期初建档', '系统')").run(asset.lastInsertRowid, count)
      return db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.lastInsertRowid)
    })
    res.status(201).json(create())
  } catch { res.status(409).json({ error: '资产编码已存在' }) }
})
app.post('/api/assets/import', requireUser, (req, res) => {
  const rows = (req.body as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 1000) { res.status(400).json({ error: '导入行数必须为 1 到 1000 行' }); return }
  const seen = new Set<string>()
  const errors: string[] = []
  const normalized = rows.map((value: unknown, index: number) => {
    const validRow = !!value && typeof value === 'object' && !Array.isArray(value)
    const row = validRow ? value as Record<string, unknown> : {}
    if (!validRow) errors.push(`第 ${index + 2} 行：数据格式无效`)
    const code = typeof row.code === 'string' ? row.code.trim() : ''
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const quantity = Number(row.quantity ?? 0)
    if (!code || !name) errors.push(`第 ${index + 2} 行：编码和名称不能为空`)
    if (!Number.isSafeInteger(quantity) || quantity < 0) errors.push(`第 ${index + 2} 行：库存必须为非负整数`)
    if (code && seen.has(code)) errors.push(`第 ${index + 2} 行：文件内编码重复（${code}）`)
    if (code) seen.add(code)
    return { code, name, category: typeof row.category === 'string' && row.category.trim() ? row.category.trim() : '其他', location: typeof row.location === 'string' && row.location.trim() ? row.location.trim() : '主仓库', unit: typeof row.unit === 'string' && row.unit.trim() ? row.unit.trim() : '件', quantity }
  })
  const exists = db.prepare('SELECT code FROM assets WHERE code = ?')
  for (const [index, row] of normalized.entries()) {
    if (row.code && exists.get(row.code)) errors.push(`第 ${index + 2} 行：编码已存在（${row.code}）`)
  }
  if (errors.length) { res.status(400).json({ error: errors.slice(0, 20).join('；'), errorCount: errors.length }); return }
  try {
    // EN: Validate the whole batch first, then commit every asset and opening movement atomically.
    // 中文：先校验整批数据，再原子提交全部资产和期初流水，避免部分写入。
    db.transaction(() => {
      const insertAsset = db.prepare('INSERT INTO assets (code, name, category, location, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)')
      const insertMovement = db.prepare("INSERT INTO movements (asset_id, direction, quantity, purpose, actor) VALUES (?, 'in', ?, '期初建档', '系统')")
      for (const row of normalized) {
        const result = insertAsset.run(row.code, row.name, row.category, row.location, row.quantity, row.unit)
        if (row.quantity > 0) insertMovement.run(result.lastInsertRowid, row.quantity)
      }
    })()
  } catch { res.status(409).json({ error: '导入失败，可能存在重复编码；本批次未写入' }); return }
  res.status(201).json({ imported: normalized.length })
})
app.delete('/api/admin/assets/:id', requireAdmin, (req, res) => {
  const assetId = parsePositiveInt(req.params.id)
  if (!assetId) { res.status(400).json({ error: '资产编号无效' }); return }
  const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId) as { id: number } | undefined
  if (!asset) { res.status(404).json({ error: '资产档案不存在' }); return }
  // EN: The all-or-nothing transaction prevents a failed batch from leaving partial stock changes.
  // 中文：整批事务采用全有或全无策略，失败时不会留下部分库存变更。
  db.transaction(() => {
    db.prepare('DELETE FROM admin_audit WHERE movement_id IN (SELECT id FROM movements WHERE asset_id = ?)').run(assetId)
    db.prepare('DELETE FROM movements WHERE asset_id = ?').run(assetId)
    db.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
  })()
  res.json({ ok: true })
})
app.get('/api/records', (_req, res) => res.json(recordsQuery().all()))
app.post('/api/movements', requireUser, (req, res) => {
  const { code, purpose, direction } = req.body as { code?: string; purpose?: string; direction?: string }
  const quantity = parsePositiveInt(req.body.quantity)
  if (typeof code !== 'string' || !code.trim() || typeof purpose !== 'string' || !purpose.trim() || (direction !== 'in' && direction !== 'out') || !quantity) { res.status(400).json({ error: '请填写有效的编码、方向、用途和数量' }); return }
  const asset = db.prepare('SELECT * FROM assets WHERE code = ?').get(code.trim()) as { id: number; name: string; quantity: number } | undefined
  if (!asset) { res.status(404).json({ error: '未找到该资产，请先建立资产档案' }); return }
  if (direction === 'out' && quantity > asset.quantity) { res.status(409).json({ error: `库存不足，当前可用 ${asset.quantity} 件` }); return }
  const movement = db.transaction(() => {
    db.prepare('UPDATE assets SET quantity = quantity + ? WHERE id = ?').run(direction === 'in' ? quantity : -quantity, asset.id)
    const user = (req.session as AuthSession).user!
    const result = db.prepare('INSERT INTO movements (asset_id, direction, quantity, purpose, actor) VALUES (?, ?, ?, ?, ?)').run(asset.id, direction, quantity, purpose.trim(), user.username)
    return { id: Number(result.lastInsertRowid), name: asset.name }
  })()
  res.status(201).json({ movement, asset: { ...asset, quantity: asset.quantity + (direction === 'in' ? quantity : -quantity) } })
})
app.post('/api/movements/batch', requireUser, (req, res) => {
  const direction = (req.body as { direction?: unknown } | null)?.direction
  const rows = (req.body as { rows?: unknown } | null)?.rows
  if ((direction !== 'in' && direction !== 'out') || !Array.isArray(rows) || rows.length === 0 || rows.length > 1000) { res.status(400).json({ error: '请提供有效方向及 1 到 1000 行数据' }); return }
  const seen = new Set<string>()
  const errors: string[] = []
  const normalized = rows.map((value: unknown, index: number) => {
    const validRow = !!value && typeof value === 'object' && !Array.isArray(value)
    const row = validRow ? value as Record<string, unknown> : {}
    if (!validRow) errors.push(`第 ${index + 2} 行：数据格式无效`)
    const code = typeof row.code === 'string' ? row.code.trim() : ''
    const purpose = typeof row.purpose === 'string' ? row.purpose.trim() : ''
    const quantity = Number(row.quantity)
    if (!code || !purpose) errors.push(`第 ${index + 2} 行：编码和用途不能为空`)
    if (!Number.isSafeInteger(quantity) || quantity <= 0) errors.push(`第 ${index + 2} 行：数量必须为正整数`)
    if (code && seen.has(code)) errors.push(`第 ${index + 2} 行：资产编码重复（${code}）`)
    if (code) seen.add(code)
    return { code, purpose, quantity }
  })
  const findAsset = db.prepare('SELECT id, name, quantity FROM assets WHERE code = ?')
  const assetsForRows = normalized.map((row, index) => {
    const asset = row.code ? findAsset.get(row.code) as { id: number; name: string; quantity: number } | undefined : undefined
    if (row.code && !asset) errors.push(`第 ${index + 2} 行：未找到资产（${row.code}）`)
    if (direction === 'out' && asset && Number.isSafeInteger(row.quantity) && row.quantity > asset.quantity) errors.push(`第 ${index + 2} 行：${row.code} 库存不足，当前 ${asset.quantity}`)
    return asset
  })
  if (errors.length) { res.status(400).json({ error: errors.slice(0, 20).join('；'), errorCount: errors.length }); return }
  db.transaction(() => {
    const update = db.prepare('UPDATE assets SET quantity = quantity + ? WHERE id = ?')
    const insert = db.prepare('INSERT INTO movements (asset_id, direction, quantity, purpose, actor) VALUES (?, ?, ?, ?, ?)')
    const actor = (req.session as AuthSession).user!.username
    normalized.forEach((row, index) => {
      const asset = assetsForRows[index]!
      update.run(direction === 'in' ? row.quantity : -row.quantity, asset.id)
      insert.run(asset.id, direction, row.quantity, row.purpose, actor)
    })
  })()
  res.status(201).json({ processed: normalized.length, direction })
})

app.patch('/api/admin/records/:id', requireAdmin, (req, res) => {
  const movementId = parsePositiveInt(req.params.id)
  const { purpose, createdAt } = req.body as { purpose?: string; createdAt?: string }
  const timestamp = createdAt ? new Date(createdAt) : null
  if (!movementId || typeof purpose !== 'string' || !purpose.trim() || !timestamp || Number.isNaN(timestamp.getTime())) { res.status(400).json({ error: '请提供有效用途和时间' }); return }
  const record = db.prepare('SELECT purpose, created_at FROM movements WHERE id = ?').get(movementId) as { purpose: string; created_at: string } | undefined
  if (!record) { res.status(404).json({ error: '记录不存在' }); return }
  const normalized = timestamp.toISOString().replace('T', ' ').slice(0, 19)
  const admin = (req.session as AuthSession).user!
  // EN: Record each changed field before updating it; the audit table intentionally has no read API.
  // 中文：更新前逐字段写入审计记录；审计表有意不提供读取 API。
  db.transaction(() => {
    if (record.purpose !== purpose.trim()) db.prepare('INSERT INTO admin_audit (movement_id, admin_name, field_name, previous_value, new_value) VALUES (?, ?, ?, ?, ?)').run(movementId, admin.username, 'purpose', record.purpose, purpose.trim())
    if (record.created_at !== normalized) db.prepare('INSERT INTO admin_audit (movement_id, admin_name, field_name, previous_value, new_value) VALUES (?, ?, ?, ?, ?)').run(movementId, admin.username, 'created_at', record.created_at, normalized)
    db.prepare('UPDATE movements SET purpose = ?, created_at = ? WHERE id = ?').run(purpose.trim(), normalized, movementId)
  })()
  res.json({ ok: true })
})

app.use(express.static(resolve('./dist')))
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve('./dist/index.html')))

const port = Number(process.env.PORT ?? 3001)
app.listen(port, '0.0.0.0', () => console.log(`Asset API listening on http://localhost:${port}`))
