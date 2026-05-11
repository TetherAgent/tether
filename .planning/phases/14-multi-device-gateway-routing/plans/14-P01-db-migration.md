---
phase: 14-multi-device-gateway-routing
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/server/sql/008_multi_device_gateway.sql
autonomous: true
requirements: [GATEWAY-MULTI-01]
must_haves:
  truths:
    - "gateways 表新增 device_key, hostname, local_port 三列"
    - "旧 UNIQUE KEY uq_gateways_account_user 被删除，新增 uq_gateways_device_key"
    - "现有行（device_key = NULL）不受影响，读取正常"
  artifacts:
    - path: "apps/server/sql/008_multi_device_gateway.sql"
      provides: "DDL migration: add columns + swap unique key"
  key_links:
    - from: "008_multi_device_gateway.sql"
      to: "apps/server/app/service/db.ts (ensureSchema)"
      via: "db.ts 动态加载 sql/ 目录下全部文件，按文件名排序执行"
---

<objective>
为 gateways 表新增多设备支持所需的三列（device_key、hostname、local_port），并将 UNIQUE KEY 从 (account_id, user_id) 替换为 (account_id, user_id, device_key)。

Purpose: 后续 Plan 02 的服务端 upsert-by-device-key 逻辑依赖新唯一键；Plan 03 的 CLI 登录需要 device_key 列可写。
Output: `apps/server/sql/008_multi_device_gateway.sql`
</objective>

<execution_context>
@/Users/dream/code/tether/.planning/phases/14-multi-device-gateway-routing/14-RESEARCH.md
</execution_context>

<context>
@/Users/dream/code/tether/.planning/ROADMAP.md

<!-- 当前 gateways 表状态（007_remove_workspace.sql 已执行后）：
  - workspace_id 和 fk_gateways_workspace 已由 007 删除，本 migration 禁止触碰
  - 现有 UNIQUE KEY: uq_gateways_account_user (account_id, user_id)
  - 需新增: device_key VARCHAR(128), hostname VARCHAR(255), local_port INT
  - 需删除旧 unique key, 新增 uq_gateways_device_key (account_id, user_id, device_key)
-->

从 apps/server/sql/007_remove_workspace.sql 确认：
- `ALTER TABLE gateways DROP FOREIGN KEY fk_gateways_workspace` 已执行
- `ALTER TABLE gateways DROP COLUMN workspace_id` 已执行
- 禁止在 008 中重复这些操作
</context>

<tasks>

<task type="auto">
  <name>Task 1: 创建 008_multi_device_gateway.sql</name>
  <files>apps/server/sql/008_multi_device_gateway.sql</files>
  <action>
    创建迁移文件，包含以下 DDL（严格按顺序）：

    1. ADD COLUMN device_key VARCHAR(128) DEFAULT NULL AFTER admin_user_id
    2. ADD COLUMN hostname VARCHAR(255) DEFAULT NULL AFTER device_key
    3. ADD COLUMN local_port INT DEFAULT NULL AFTER hostname
    4. DROP INDEX uq_gateways_account_user
    5. ADD UNIQUE KEY uq_gateways_device_key (account_id, user_id, device_key)

    **注意事项：**
    - 禁止在此文件中 DROP workspace_id 或 fk_gateways_workspace（007 已执行）
    - device_key 允许 NULL（兼容历史无 device_key 的旧行）
    - UNIQUE KEY 中 device_key 允许 NULL：MySQL 中多行 NULL device_key 不冲突（NULL != NULL in UNIQUE index）
    - 文件编码 UTF-8，首行注释说明用途和日期

    参考 apps/server/sql/007_remove_workspace.sql 的注释风格。
  </action>
  <verify>
    在本地 MySQL 中执行：
    ```
    mysql -u root tether < apps/server/sql/008_multi_device_gateway.sql
    mysql -u root tether -e "DESCRIBE gateways"
    mysql -u root tether -e "SHOW INDEX FROM gateways WHERE Key_name LIKE '%device_key%' OR Key_name LIKE '%account_user%'"
    ```
    预期：
    - DESCRIBE 显示 device_key, hostname, local_port 三列存在
    - SHOW INDEX 显示 uq_gateways_device_key 存在，uq_gateways_account_user 不存在
  </verify>
  <done>
    - 文件存在于 apps/server/sql/008_multi_device_gateway.sql
    - 执行后 DESCRIBE gateways 包含 device_key, hostname, local_port
    - uq_gateways_account_user 被删除，uq_gateways_device_key 存在
    - 旧行 device_key = NULL，SELECT * FROM gateways 查询无报错
  </done>
</task>

</tasks>

<verification>
```bash
# 类型检查（migration 文件是纯 SQL，无 TypeScript 改动，只需确认 db.ts 能加载）
pnpm --filter @tether/server typecheck
```
</verification>

<success_criteria>
- 008_multi_device_gateway.sql 存在且语法无误
- 在 MySQL 中执行后 gateways 表结构符合 D-01/D-02/D-03 要求
- 旧行（device_key = NULL）仍可正常读取
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-01-SUMMARY.md`，记录：
- migration 文件路径
- 新增的三列和新唯一键
- 确认 workspace_id 相关操作未触碰
</output>
