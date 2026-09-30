# 双条件 AI 对话实验

此项目基于 [Vercel Chatbot](https://github.com/vercel/chatbot)。被试通过两个独立链接进入实验：

- `/study/a`：共同规则 + 《模型要求》中的迎合条件规则
- `/study/b`：共同规则 + 《模型要求》中的相对独立判断条件规则

两个入口均在服务端调用同一个 DeepSeek 模型 `deepseek-flash`。提示词保存在服务端的 `lib/study/prompts.json`，浏览器请求不能选择模型或提交提示词。原始文档中的共同规则与两组条件规则已经转入该文件。

对话时长为 **10–30 分钟**：参与者阅读开始页说明并点击“开始对话”后计时，满 10 分钟才能点击“结束对话”，确认后保存结束时间并停止接收新消息。第 25 分钟显示收尾提醒，满 30 分钟再次提醒，但不会强制中断。计时按开始后的实际经过时间计算，刷新、切换标签页或暂时离开不会暂停或重置；服务端校验最短时长。

默认不限制对话轮数。若另行设置 `STUDY_MAX_EXCHANGES`，达到轮数后停止发送消息，但仍须满 10 分钟才能手动结束。以时长为准的实验建议不设置该变量。

升级已有项目时，先执行 `corepack pnpm db:migrate` 应用计时字段迁移，再启动网站。已有聊天记录会保留，旧会话以第一条已保存消息的时间作为开始时间；没有消息的会话等待参与者点击开始。

## 本地启动

需要 Node.js 22、pnpm 和一个 PostgreSQL 数据库。复制 `.env.example` 为 `.env.local`，至少配置：

```env
AUTH_SECRET=请填写随机长字符串
POSTGRES_URL=postgresql://用户名:密码@地址:5432/数据库名
DEEPSEEK_API_KEY=请填写你的DeepSeekAPIKey
STUDY_ADMIN_TOKEN=请填写独立的随机长字符串
```

面向公网开放时，建议另外配置 `REDIS_URL`，以启用项目已有的 IP 频率限制；若不配置，访客仍可聊天，但该频率限制不会生效。

然后执行：

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3000/study/a` 和 `http://localhost:3000/study/b`。首次打开时项目会自动建立匿名访客身份，无需被试注册。一个浏览器身份在每个条件下对应一条持续会话；刷新页面会恢复聊天记录。正式实验应向每位被试只发其所属组的链接，并让不同被试使用各自的浏览器会话。

## 云端部署与数据导出

先将这个改造后的目录提交并推送到你自己的**私有 GitHub 仓库**，再在 Vercel 导入该仓库、连接 PostgreSQL，并设置上述四个环境变量。不要直接部署未经改造的上游 `vercel/chatbot` 仓库。Vercel 构建脚本会运行数据库迁移。部署后将 `/study/a` 与 `/study/b` 的完整 HTTPS 链接分别发给两组被试。DeepSeek API Key 和管理员令牌只能放在服务端环境变量中。

每次成功交互的用户消息和 AI 回复会成对写入 `StudyMessage`，并关联 `StudySession` 的会话 UUID、组别、模型、提示词快照和时间。CSV 还包含 `started_at`、`ended_at`、`duration_seconds`，其中时长仅在手动结束后填写；时间均为 UTC。使用管理员令牌下载 UTF-8 CSV：

```powershell
Invoke-WebRequest -Uri 'https://你的域名/api/study/export' -Headers @{ Authorization = 'Bearer 你的STUDY_ADMIN_TOKEN' } -OutFile 'study-conversations.csv'
```

导出接口不会向没有管理员令牌的请求提供数据。若模型请求失败，输入框会保留用户文字，且不会写入一段缺少 AI 回复的对话。部署前请用两个独立浏览器会话分别试聊、刷新和导出一次，确认两组记录及提示词配置符合实验方案。

### 管理后台

访问 `/admin` 并输入 `STUDY_ADMIN_TOKEN` 可查看参与者会话、按组别筛选和搜索用户/会话 UUID，也可检查对话全文。管理员令牌至少需要 32 个字符。后台可以保存 DeepSeek API Key 的数据库覆盖值；它使用 AES-256-GCM 加密后存储，页面不会回显 Key。未设置后台覆盖值时，系统继续使用 `DEEPSEEK_API_KEY` 环境变量。加密密钥由 `STUDY_ADMIN_TOKEN` 派生，因此更换该环境变量后，需要在后台重新保存 API Key。部署构建会自动创建后台设置表；本地可运行 `pnpm db:migrate`。
