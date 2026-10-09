import { useEffect, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Activity, ArrowDownToLine, ArrowUpFromLine, Box, Camera, Check, ChevronDown, CircleHelp, Clock3, Download, FileText, LogIn, LogOut, Package, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, Upload, UserPlus, Users, X } from 'lucide-react'
import './App.css'
import './dashboard.css'

type Asset = { id: number; code: string; name: string; category: string; location: string; quantity: number; unit: string; status: string }
type RecordRow = { id: number; asset_code: string; asset_name: string; direction: 'in' | 'out'; quantity: number; purpose: string; actor: string; created_at: string }
type Summary = { totalAssets: number; totalQuantity: number; inboundToday: number; outboundToday: number; lowStock: number }
type Session = { id: number; username: string; role: 'admin' | 'operator' }
type Operator = { id: number; username: string; role: 'operator'; is_active: number; expires_at: string | null; created_at: string }
const fmtTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
const fmtCreatedAt = (value: string) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`))
const csvHeaderAliases: Record<string, string> = { '资产编码': 'code', '唯一编码': 'code', 编码: 'code', '资产名称': 'name', 名称: 'name', 分类: 'category', '存放位置': 'location', 库位: 'location', '初始库存': 'quantity', 数量: 'quantity', 库存: 'quantity', 单位: 'unit', 用途: 'purpose' }
const normalizeCsvHeader = (header: string) => {
  const clean = header.replace(/^\uFEFF/, '').trim()
  return csvHeaderAliases[clean] ?? clean.toLowerCase()
}
function downloadCsv(filename: string, fields: string[], rows: (string | number)[][]) {
  const safeRows = rows.map((row) => row.map((value) => {
    // EN: Prefix spreadsheet formula starters to prevent CSV formula injection.
    // 中文：给表格公式起始字符加前缀，避免导出的 CSV 被当作公式执行。
    const text = String(value ?? '')
    return /^[=+@\-\t\r]/.test(text) ? `'${text}` : text
  }))
  const csv = `\uFEFF${Papa.unparse({ fields, data: safeRows })}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function App() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [summary, setSummary] = useState<Summary>({ totalAssets: 0, totalQuantity: 0, inboundToday: 0, outboundToday: 0, lowStock: 0 })
  const [session, setSession] = useState<Session | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'assets' | 'records'>('overview')
  const [modal, setModal] = useState<'scan' | 'asset' | 'login' | 'edit' | 'help' | null>(null)
  const [userManagerOpen, setUserManagerOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [direction, setDirection] = useState<'in' | 'out'>('out')
  const [scanCode, setScanCode] = useState('')
  const [purposeChoice, setPurposeChoice] = useState('日常领用')
  const [purpose, setPurpose] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [camera, setCamera] = useState(false)
  const [todayLabel] = useState(() => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date()))
  const [loginName, setLoginName] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [operators, setOperators] = useState<Operator[]>([])
  const [operatorSearch, setOperatorSearch] = useState('')
  const [newOperatorName, setNewOperatorName] = useState('')
  const [newOperatorPassword, setNewOperatorPassword] = useState('')
  const [newOperatorExpiry, setNewOperatorExpiry] = useState('')
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null)
  const [operatorActive, setOperatorActive] = useState(true)
  const [operatorExpiry, setOperatorExpiry] = useState('')
  const [operatorNewPassword, setOperatorNewPassword] = useState('')
  const [newAsset, setNewAsset] = useState({ code: '', name: '', category: '办公设备', location: 'A区仓库', quantity: 1 })
  const [editing, setEditing] = useState<RecordRow | null>(null)
  const [bulkType, setBulkType] = useState<'assets' | 'movement'>('assets')
  const [bulkDirection, setBulkDirection] = useState<'in' | 'out'>('in')
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([])
  const [csvFilename, setCsvFilename] = useState('')
  const [csvError, setCsvError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const scanInputRef = useRef<HTMLInputElement>(null)

  async function fetchData() {
    const [dashboardResponse, assetsResponse, recordsResponse, authResponse] = await Promise.all([fetch('/api/dashboard'), fetch('/api/assets'), fetch('/api/records'), fetch('/api/auth/me')])
    const [dashboard, nextAssets, nextRecords, auth] = await Promise.all([dashboardResponse.json(), assetsResponse.json(), recordsResponse.json(), authResponse.json()])
    return { dashboard, assets: nextAssets, records: nextRecords, session: auth.user ?? null }
  }
  function applyData(data: Awaited<ReturnType<typeof fetchData>>) {
    setSummary(data.dashboard)
    setAssets(data.assets)
    setRecords(data.records)
    setSession(data.session)
  }
  async function load() { applyData(await fetchData()) }
  useEffect(() => {
    let active = true
    void fetchData().then((data) => { if (active) applyData(data) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!camera || !videoRef.current) return
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setNotice('浏览器只允许 HTTPS 页面使用摄像头。请通过 HTTPS 域名访问；服务器 IP 的 HTTP 地址无法打开摄像头。')
      return
    }
    let active = true
    let stopCamera: (() => void) | undefined
    // EN: Load the camera decoder only on demand and stop the device when this effect is cleaned up.
    // 中文：仅在需要时加载摄像头解码器，并在 effect 清理时停止摄像头。
    void import('@zxing/browser').then(({ BrowserMultiFormatReader }) => {
      if (!active || !videoRef.current) return
      const reader = new BrowserMultiFormatReader()
      return reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => { if (active && result) { setScanCode(result.getText()); setCamera(false) } }).then((controls) => { stopCamera = () => controls.stop(); if (!active) controls.stop() })
    }).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : ''
      const message = name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器网站设置中允许摄像头后重试。'
        : name === 'NotFoundError' ? '未检测到可用摄像头，请检查设备或使用扫码枪。'
          : name === 'NotReadableError' ? '摄像头可能正被其他应用占用，请关闭占用摄像头的应用后重试。'
            : name === 'SecurityError' ? '摄像头访问被浏览器安全策略拦截，请确认使用 HTTPS，并检查 iframe 的 camera 权限设置。'
              : '无法打开摄像头，请检查浏览器权限、HTTPS 访问方式或改用扫码枪。'
      setNotice(message)
    })
    return () => { active = false; stopCamera?.() }
  }, [camera])

  async function submitMovement(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const response = await fetch('/api/movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: scanCode.trim(), direction, purpose: purpose.trim() || purposeChoice, quantity }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '操作失败')
      setNotice(`${body.asset.name} ${direction === 'in' ? '入库' : '出库'}成功`); setModal(null); setScanCode(''); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '操作失败') } finally { setBusy(false) }
  }
  async function createAsset(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const response = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAsset) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '新增失败')
      setNotice('资产档案已建立'); setModal(null); setNewAsset({ code: '', name: '', category: '办公设备', location: 'A区仓库', quantity: 1 }); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '新增失败') } finally { setBusy(false) }
  }
  async function deleteAsset(asset: Asset) {
    if (!window.confirm(`确定删除“${asset.name}”（${asset.code}）吗？该操作会同时永久删除库存流水和关联审计记录，且无法恢复。`)) return
    try {
      const response = await fetch(`/api/admin/assets/${asset.id}`, { method: 'DELETE' })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '删除失败')
      setNotice('资产档案及关联记录已删除'); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '删除失败') }
  }
  function openBulkDialog(type: 'assets' | 'movement', movementDirection: 'in' | 'out' = 'in') {
    setBulkType(type); setBulkDirection(movementDirection); setCsvRows([]); setCsvFilename(''); setCsvError(''); setBulkOpen(true)
  }
  function readCsvFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setCsvFilename(file.name); setCsvRows([]); setCsvError('')
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeCsvHeader,
      complete: (result) => {
        // EN: Reject malformed, empty, or oversized imports before they reach the API.
        // 中文：在请求后端前拦截格式错误、空文件或超出行数上限的导入。
        if (result.errors.length) { setCsvError(`CSV 格式错误：${result.errors[0].message}`); return }
        if (!result.meta.fields?.length || result.data.length === 0) { setCsvError('文件没有可导入的数据行'); return }
        if (result.data.length > 1000) { setCsvError('单次最多导入 1000 行'); return }
        setCsvRows(result.data)
      },
    })
  }
  function downloadCsvTemplate() {
    if (bulkType === 'assets') downloadCsv('资产导入模板.csv', ['资产编码', '资产名称', '分类', '存放位置', '初始库存', '单位'], [['AST-001', '示例资产', '办公设备', 'A区仓库', 0, '件']])
    else downloadCsv('批量出入库模板.csv', ['资产编码', '数量', '用途'], [['AST-001', 1, bulkDirection === 'in' ? '采购入库' : '日常领用']])
  }
  function exportAssets() {
    downloadCsv('资产档案.csv', ['资产编码', '资产名称', '分类', '存放位置', '库存数量', '单位'], assets.map((asset) => [asset.code, asset.name, asset.category, asset.location, asset.quantity, asset.unit]))
  }
  function exportRecords() {
    downloadCsv('出入库记录.csv', ['资产编码', '资产名称', '方向', '数量', '用途', '操作人', '操作时间'], records.map((record) => [record.asset_code, record.asset_name, record.direction === 'in' ? '入库' : '出库', record.quantity, record.purpose, record.actor, record.created_at]))
  }
  async function submitBulk(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const endpoint = bulkType === 'assets' ? '/api/assets/import' : '/api/movements/batch'
      const payload = bulkType === 'assets' ? { rows: csvRows } : { direction: bulkDirection, rows: csvRows }
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '导入失败')
      setNotice(bulkType === 'assets' ? `已导入 ${body.imported} 条资产档案` : `已完成 ${body.processed} 条${bulkDirection === 'in' ? '入库' : '出库'}记录`)
      setModal(null); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '导入失败') } finally { setBusy(false) }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: loginName, password: loginPassword }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '登录失败')
      setSession(body.user); setModal(null); setLoginPassword(''); setNotice(`${body.user.role === 'admin' ? '管理员' : '操作员'}已登录`); await load()
    } catch (error) { setNotice(error instanceof Error ? error.message : '登录失败') } finally { setBusy(false) }
  }
  async function openUserManager() {
    try {
      const response = await fetch('/api/admin/users')
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '无法读取账号列表')
      setOperators(body); setOperatorSearch(''); setSelectedOperator(null); setNewOperatorName(''); setNewOperatorPassword(''); setNewOperatorExpiry(''); setUserManagerOpen(true)
    } catch (error) { setNotice(error instanceof Error ? error.message : '无法读取账号列表') }
  }
  async function createOperator(event: React.FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const response = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: newOperatorName, password: newOperatorPassword, expiresAt: newOperatorExpiry || null }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '创建账号失败')
      setOperators((current) => [...current, body as Operator].sort((a, b) => a.username.localeCompare(b.username)))
      setNewOperatorName(''); setNewOperatorPassword(''); setNewOperatorExpiry(''); setNotice(`操作员账号 ${body.username} 已创建`)
    } catch (error) { setNotice(error instanceof Error ? error.message : '创建账号失败') } finally { setBusy(false) }
  }
  function editOperator(operator: Operator) {
    setSelectedOperator(operator)
    setOperatorActive(operator.is_active === 1)
    setOperatorExpiry(operator.expires_at ?? '')
    setOperatorNewPassword('')
  }
  async function saveOperator(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedOperator) return
    setBusy(true)
    try {
      const response = await fetch(`/api/admin/users/${selectedOperator.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: operatorActive, expiresAt: operatorExpiry || null, ...(operatorNewPassword ? { password: operatorNewPassword } : {}) }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '保存账号失败')
      setOperators((current) => current.map((operator) => operator.id === body.id ? body as Operator : operator))
      setSelectedOperator(body as Operator); setOperatorNewPassword(''); setNotice('账号设置已保存')
    } catch (error) { setNotice(error instanceof Error ? error.message : '保存账号失败') } finally { setBusy(false) }
  }
  async function deleteOperator(operator: Operator) {
    if (!window.confirm(`确定删除操作员账号“${operator.username}”吗？`)) return
    try {
      const response = await fetch(`/api/admin/users/${operator.id}`, { method: 'DELETE' })
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '删除账号失败')
      setOperators((current) => current.filter((item) => item.id !== operator.id)); if (selectedOperator?.id === operator.id) setSelectedOperator(null); setNotice('操作员账号已删除')
    } catch (error) { setNotice(error instanceof Error ? error.message : '删除账号失败') }
  }
  async function logout() { await fetch('/api/auth/logout', { method: 'POST' }); setSession(null); setNotice('已退出管理员账号') }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return
    const form = new FormData(event.currentTarget)
    const response = await fetch(`/api/admin/records/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ purpose: form.get('purpose'), createdAt: form.get('createdAt') }) })
    const body = await response.json(); if (!response.ok) { setNotice(body.error ?? '保存失败'); return }
    setNotice('记录已更新，时间修改已写入后台审计'); setEditing(null); setModal(null); await load()
  }
  const filteredAssets = assets.filter((asset) => `${asset.name} ${asset.code} ${asset.category} ${asset.location}`.toLowerCase().includes(search.toLowerCase()))
  const visibleRecords = records.filter((record) => `${record.asset_name} ${record.asset_code} ${record.purpose}`.toLowerCase().includes(search.toLowerCase()))
  const visibleOperators = operators.filter((operator) => operator.username.toLowerCase().includes(operatorSearch.toLowerCase()))

  return <div className={session ? 'app-shell authenticated-view' : 'app-shell guest-view'}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Package size={19} /></span><span>栈点<span className="brand-sub">ASSET DESK</span></span></div>
      <div className="workspace-tag"><span className="status-dot" />总务资产中心</div>
      <div className="nav-label">工作空间</div>
      <nav className="nav-list">
        <button className={activeTab === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('overview')}><Activity size={17} />运营总览</button>
        <button className={activeTab === 'assets' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('assets')}><Box size={17} />资产档案<span className="nav-count">{assets.length}</span></button>
        <button className={activeTab === 'records' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('records')}><FileText size={17} />出入库记录</button>
      </nav>
      <div className="sidebar-bottom"><div className="system-status"><span className="status-dot" /><span>系统运行正常</span><span className="system-version">v1.1</span></div><button className="help-link" onClick={() => setModal('help')}><CircleHelp size={16} />使用帮助</button><div className="profile"><div className="avatar">{session ? session.role === 'admin' ? '管' : '操' : '访'}</div><div className="profile-name">{session?.username ?? '未登录'}<small>{session ? session.role === 'admin' ? 'ADMINISTRATOR' : 'OPERATOR' : 'GUEST'}</small></div>{session?.role === 'admin' && <button className="icon-button" title="操作员账号管理" onClick={() => void openUserManager()}><UserPlus size={16} /></button>}{session ? <button className="icon-button" title="退出账号" onClick={() => void logout()}><LogOut size={16} /></button> : <button className="icon-button" title="账号登录" onClick={() => setModal('login')}><Settings2 size={16} /></button>}</div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">资产管理 <span>/</span> {activeTab === 'overview' ? '运营总览' : activeTab === 'assets' ? '资产档案' : '出入库记录'}</div><div className="topbar-actions"><div className="today-label"><Clock3 size={15} />{todayLabel}</div>{session?.role === 'admin' && <button className="text-button operator-toolbar-button" onClick={() => void openUserManager()}><Users size={15} />操作员管理</button>}{session ? <span className="admin-chip"><ShieldCheck size={14} />{session.role === 'admin' ? '管理员模式' : `操作员：${session.username}`}</span> : <button className="text-button" onClick={() => setModal('login')}><LogIn size={15} />账号登录</button>}
      </div></header>
      <section className="page-content">
        <div className="page-heading"><div><div className="eyebrow"><Sparkles size={13} />ASSET OPERATIONS</div><h1>{activeTab === 'overview' ? '运营总览' : activeTab === 'assets' ? '资产档案' : '出入库记录'}</h1><p>{activeTab === 'overview' ? '库存与流转状态，一屏掌握。' : activeTab === 'assets' ? '维护资产信息，快速定位库存。' : '按时间倒序查看每一笔资产流转。'}</p></div><div className="heading-actions">{session ? <><button className="button button-secondary" onClick={() => { setDirection('in'); setModal('scan') }}><ArrowDownToLine size={16} />扫码入库</button><button className="button button-primary" onClick={() => { setDirection('out'); setModal('scan') }}><ArrowUpFromLine size={16} />扫码出库</button></> : <button className="button button-primary" onClick={() => setModal('login')}><LogIn size={16} />登录后进行出入库</button>}</div></div>
        {activeTab === 'overview' && <>
          <div className="metric-grid">
            <Metric label="资产种类" value={summary.totalAssets.toLocaleString()} unit="种" caption="已建立档案" icon={<Box size={17} />} tone="mint" />
            <Metric label="在库总量" value={summary.totalQuantity.toLocaleString()} unit="件" caption="实时库存数量" icon={<Package size={17} />} tone="coral" />
            <Metric label="今日入库" value={summary.inboundToday.toLocaleString()} unit="件" caption="今日累计入库" icon={<ArrowDownToLine size={17} />} tone="blue" />
            <Metric label="今日出库" value={summary.outboundToday.toLocaleString()} unit="件" caption="今日累计出库" icon={<ArrowUpFromLine size={17} />} tone="gold" />
          </div>
          <div className="content-grid">
            <section className="panel inventory-panel">
              <div className="panel-heading"><div><h2>库存概况</h2><p>当前各项资产可用数量</p></div><button className="quiet-link" onClick={() => setActiveTab('assets')}>查看资产档案 <ChevronDown size={14} className="side-chevron" /></button></div>
              <AssetTable assets={assets.slice(0, 5)} onSelect={(code) => { setScanCode(code); setModal('scan') }} isAdmin={session?.role === 'admin'} canOperate={!!session} onDelete={(asset) => void deleteAsset(asset)} />
            </section>
            <section className="panel movement-panel">
              <div className="panel-heading"><div><h2>最近流转</h2><p>最新出入库动态</p></div><button className="round-icon" title="查看所有记录" onClick={() => setActiveTab('records')}><ChevronDown size={16} className="rotate-icon" /></button></div>
              <div className="timeline">{records.slice(0, 5).map((record) => <RecordItem key={record.id} record={record} />)}{records.length === 0 && <EmptyState />}</div>
            </section>
          </div>
          {session ? <section className="scanner-strip"><div className="scanner-symbol"><Camera size={20} /></div><div className="scanner-copy"><strong>开始一次扫码操作</strong><span>支持手机摄像头识别，也兼容 USB 扫码枪。</span></div><div className="scanner-shortcuts"><button onClick={() => { setDirection('in'); setModal('scan') }}><ArrowDownToLine size={15} />入库</button><button onClick={() => { setDirection('out'); setModal('scan') }}><ArrowUpFromLine size={15} />出库</button></div></section> : <section className="scanner-strip"><div className="scanner-symbol"><ShieldCheck size={20} /></div><div className="scanner-copy"><strong>当前为只读浏览</strong><span>登录账号后即可扫码、录入资产和登记库存。</span></div><button className="button button-primary" onClick={() => setModal('login')}><LogIn size={15} />账号登录</button></section>}
        </>}
        {activeTab === 'assets' && <><div className="toolbar"><label className="search-box"><Search size={17} /><input placeholder="搜索名称、编码、分类或库位" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="toolbar-actions"><span className="result-count">共 {filteredAssets.length} 项</span>{session && <button className="button button-primary" onClick={() => setModal('asset')}><Plus size={16} />新增资产</button>}</div></div><section className="panel table-panel"><AssetTable assets={filteredAssets} onSelect={(code) => { setScanCode(code); setModal('scan') }} isAdmin={session?.role === 'admin'} canOperate={!!session} onDelete={(asset) => void deleteAsset(asset)} /></section><div className="asset-data-actions"><button className="button button-secondary" onClick={exportAssets}><Download size={15} />导出资产 CSV</button>{session && <><button className="button button-secondary" onClick={() => openBulkDialog('assets')}><Upload size={15} />导入资产 CSV</button><button className="button button-secondary" onClick={() => openBulkDialog('movement', 'in')}><ArrowDownToLine size={15} />批量入库</button><button className="button button-secondary" onClick={() => openBulkDialog('movement', 'out')}><ArrowUpFromLine size={15} />批量出库</button></>}</div></>}
        {activeTab === 'records' && <><div className="toolbar"><label className="search-box"><Search size={17} /><input placeholder="搜索资产、编码或用途" value={search} onChange={(event) => setSearch(event.target.value)} /></label><span className="result-count">{visibleRecords.length} 条记录 · 按时间倒序</span></div><section className="panel records-panel"><div className="records-export"><button className="button button-secondary" onClick={exportRecords}><Download size={15} />导出流水 CSV</button></div><RecordTable records={visibleRecords} isAdmin={session?.role === 'admin'} onEdit={(record) => { setEditing(record); setModal('edit') }} /></section></>}
      </section><footer className="page-footer"><span>栈点资产管理系统</span><span>库存数据实时更新 <i /></span></footer>
    </main>
    {userManagerOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setUserManagerOpen(false) }}><section className="modal operator-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><span className="modal-kicker">OPERATOR ACCOUNTS</span><h2>用户管理</h2></div><button className="icon-button" title="关闭" onClick={() => setUserManagerOpen(false)}><X size={18} /></button></div><div className="operator-layout"><section className="operator-list-panel"><div className="operator-list-heading"><div><h3>仓库操作员</h3><small>登录后所有库存操作均记录账号名</small></div><span>{operators.length} 个</span></div><label className="search-box operator-search"><Search size={16} /><input placeholder="搜索操作员账号" value={operatorSearch} onChange={(event) => setOperatorSearch(event.target.value)} /></label>{visibleOperators.length > 0 ? <div className="operator-table-wrap"><table className="operator-table"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>有效期</th><th>创建日期</th></tr></thead><tbody>{visibleOperators.map((operator) => <tr key={operator.id}><td><span className="operator-identity"><span className="operator-avatar">{operator.username.slice(0, 1).toUpperCase()}</span><button type="button" className="operator-account-link" onClick={() => editOperator(operator)}>{operator.username}</button></span></td><td><span className="operator-role">仓库操作员</span></td><td><span className={`operator-status ${operator.is_active === 1 ? 'enabled' : 'disabled'}`}>{operator.is_active === 1 ? '已启用' : '已停用'}</span></td><td>{operator.expires_at ?? '长期有效'}</td><td>{fmtCreatedAt(operator.created_at)}</td></tr>)}</tbody></table></div> : <div className="operator-empty"><Users size={22} /><strong>{operators.length ? '没有匹配的账号' : '还没有操作员账号'}</strong><span>{operators.length ? '试试其他账号名称' : '在右侧创建第一个仓库操作员'}</span></div>}</section><section className="operator-create-panel"><div className="operator-list-heading"><div><h3>创建操作员</h3><small>为每位仓库成员创建独立登录账号</small></div><UserPlus size={18} /></div><form className="form-stack operator-create" onSubmit={createOperator}><label className="field-label">登录账号<input value={newOperatorName} onChange={(event) => setNewOperatorName(event.target.value)} minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]+" placeholder="例如 warehouse01" autoComplete="off" required /></label>
      <div className="csv-instructions">3 到 40 位英文、数字、点、下划线或短横线</div>
      <label className="field-label">初始密码<input type="password" value={newOperatorPassword} onChange={(event) => setNewOperatorPassword(event.target.value)} minLength={12} maxLength={128} placeholder="至少 12 位" autoComplete="new-password" required /></label>
      <label className="field-label">有效期至（可选）<input type="date" value={newOperatorExpiry} onChange={(event) => setNewOperatorExpiry(event.target.value)} /></label>
      <div className="csv-instructions">有效期留空表示长期有效；创建后请通过安全渠道交付账号和密码。</div>
      <button className="button button-primary submit-button" disabled={busy || !newOperatorName.trim() || newOperatorPassword.length < 12}>{busy ? '正在创建...' : '创建操作员账号'}</button>
    </form></section></div></section></div>}
    {selectedOperator && userManagerOpen && <div className="modal-backdrop operator-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOperator(null) }}><section className="modal operator-detail-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><span className="modal-kicker">ACCOUNT SETTINGS</span><h2>{selectedOperator.username}</h2></div><button className="icon-button" title="关闭" onClick={() => setSelectedOperator(null)}><X size={18} /></button></div><form className="form-stack" onSubmit={saveOperator}><label className="operator-active-toggle"><input type="checkbox" checked={operatorActive} onChange={(event) => setOperatorActive(event.target.checked)} /><span>{operatorActive ? '账号已启用' : '账号已停用'}</span></label><label className="field-label">有效期至<input type="date" value={operatorExpiry} onChange={(event) => setOperatorExpiry(event.target.value)} /></label><div className="csv-instructions">留空表示长期有效；到期当天结束后账号自动失效。</div><label className="field-label">重置密码<input type="password" value={operatorNewPassword} onChange={(event) => setOperatorNewPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" placeholder="不修改请留空；新密码至少 12 位" /></label><button className="button button-primary submit-button" disabled={busy || (!!operatorNewPassword && operatorNewPassword.length < 12)}>{busy ? '正在保存...' : '保存账号设置'}</button><button type="button" className="operator-delete" onClick={() => void deleteOperator(selectedOperator)}><Trash2 size={15} />删除此操作员账号</button></form></section></div>}
    {notice && <div className="toast"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="关闭提示"><X size={15} /></button></div>}
    {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(null); setCamera(false) } }}><section className="modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><span className="modal-kicker">{modal === 'scan' ? 'INVENTORY MOVEMENT' : modal === 'login' ? 'ADMIN ACCESS' : modal === 'edit' ? 'RECORD ADJUSTMENT' : modal === 'help' ? 'QUICK HELP' : 'ASSET REGISTER'}</span><h2>{modal === 'scan' ? direction === 'in' ? '扫码入库' : '扫码出库' : modal === 'login' ? '账号登录' : modal === 'edit' ? '修订出入库记录' : modal === 'help' ? '使用帮助' : '新增资产档案'}</h2></div><button className="icon-button" onClick={() => { setModal(null); setCamera(false) }}><X size={18} /></button></div>
      {modal === 'scan' && <form onSubmit={submitMovement} className="form-stack"><div className="mode-toggle"><button type="button" className={direction === 'out' ? 'selected' : ''} onClick={() => setDirection('out')}><ArrowUpFromLine size={15} />出库</button><button type="button" className={direction === 'in' ? 'selected' : ''} onClick={() => setDirection('in')}><ArrowDownToLine size={15} />入库</button></div>{camera && <video ref={videoRef} className="camera-view" muted playsInline />}<label className="field-label">资产条码 / 二维码<input ref={scanInputRef} autoFocus autoComplete="off" value={scanCode} onChange={(event) => setScanCode(event.target.value)} placeholder="点击后用 USB 扫码枪扫描，或手动输入" onKeyDown={(event) => { if (event.key === 'Enter' && scanCode) event.preventDefault() }} /></label><button type="button" className="camera-button" onClick={() => setCamera((value) => !value)}><Camera size={16} />{camera ? '关闭摄像头' : '打开手机摄像头'}</button><div className="form-row"><label className="field-label">数量<input type="number" min="1" max="99999" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} required /></label><label className="field-label">常用用途<select value={purposeChoice} onChange={(event) => setPurposeChoice(event.target.value)}><option>日常领用</option><option>项目使用</option><option>借用</option><option>维修更换</option><option>归还入库</option><option>其他</option></select></label></div><label className="field-label">具体备注<input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="可选，填写项目、领用人或详细原因" /></label><div className="form-note"><ShieldCheck size={15} />操作时间由系统自动记录，管理员修订会单独审计。</div><button className="button button-primary submit-button" disabled={busy || !scanCode.trim()}>{busy ? '正在提交...' : direction === 'in' ? '确认入库' : '确认出库'}</button></form>}
      {modal === 'asset' && <form onSubmit={createAsset} className="form-stack"><label className="field-label">资产名称<input value={newAsset.name} onChange={(event) => setNewAsset({ ...newAsset, name: event.target.value })} required /></label><label className="field-label">唯一编码<input value={newAsset.code} onChange={(event) => setNewAsset({ ...newAsset, code: event.target.value })} placeholder="可使用二维码或条形码内容" required /></label><div className="form-row"><label className="field-label">分类<input value={newAsset.category} onChange={(event) => setNewAsset({ ...newAsset, category: event.target.value })} required /></label><label className="field-label">存放库位<input value={newAsset.location} onChange={(event) => setNewAsset({ ...newAsset, location: event.target.value })} required /></label></div><label className="field-label">初始库存<input type="number" min="0" value={newAsset.quantity} onChange={(event) => setNewAsset({ ...newAsset, quantity: Number(event.target.value) })} required /></label><button className="button button-primary submit-button" disabled={busy}>建立资产档案</button></form>}
      {modal === 'login' && <form onSubmit={login} className="form-stack"><div className="login-note"><ShieldCheck size={18} />使用管理员或仓库操作员账号登录。</div><label className="field-label">账号<input autoComplete="username" value={loginName} onChange={(event) => setLoginName(event.target.value)} required /></label><label className="field-label">密码<input type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label><button className="button button-primary submit-button" disabled={busy}>登录</button></form>}
      {modal === 'edit' && editing && <form onSubmit={saveEdit} className="form-stack"><div className="edit-record-name">{editing.asset_name} <span>{editing.direction === 'in' ? '入库' : '出库'} · {editing.quantity} 件</span></div><label className="field-label">用途<input name="purpose" defaultValue={editing.purpose} required /></label><label className="field-label">记录时间<input type="datetime-local" name="createdAt" defaultValue={new Date(new Date(editing.created_at).getTime() - new Date(editing.created_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16)} required /></label><div className="form-note"><ShieldCheck size={15} />本次时间修改只记录在服务器审计日志中，普通用户不可查看。</div><button className="button button-primary submit-button">保存修订</button></form>}
      {modal === 'help' && <div className="help-content"><div className="help-section"><h3>访客浏览</h3><p>未登录时可查看资产库存和出入库记录，也可以搜索和导出 CSV。建档、入库、出库及批量导入需要先登录账号。</p></div><div className="help-section"><h3>仓库操作员</h3><p>使用管理员创建的账号登录后，可新增资产、进行单笔或批量出入库。每笔流水会记录当前账号名；出库数量不能超过库存。</p></div><div className="help-section"><h3>管理员</h3><p>管理员可在顶部“操作员管理”中创建账号、重置密码、停用或启用账号并设置有效期。停用或过期账号会立即失去写入权限。</p></div><div className="help-section"><h3>扫码</h3><p>手机摄像头扫码需要通过 HTTPS 访问并允许摄像头权限；桌面可使用 USB 扫码枪或手动输入资产编码。</p></div><button className="button button-primary submit-button" onClick={() => { setModal(null); if (!session) setModal('login') }}>{session ? '关闭帮助' : '账号登录'}</button></div>}
    </section></div>}
    {bulkOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBulkOpen(false) }}><section className="modal bulk-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><span className="modal-kicker">CSV OPERATIONS</span><h2>{bulkType === 'assets' ? '导入资产档案' : bulkDirection === 'in' ? '批量入库' : '批量出库'}</h2></div><button className="icon-button" title="关闭" onClick={() => setBulkOpen(false)}><X size={18} /></button></div><form onSubmit={submitBulk} className="form-stack"><div className="bulk-direction"><span>{bulkType === 'assets' ? '资产 CSV' : '库存流水 CSV'}</span><button type="button" className="button button-secondary" onClick={downloadCsvTemplate}><Download size={15} />下载模板</button></div><div className="csv-instructions">{bulkType === 'assets' ? '必需列：资产编码、资产名称；可选列：分类、存放位置、初始库存、单位。' : '每行填写一个资产编码、数量和用途；一次最多 1000 行，出库会校验当前库存。'} 整批校验通过后才会提交。</div><label className="button button-secondary csv-upload"><Upload size={15} />{csvFilename || '选择 CSV 文件'}<input className="csv-file-input" type="file" accept=".csv,text/csv" onChange={readCsvFile} /></label>{csvError && <div className="csv-error">{csvError}</div>}{csvRows.length > 0 && <><div className="csv-count">已读取 {csvRows.length} 行，预览前 5 行</div><div className="csv-preview"><table><thead><tr>{Object.keys(csvRows[0]).map((field) => <th key={field}>{field}</th>)}</tr></thead><tbody>{csvRows.slice(0, 5).map((row, index) => <tr key={index}>{Object.keys(csvRows[0]).map((field) => <td key={field}>{row[field]}</td>)}</tr>)}</tbody></table></div></>}<button className="button button-primary submit-button" disabled={busy || csvRows.length === 0}>{busy ? '正在校验并提交...' : '确认并导入'}</button></form></section></div>}
  </div>
}

function Metric({ label, value, unit, caption, icon, tone }: { label: string; value: string; unit: string; caption: string; icon: React.ReactNode; tone: string }) { return <article className="metric"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-number">{value}<small>{unit}</small></div><div className="metric-caption">{caption}</div></article> }
function AssetTable({ assets, onSelect, isAdmin = false, canOperate = false, onDelete }: { assets: Asset[]; onSelect: (code: string) => void; isAdmin?: boolean; canOperate?: boolean; onDelete?: (asset: Asset) => void }) {
  if (!assets.length) return <EmptyState />
  return <div className="table-scroll"><table><thead><tr><th>资产信息</th><th>分类</th><th>存放位置</th><th className="align-right">库存数量</th><th>状态</th><th /></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id}><td>{canOperate ? <button className="asset-cell" onClick={() => onSelect(asset.code)}><span className="asset-thumb"><Package size={16} /></span><span><strong>{asset.name}</strong><small>{asset.code}</small></span></button> : <span className="asset-cell asset-cell-static"><span className="asset-thumb"><Package size={16} /></span><span><strong>{asset.name}</strong><small>{asset.code}</small></span></span>}</td><td>{asset.category}</td><td>{asset.location}</td><td className="align-right quantity-cell">{asset.quantity}<small> {asset.unit}</small></td><td><span className={`stock-status ${asset.quantity > 0 ? 'in-stock' : 'empty-stock'}`}><i />{asset.quantity > 0 ? '在库' : '缺货'}</span></td><td>{canOperate && <button className="row-action" title="以此资产扫码操作" onClick={() => onSelect(asset.code)}><ArrowUpFromLine size={15} /></button>}{isAdmin && onDelete && <button className="row-action" title="删除资产及关联流水" onClick={() => onDelete(asset)}><Trash2 size={15} /></button>}</td></tr>)}</tbody></table></div>
}
function RecordItem({ record }: { record: RecordRow }) { const inbound = record.direction === 'in'; return <div className="timeline-item"><div className={`timeline-icon ${inbound ? 'in' : 'out'}`}>{inbound ? <ArrowDownToLine size={15} /> : <ArrowUpFromLine size={15} />}</div><div className="timeline-copy"><strong>{record.asset_name}<small className={inbound ? 'movement-in' : 'movement-out'}>{inbound ? '入库' : '出库'} {record.quantity} 件</small></strong><span>{record.purpose} · {record.actor}</span></div><time>{fmtTime(record.created_at)}</time></div> }
function RecordTable({ records, isAdmin, onEdit }: { records: RecordRow[]; isAdmin: boolean; onEdit: (record: RecordRow) => void }) {
  if (!records.length) return <EmptyState />
  return <div className="table-scroll"><table><thead><tr><th>资产</th><th>操作类型</th><th className="align-right">数量</th><th>用途</th><th>操作人</th><th>操作时间</th>{isAdmin && <th>管理</th>}</tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><span className="record-asset"><strong>{record.asset_name}</strong><small>{record.asset_code}</small></span></td><td><span className={`direction-tag ${record.direction}`}>{record.direction === 'in' ? <ArrowDownToLine size={13} /> : <ArrowUpFromLine size={13} />}{record.direction === 'in' ? '入库' : '出库'}</span></td><td className="align-right quantity-cell">{record.quantity}<small> 件</small></td><td>{record.purpose}</td><td>{record.actor}</td><td className="record-time">{new Date(record.created_at).toLocaleString('zh-CN', { hour12: false })}</td>{isAdmin && <td><button className="row-action" title="修订用途和时间" onClick={() => onEdit(record)}><Settings2 size={15} /></button></td>}</tr>)}</tbody></table></div>
}
function EmptyState() { return <div className="empty-state"><span><Package size={20} /></span><strong>暂无记录</strong><small>资产发生流转后会显示在这里</small></div> }
export default App
