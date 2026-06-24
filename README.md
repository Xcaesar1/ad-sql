# SIF ASIN 反查流量词看板

局域网 Web 工具, 用一台采集主机的专用 Chrome 登录 SIF, 自动下载 ASIN 反查流量词 XLSX, 解析后用看板和明细表展示关键词, 自然排名详情, SP(常规)排名详情。

## 功能

- ASIN 数据源维护: 新增, 启用, 停用, 软删除。
- 全局屏蔽词: 不区分大小写, 包含匹配, 默认隐藏命中关键词。
- XLSX 入库: 支持自动采集和人工上传兜底。
- 历史批次: 默认看最新成功批次, 可切换历史批次。
- 可视化: 顶部指标, 自然/SP 页码分布, 机会/风险词, 关键词明细表。

## 启动

```powershell
npm install
npm run dev
```

默认监听 `http://0.0.0.0:5173`, 局域网设备可用采集主机 IP 访问。

## 首次登录 SIF

在采集主机运行:

```powershell
npm run sif:login
```

打开的 Chrome 使用 `data/chrome-profile` 作为专用配置目录。人工登录 SIF 后, 关闭命令窗口或按 `Ctrl+C`。后续自动采集会复用这个配置目录, 不读取或保存 Cookie, 密码, token。

可选环境变量:

```powershell
$env:DATA_DIR = "Q:\ad-sql\data"
$env:SIF_CHROME_PROFILE_DIR = "Q:\ad-sql\data\chrome-profile"
$env:SIF_CHROME_CHANNEL = "chrome"
$env:PORT = "5173"
```

## 日常使用

1. 在左侧添加 ASIN。
2. 点击右上角 `自动采集`, 采集主机会打开专用 Chrome, 进入 SIF 反查页并点击“流量词”下载。
3. 如果自动采集失败, 点击 `上传 XLSX`, 手动上传 SIF 下载的反查流量词文件。
4. 在左侧维护屏蔽词, 命中屏蔽词的关键词默认不展示。
5. 在表格上方搜索, 筛选第一页, 有 SP, 无 SP, 或显示已屏蔽。

## 数据目录

- `data/app.db`: SQLite 数据库。
- `data/uploads/<ASIN>/`: 已入库的原始 XLSX 归档。
- `data/downloads/`: 自动采集下载临时文件。
- `data/chrome-profile/`: SIF 专用 Chrome 登录态配置目录。

不要提交 `data/`, 不要把账号, Cookie, 密码或 token 写进项目文件。

## 验证

```powershell
npm test
npm run build
```

当前测试覆盖 XLSX 解析, 排名详情解析, 屏蔽词匹配, ASIN 维护, 人工上传入库, 看板分布和明细过滤。
