# 家庭学习系统

基于 [产品方案](./产品方案.md) 和
[技术架构设计](./技术架构设计.md) 实现。当前事实基线见
[实施状态](./实施状态.md)。

## 当前进度

已完成开发版核心学习闭环：

- npm workspaces：Vue 3 PWA、Fastify API、共享事件契约；
- 家长/孩子会话与服务端角色校验；
- 知识点、公开题面与私有答案/步骤/评分点分表；
- 家长上传文本层教材 PDF，服务端按页提取文本并分段调用大模型；
- 自动生成章节、知识点与前置关系，家长确认后发布知识结构；
- 教材分析草稿与确认状态持久化到 PostgreSQL；
- 题目不在教材导入时预生成，只在例行考察或家长主动发起时动态生成；
- 家长端按 Chat、Embedding、Vision 三类能力配置模型；
- 每类能力支持独立主模型、回退模型、重试次数和请求超时；
- 模型 API Key 使用 AES-256-GCM 加密存储，管理页面只返回末四位掩码；
- 动态出题结合目标知识点、教材摘要、考察目的和孩子近期学习事件；
- 生成题通过结构、目标范围、重复题和提示答案泄漏校验后下发；
- 考察题与指定孩子绑定，未下发题目不能调用判题或提示接口；
- 孩子今日训练只读取当日下发题目，服务端持久化训练会话和题目尝试；
- 25 分钟后服务端拒绝开启新题，30 分钟后当前题交卷即关闭会话；
- 服务端按每次权威判题结果记录正确性、提交时提示等级和证据时间；
- 使用 M1 v2 四维模型生成版本化掌握证据，证据不足时不展示伪精确分数；
- 家长可查看证据摘要并标记同意、不同意或暂不确定，过期版本会拒绝提交；
- 分步引导生成器只读取公开题面，不接触标准答案、参考步骤和评分点；
- 引导候选经规则检查和独立语义检查后整段返回，泄漏时最多重试 2 次；
- 检查失败、超时或连续阻断时返回本地 L1/L2/L3 安全模板；
- 引导审核记录响应指纹、模型/策略版本、阻断原因和耗时，不记录普通候选正文；
- 内存开发仓储与 PostgreSQL 内容仓储使用同一接口；
- IndexedDB Outbox 和批量事件补传；
- `eventId`、`deviceId + localSeq` 幂等与冲突检测；
- 家长/学校任务手动录入、孩子声明完成、家长核验和超期减负；
- 教学进度录入、映射确认和自动预习任务；
- T+1、T+3、T+14 与 30 天维护复习，到期题自动并入今日训练；
- 正确率、提示依赖、跨日稳定性和速度四维掌握度；
- 家长周报包含周间趋势、薄弱点和建议话术；
- 系统错题与拍照错题、标签备注、连续复习达标；
- Android 单 APK 双模式、手写画布、Room/WorkManager 离线补传和 Passport Deep Link；
- 独立 AI Passport 固件支持 BLUFI、离线整轮、20 条 Outbox、回放和宵禁深睡；
- PostgreSQL `001`–`016` 迁移、Docker Compose、Caddy 和 Prometheus 指标；
- Node/迁移/Android CI、加密备份恢复脚本、健康压测和 216 条安全对抗回归。

当前内存开发仓储保留 2 个知识点和 3 道种子题作为测试夹具；正常产品流程不会把种子题直接
下发。家长工作台提供教材知识库、主动考察、例行考察和下发记录。

尚未完成生产验收：扫描版 PDF/课表/学校任务 OCR、Embedding/RAG、课表自动映射、
数据导出/删除和完整审计、HarmonyOS、告警通知、真实家庭陪跑，以及 Android 与
Passport 真机测试。Passport 的任务清单、进度回填和携带提醒仍未实现。详细边界和
发布阻断项见 [实施状态](./实施状态.md)。

## 本地开发

要求 Node.js 22 或更高版本。

```bash
npm install
```

终端一：

```bash
npm run dev:api
```

终端二：

```bash
npm run dev:web
```

访问 `http://127.0.0.1:5173`。

开发环境的业务数据默认使用内存仓储：

- 孩子 PIN：`2468`
- 家长密码：`dev-parent`

设置 `DATABASE_URL` 后，API 自动切换为 PostgreSQL 仓储。生产环境不会接受缺失的数据库与凭证配置。

家长登录后可在“模型配置”中管理 OpenAI 兼容接口。当前能力分工：

- Chat：教材结构化、动态出题、分步引导与语义安全检查；
- Embedding：后续教材语义检索、知识点匹配、相似错题检索；
- Vision：后续扫描教材、作业图片和数学公式识别。

`LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL` 仍可作为未配置系统设置时的
Chat 兼容默认值。系统配置保存后立即生效并优先于环境变量。

未设置 `DATABASE_URL` 时，模型配置单独持久化到
`data/model-configs.json`，API Key 仍为 AES-256-GCM 密文，服务重启后不会丢失。
可通过 `MODEL_CONFIG_FILE` 修改文件位置。启用 PostgreSQL 后自动改用数据库仓储。
本地配置文件已加入 Git 忽略规则，不应提交到源码仓库。

