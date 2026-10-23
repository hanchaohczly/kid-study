# Docker Compose 部署

## 1. 准备配置

```bash
cp deploy.env.example deploy.env
mkdir -p secrets
openssl rand -base64 48 > secrets/postgres_password
openssl rand -base64 48 > secrets/backup_passphrase
chmod 600 secrets/*
```

编辑 `deploy.env`，至少替换以下值：

- `DATA_DIR`：NAS 上的数据目录。
- `JWT_SECRET`：执行 `openssl rand -hex 32` 生成。
- `MODEL_CONFIG_ENCRYPTION_KEY`：再次执行 `openssl rand -hex 32` 独立生成。
- `DEV_PARENT_PASSWORD`、`DEV_CHILD_PIN`：家长密码与孩子 PIN。
- `LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL`：需要使用环境模型配置时填写。

HTTPS 反向代理部署时将 `COOKIE_SECURE` 设为 `true`。

## 2. 启动

```bash
docker compose --env-file deploy.env -f compose.deploy.yml up -d --build
docker compose --env-file deploy.env -f compose.deploy.yml ps
```

默认访问地址：`http://服务器地址:8080`。

启用 Prometheus：

```bash
docker compose --env-file deploy.env -f compose.deploy.yml \
  --profile monitoring up -d
```

Prometheus 默认访问端口为 `9090`，API 指标仅通过 Compose 内网采集。

## 3. 升级

```bash
git pull --ff-only
docker compose --env-file deploy.env -f compose.deploy.yml up -d --build
```

空数据库会自动执行 `infra/migrations` 中的全部迁移。已有数据库升级前必须备份，
再按尚未执行的迁移编号顺序升级。

## 4. 备份与恢复演练

```bash
COMPOSE_FILE="$PWD/compose.deploy.yml" \
BACKUP_PASSPHRASE_FILE="$PWD/secrets/backup_passphrase" \
BACKUP_DIR="${DATA_DIR:-./data}/backups" \
bash scripts/backup-postgres.sh

COMPOSE_FILE="$PWD/compose.deploy.yml" \
BACKUP_PASSPHRASE_FILE="$PWD/secrets/backup_passphrase" \
BACKUP_DIR="${DATA_DIR:-./data}/backups" \
bash scripts/restore-drill.sh
```

不要将 `deploy.env`、`secrets/`、数据卷或备份目录提交到 Git。
