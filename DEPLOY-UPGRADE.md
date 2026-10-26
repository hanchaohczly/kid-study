# 已有 NAS 数据库升级

首次部署仍使用 `infra/compose/compose.yml`。已有 PostgreSQL 数据卷时，重建镜像不会执行新增 SQL，禁止通过删除数据卷来升级。

升级到英语单词本版本（数据库此前已应用 001–016）：

```bash
git pull --ff-only
npm ci
npm run ci
bash scripts/upgrade-wordbook.sh
docker compose -f infra/compose/compose.yml up -d --build api web
```

`upgrade-wordbook.sh` 检查既有表，停止 API 写入，以权限 600 保存完整备份，在同一 PostgreSQL 实例的临时数据库恢复并演练 017，验证六张词本表，再事务化应用到正式库。版本和 SQL 校验值在同一事务中记录；已经存在完整 017 表结构时跳过。失败时不会删除正式库或备份；API 可能仍处于停止状态，应检查报错后再启动。

默认 Compose 文件为 `infra/compose/compose.yml`，备份位置为 `backups/upgrades/`；可用 `COMPOSE_FILE`、`BACKUP_DIR` 指定其他路径。临时副本需要足够磁盘空间。备份是未加密的 PostgreSQL custom dump，按私人数据库备份保存；需要加密归档时使用既有 `scripts/backup-postgres.sh`。

发布后检查 `/health/ready`、词本上传→预览校对→确认→考察→答题，并在真实浏览器确认最新 JS/CSS 和 Service Worker 更新。Passport 需升级固件；新固件调用 `/v1/passport/word-training`，每批最多 8 题，50 题分多批完成。网页和设备都不接收答案键，离线答案仅进入 20 条 FIFO 队列，联网后评分并更新错词本。
