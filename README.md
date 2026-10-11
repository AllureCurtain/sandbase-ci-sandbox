# sandbase-ci-sandbox

在**你自己的** Cloudflare 账号和**你自己的** GitHub 私有仓库里，复现生产 CI（`sandbase-lab/pelican-test` 的 `deploy.yml` / `import-seed.yml`）中的 D1 迁移和 seed 导入步骤，用来判断生产 run 38140529600 在 “Apply remote D1 migrations” 报 `code: 7500`（`You do not have permission to perform this operation`）的原因。

- 所有资源都是临时的：D1 和 bucket 名为 `ci-sandbox-<run id>-<attempt>`，跑完在 `if: always()` 步骤中删除。
- 不部署任何 Worker，不出现任何生产 D1 id、bucket 名或 Worker 名。
- `migrations/`、`seed/*/seed.sql`、`seed/*/manifest.json` 从 `pelican-test` 的 `origin/main` 逐字节复制；R2 对象只保留 2 个（1 个 PNG、1 个 HTML），用于上传测试。

## 文件

| 路径 | 作用 |
|---|---|
| `.github/workflows/d1-repro.yml` | 手动触发的复现 workflow（输入 `wrangler_version`、`test_r2`） |
| `scripts/ci/wr.sh` | workflow 里的 `wr` 命令：`npx wrangler@$WRANGLER_VERSION` |
| `wrangler.template.toml` | 每次运行生成临时 `wrangler.toml` / `wrangler.stage1.toml` 的模板 |
| `migrations/0001–0003` | 与生产相同的迁移 |
| `seed/watermelon-test/`、`seed/endless-runner/` | 两份 seed SQL、manifest，以及 2 个 R2 对象 |
| `scripts/local-repro.mjs` | 同一套步骤的本地版（只用 `--local`） |
| `scripts/check-yaml.mjs` | 解析 workflow YAML 并检查关键约束 |

## workflow 做了什么

1. 打印 token 自检结果（只打印 `status` 字段）。
2. `wrangler d1 create` 创建临时 D1（`--location apac`，与生产一致），从输出解析 `database_id`，生成临时 `wrangler.toml`。
3. 只应用 `0001`，模拟生产现状（0001 已应用，0002/0003 待应用）。
4. `d1 migrations list --remote`。
5. （可选）如果配置了只读 token secret，用它再跑一次 list + apply，复现“list 成功、apply 失败”。
6. `d1 migrations apply --remote`，应用 0002、0003 —— 就是生产失败的那一步。失败时额外跑只读诊断，并单独用 `d1 execute --file` 执行 0002 的 SQL。
7. `d1 execute --remote --file` 导入两份 seed，然后用只读查询校验行数（4 个 run、5 个 result、3 条迁移记录）。
8. `test_r2=true` 时：创建临时 bucket，put → get → 校验 sha256 → delete。
9. 无论成功失败，都删除临时 D1（和 bucket）。

`WRANGLER_LOG=debug` 会打印每次 API 调用的方法和 URL。已确认 3.99.0 和 4.149.0 在写日志前都会删除 `Authorization` 头，并且 `WRANGLER_LOG_SANITIZE=true`（默认值，workflow 中也显式写了）会省略所有请求头和请求体，所以 token 不会出现在日志里。GitHub 也会对 secret 做掩码。

## 你需要做的事

### 1. 在自己的 Cloudflare 账号创建 API Token

Dashboard → My Profile → API Tokens → Create Token → Custom token：

- 必需：**Account → D1 → Edit**
- 可选（`test_r2=true` 时需要）：**Account → Workers R2 Storage → Edit**。注意：账号第一次启用 R2 时可能需要先绑定付款方式（R2 有免费额度，但开通需要绑卡）。
- Account Resources：选你自己的账号。

再在 Dashboard 首页右侧（或 Workers & Pages 概览页）复制 **Account ID**。

可选：再建一个**只有 Account → D1 → Read** 的 token，作为 `CLOUDFLARE_API_TOKEN_READONLY`，用来验证“生产 token 只有 D1 读权限”这个猜测（见下文结果解读）。

### 2. 创建私有仓库并推送

在本目录（`ci-sandbox/`）执行：

```bash
gh repo create <你的 GitHub 账号>/sandbase-ci-sandbox --private --source . --push
```

### 3. 设置 secret

不带 `--body` 时 `gh` 会提示输入，值不会进入 shell 历史：

```bash
gh secret set CLOUDFLARE_API_TOKEN   -R <你的 GitHub 账号>/sandbase-ci-sandbox
gh secret set CLOUDFLARE_ACCOUNT_ID  -R <你的 GitHub 账号>/sandbase-ci-sandbox
# 可选：只有 D1 Read 权限的 token
gh secret set CLOUDFLARE_API_TOKEN_READONLY -R <你的 GitHub 账号>/sandbase-ci-sandbox
```

### 4. 分别用 3.99.0 和 4.x 各跑一次

网页：仓库 → Actions → **D1 repro** → Run workflow，`wrangler_version` 先填 `3.99.0`，再填 `4.149.0`。

或命令行：

```bash
gh workflow run d1-repro.yml -R <你的 GitHub 账号>/sandbase-ci-sandbox -f wrangler_version=3.99.0 -f test_r2=false
gh workflow run d1-repro.yml -R <你的 GitHub 账号>/sandbase-ci-sandbox -f wrangler_version=4.149.0 -f test_r2=false
gh run list -R <你的 GitHub 账号>/sandbase-ci-sandbox -w d1-repro.yml
gh run view <run id> -R <你的 GitHub 账号>/sandbase-ci-sandbox --log-failed
```

需要测 R2 时把 `test_r2` 改成 `true`（需要 token 带 R2 权限）。

## 如何解读结果

看 “Apply remote D1 migrations” 这一步（以及 Summary）：

| 3.99.0 | 4.x | 结论 |
|---|---|---|
| 失败 | 成功 | **wrangler 版本问题**：生产 CI 升级到 wrangler 4 即可 |
| 成功 | 成功 | 用法和 SQL 都没问题，问题在**生产库或生产 token**（例如 token 只有 D1 Read，或生产库本身的状态） |
| 失败 | 失败 | **用法或 SQL 的问题**：看 “Diagnose failed apply” 的输出，判断是 SQL 本身还是 migrations 命令 |

配置了只读 token 时，再看 “Read-only token probe” 的结果：如果它也是“list 成功、apply 失败”，而且错误码同样是 7500，就基本说明生产 token 缺少 **D1 Edit** 权限。

注意：沙盒库是新建的空库，生产库是旧库。两个版本都成功只能排除“版本 / 用法 / SQL”，生产库和生产 token 需要管理员在 Cloudflare 侧确认。

## 本地自检（不连 Cloudflare）

```bash
npm install
npm run check:yaml     # 解析 workflow 并检查约束
npm run local:v3       # wrangler 3.99.0：0001 → 0002/0003 → 两份 seed → 计数 → R2
npm run local:v4       # wrangler 4.149.0：同上
```

本地状态写到系统临时目录 `ci-sandbox-local-<version>/`，每次运行前删除。所有命令都带 `--local`。

## 费用

D1 免费额度（每天的读写行数、存储）远大于这里的用量：一次运行只写十几行、建 1 个库。R2 只上传 2 个对象（约 250 KB）且马上删除，在免费额度内。临时资源在每次运行结束时自动删除。如果某次清理失败，日志会给出 `::error::` 和资源名，到 Dashboard 手动删除即可。
