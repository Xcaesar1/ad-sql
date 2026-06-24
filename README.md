# SIF ASIN 反查流量词看板

局域网 Web 工具。office-pc 作为唯一生产运行机, 使用专用 Chrome 登录 SIF, 自动打开 ASIN 反查页, 点击“流量词”下载按钮, 下载 XLSX 后解析入库并展示关键词排名数据。

## 角色分工

- notepc: 只负责开发, 测试, 提交和推送代码。
- office-pc: 负责部署, 运行, SIF 登录态, SQLite 数据库, XLSX 下载归档, 诊断截图和本地备份。
- 局域网用户: 访问 office-pc 的 Web 页面使用系统。

生产数据只保存在 office-pc。不要把 `data/`, `logs/`, SIF Cookie, 密码, token 或 Chrome profile 提交到 Git。

## 功能

- ASIN 数据源维护: 新增, 启用, 停用, 软删除。
- ASIN 修改原则: 新增新 ASIN + 停用或删除旧 ASIN, 不直接改历史 ASIN 主键。
- 全局屏蔽词: 不区分大小写, 包含匹配, 命中后默认隐藏。
- 自动采集: 后端复用 office-pc 上的专用 Chrome 会话。
- 历史批次: 默认查看最新成功批次, 支持最近 180 天历史窗口, 按日期查看和切换历史批次。
- 可视化: KPI, 自然/SP 页码分布, 机会/风险四象限, 页一覆盖率, 关键词排名明细表。

## notepc 开发流程

```powershell
npm install
npm run dev
```

开发验证:

```powershell
npm test
npm run build
```

notepc 只使用本地测试数据。不要从 office-pc 拷贝真实 `E:\ad-sql\data` 回 notepc 开发。

## office-pc 生产目录

固定目录:

```text
E:\ad-sql
```

生产数据目录:

```text
E:\ad-sql\data
```

关键数据:

- `E:\ad-sql\data\app.db`: SQLite 数据库。
- `E:\ad-sql\data\uploads\<ASIN>\`: 自动采集后已入库的原始 XLSX 归档。
- `E:\ad-sql\data\downloads\`: 自动采集下载临时文件。
- `E:\ad-sql\data\chrome-profile\`: SIF 专用 Chrome 登录态配置目录。
- `E:\ad-sql\data\diagnostics\`: 自动采集失败截图。
- `E:\ad-sql\logs\`: 生产启动日志。

默认展示最近 180 天历史批次, 便于保留半年数据并按日期回看。更早数据不会自动删除, 如需调整展示窗口可设置 `COLLECTION_RETENTION_DAYS` 环境变量。

## office-pc 首次部署

在 office-pc 上打开 PowerShell:

```powershell
cd E:\
git clone https://github.com/Xcaesar1/ad-sql.git E:\ad-sql
cd E:\ad-sql
npm install
npm run build
```

如果已经 clone 过:

```powershell
cd E:\ad-sql
git pull
npm install
npm run build
```

## office-pc 首次登录 SIF

在 office-pc 上运行:

```powershell
cd E:\ad-sql
.\scripts\office-sif-login.ps1
```

脚本会打开使用 `E:\ad-sql\data\chrome-profile` 的专用 Chrome。人工登录 SIF 后, 关闭 Chrome 或按 `Ctrl+C` 结束脚本。后续自动采集会复用这个登录态。

## office-pc 手动启动

```powershell
cd E:\ad-sql
.\scripts\office-start.ps1
```

默认配置:

- `HOST=0.0.0.0`
- `PORT=5173`
- `DATA_DIR=E:\ad-sql\data`
- `SIF_CHROME_PROFILE_DIR=E:\ad-sql\data\chrome-profile`

局域网访问:

```text
http://office-pc-ip:5173
```

## office-pc 登录后自动启动

注册 Windows 任务计划程序:

```powershell
cd E:\ad-sql
.\scripts\office-register-autostart.ps1
```

注册后, 当前 Windows 用户每次登录 office-pc 都会自动启动项目。这个方式依赖登录后的桌面会话, 不是 Windows Service, 更适合需要可见 Chrome 登录态的 SIF 采集。

注册后立即启动一次:

```powershell
.\scripts\office-register-autostart.ps1 -RunNow
```

查看任务:

```powershell
Get-ScheduledTask -TaskName "SIF ASIN Dashboard"
```

删除自动启动任务:

```powershell
Unregister-ScheduledTask -TaskName "SIF ASIN Dashboard" -Confirm:$false
```

## office-pc 本地备份

手动备份:

```powershell
cd E:\ad-sql
.\scripts\office-backup.ps1
```

默认备份到:

```text
E:\ad-sql-backups\YYYY-MM-DD-HHmmss
```

备份内容:

- `app.db`
- `app.db-wal`
- `app.db-shm`
- `uploads\`

默认不备份:

- `chrome-profile\`: 包含 SIF 登录态, 不建议自动复制。
- `downloads\`: 临时下载目录。
- `diagnostics\`: 失败截图, 可人工查看。
- `logs\`: 运行日志。

## 日常使用

1. 使用人通过局域网访问 `http://office-pc-ip:5173`。
2. 在左侧添加, 停用或删除 ASIN。
3. 点击顶部 `立即采集`, office-pc 会打开或复用专用 Chrome, 进入 SIF 反查页并点击“流量词”下载。
4. 自动采集失败时, 页面会显示失败原因。请转人工到 office-pc 检查 SIF 登录态, Chrome 窗口或 `E:\ad-sql\data\diagnostics` 诊断截图。
5. 在左侧维护屏蔽词, 命中屏蔽词的关键词默认不展示。
6. 在表格上方搜索, 筛选第一页, 有 SP, 无 SP, 或显示已屏蔽。

## 运行边界

- office-pc 需要保持 Windows 用户登录状态。
- 不建议把项目注册成 Windows Service, 因为 SIF 采集依赖可见 Chrome 会话。
- office-pc 不要睡眠或自动断网。
- 正在采集时修改 ASIN, 本轮任务按触发时的 ASIN 快照继续跑完, 修改只影响后续任务。
- v1 暂不做登录账号体系。局域网访问权限暂由 office-pc 网络和防火墙控制。

## 验证

```powershell
npm test
npm run build
```

测试覆盖 XLSX 解析, 排名详情解析, 屏蔽词匹配, ASIN 维护, 自动采集 Chrome 会话复用, 看板分布和明细过滤。
