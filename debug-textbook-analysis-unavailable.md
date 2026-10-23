# Debug Session: textbook-analysis-unavailable
- **Status**: [OPEN]
- **Issue**: 上传教材并启动自动梳理后，前端提示“服务暂时不可用”，预期应完成 PDF 文本提取和教材结构化分析。
- **Debug Server**: http://127.0.0.1:7777/event
- **Log File**: .dbg/trae-debug-log-textbook-analysis-unavailable.ndjson

## Reproduction Steps
1. 家长登录。
2. 选择教材 PDF 并上传。
3. 启动自动梳理。
4. 页面提示“服务暂时不可用”。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | API 热重载后内存模型配置丢失 | High | Low | Rejected：复现前 Chat 配置为 configured |
| B | PDF 没有可提取的文本层 | Medium | Low | Rejected：182 页，118588 个规范化字符 |
| C | 大块 Chat 请求超时、输出结构异常或 PDF 字体映射异常 | High | Medium | Confirmed：334 秒后 500；Inspector 捕获 CMap 参数缺失 |
| D | Web 连接到了另一份 API 进程 | Medium | Low | Rejected：5174 代理到 127.0.0.1:3000 |
| E | 当前运行实例与主项目源码版本不一致 | High | Low | Rejected：运行目录和源码时间已核对 |
| F | 开发服务热重载中断正在运行的教材请求 | High | Low | Confirmed：请求 req-j 运行 49.6 秒时收到 SIGTERM，前端随后收到空白 502 |

## Log Evidence
1. Pre-fix log line 2: 9 MB PDF 上传在 334 秒后返回 HTTP 500 `INTERNAL_ERROR`。
2. Inspector evidence: `Ensure that the cMapUrl and cMapPacked API parameters are provided.`。
3. 独立文本提取：182 页、120730 字符、118588 个规范化字符，文件存在文本层。
4. Chat 配置测试：`deepseek-flash` 单次小请求 5.454 秒成功。

## Verification Conclusion
根因是教材处理对 PDF CMap 和大上下文模型请求缺少稳健处理，并且路由未映射模型结构校验/超时错误，最终统一表现为无法解释的 HTTP 500。

## Fix
1. PDFParse 显式配置 `pdfjs-dist/cmaps` 与 `cMapPacked=true`。
2. 单次教材模型输入由 60000 字符降至 8000 字符。
3. 教材结构校验、模型空响应、HTTP 错误和超时返回明确的 422/502 错误。
4. 教材分块使用自适应重试：8000 字符请求先用 45 秒探测，超时或服务端错误后依次拆成约 4000、2000 字符；最小分块才使用模型配置的完整重试次数。
5. 新增分块上限、自适应拆分、非重试错误和调用方重试覆盖测试。

## Post-Fix Verification
- 自动测试：API 36 个测试通过。
- 类型检查与生产构建通过。
- 原 PDF 使用显式 CMap 成功提取 182 页、121095 字符。
- 2026-10-10 端到端重试：请求 `req-p` 在 184.475 秒后返回 HTTP 502。
- 诊断日志第 2 行确认错误为 `LLM_TEXTBOOK_ANALYSIS_FAILED`，提示教材分析模型请求失败或超时。
- 请求期间 API 健康，浏览器上传连接与 Chat 服务 HTTPS 连接持续存在；排除前端断开和 API 进程崩溃。
- 当前结论：PDF 提取已修复，但 `deepseek-flash` 对 20000 字符教材分块的 Chat 请求仍无法在 90000 ms 超时窗口内稳定完成。
- 自适应重试实现后：类型检查、API 43 项测试、Web 6 项测试、Contracts 2 项测试和生产构建通过；等待真实教材后修复验证。
- 2026-10-10 最新截图：诊断日志第 11 行记录自适应分析已启动；第 12 行在约 50 秒后收到空白 `text/plain 502`。
- API 原生日志确认请求 `req-j` 于 17:25:13 开始，17:26:03 因 `src/config.ts` 变更触发 `tsx` 重启并收到 SIGTERM，17:26:07 旧进程被强制终止。该次 502 是部署中断，不是教材处理逻辑主动返回。
- 同一轮部署发生在旧内存模型配置保存之后，新的文件仓储启用之前；当前 Chat、Embedding、Vision 均未配置，需要最后重新保存一次。之后配置会加密落盘并跨重启保留。
- 2026-10-10 17:31 后修复实跑：前 14/16 个初始分块成功，分块 2、8、12 的上游 503 均通过自适应拆分恢复。
- 第 15 块在 503 后拆到路径 `15.1.1`（1268 字符）；主模型/Fallback 的配置内重试在 3248 ms 内仍全部返回 503。由于该段低于 2000 字符拆分下限，系统记录 `textbook segment failed`，请求 `req-h` 最终返回 HTTP 502。
- 本轮最终进度 87.5%。新确认的剩余缺陷：重试之间没有退避等待，且最小分块失败会丢弃整次请求已完成的 14 块结果。