从文件仓储切换到 PostgreSQL 时，可执行一次性迁移。目标家庭已有数据库配置时，
命令会拒绝覆盖：

```bash
DATABASE_URL='postgres://...' \
MODEL_CONFIG_ENCRYPTION_KEY='新数据库加密密钥' \
LEGACY_MODEL_CONFIG_FILE='./data/model-configs.json' \
LEGACY_MODEL_CONFIG_ENCRYPTION_KEY='旧文件加密密钥' \
npm run migrate:model-config --workspace @kid-study/api
```

当前仅支持含文本层的原生电子版 PDF，单文件上限 30 MB。API Key
不会返回给前端。生产环境必须设置独立的 `MODEL_CONFIG_ENCRYPTION_KEY`；
修改该密钥前需要重新录入已保存的模型 API Key。
PostgreSQL 模式会按 PDF SHA-256 保存分析任务及每个分块结果。模型临时失败或
API 重启后，重新上传同一 PDF 即可跳过已完成分块继续处理。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

测试覆盖：

- 同一事件重复提交只计一次；
- 事件 ID 内容冲突与设备序列冲突；
- 跨家庭复用事件 ID 不被确认；
- 未登录不能写入事件；
- 孩子不能访问家长开发视图；
- 孩子不能访问内容管理与考察管理；
- 教材确认只发布知识结构，不预生成题目；
- 家长主动或例行发起考察后才生成并下发题目；
- 孩子训练响应不含答案和提示模板；
- 未分配给当前孩子的题目不能判题或获取提示；
- 扫描件无文本时明确拒绝；
- 模型生成提示包含答案时拒绝题目；
- 引导生成器输入不包含标准答案、参考步骤和评分点；
- 引导泄漏时重新生成，连续阻断或语义检查异常时 fail closed；
- 25 分钟拒绝开启新题，30 分钟后当前题交卷并关闭会话；
- 模型密钥加密与掩码返回；
- 可重试错误按配置重试，主模型失败后切换回退模型；
- Outbox 单调序号、成功清理与断网保留；
- 任务双确认、进度映射、T+1/T+3/T+14/维护复习和四维掌握度；
- 216 条答案表达对抗变体全部阻断；
- Prometheus 指标端点不经 Caddy 暴露。

## NAS 部署

部署文件位于 `infra/compose`。首次部署：

```bash
cd infra/compose
cp .env.example .env
mkdir -p secrets
openssl rand -base64 32 > secrets/postgres_password
docker compose up -d --build
```

部署前必须修改 `.env` 中的 JWT、家长密码和孩子 PIN。默认端口为 `8080`。

PostgreSQL 数据默认写入 `${DATA_DIR}/postgres`。空数据卷会依次执行
`001_initial.sql` 至 `016_learning_plan.sql`。已有数据卷需在备份后单独执行尚未应用的迁移：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/002_content.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/003_textbook_import.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/004_dynamic_assessment.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/005_model_configuration.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/006_training_guide.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/007_remove_demo_content.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/008_textbook_analysis_checkpoint.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/009_normalize_textbook_chapters.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/010_group_centroid_practice_under_chapter_13.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/011_group_shortest_path_practice_under_chapter_15.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/012_precompute_option_hints.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/013_mastery_review.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/014_weekend_paper.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/015_wrong_book.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/migrations/016_learning_plan.sql
```

不能依赖容器初始化目录升级已有数据库。

生成独立备份密钥并执行加密备份与隔离恢复演练：

```bash
openssl rand -base64 48 > infra/compose/secrets/backup_passphrase
bash scripts/backup-postgres.sh
bash scripts/restore-drill.sh
```

备份使用 AES-256-CBC/PBKDF2 加密并生成 SHA-256 校验文件；保留 14 个日备份和
8 个周备份。恢复脚本拒绝覆盖 `kid_study` 生产库。

可选启用 Prometheus：

```bash
docker compose --profile monitoring up -d
```

Prometheus 默认监听 `9090`，其数据卷位于 `${DATA_DIR}/prometheus`。API 的
`/metrics` 只在 Compose 内网抓取，Caddy 不向外转发该路径。

## 目录

```text
apps/
  api/                  Fastify API
  web/                  Vue 3 PWA
packages/
  contracts/            共享 DTO 与事件 schema
infra/
  compose/              NAS 部署
  migrations/           PostgreSQL 迁移
```

## 安全边界

- 题目答案不进入前端构建物；
- 判题和提示要求题目已下发给当前孩子；
- 身份和 `familyId` 从服务端会话获取，不接受客户端覆盖；
- 未同步操作先写 IndexedDB；
- 普通日志对 Cookie、凭证和孩子输入做脱敏；
- 模型 API Key 在数据库中加密，日志对配置请求中的密钥字段脱敏；
- 动态题提示经过规则检查与独立语义检查；规则对抗集当前包含 216 条答案表达变体。
- 正式陪跑前仍需补充真实模型红队、数据导出/删除和审计查询验收。
