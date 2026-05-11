---
phase: 14-multi-device-gateway-routing
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/server/sql/009_multi_device_gateway.sql
autonomous: true
requirements: [GATEWAY-MULTI-01]
must_haves:
  truths:
    - "gateways 表新增 device_key, hostname, local_port 三列"
    - "旧 UNIQUE KEY uq_gateways_account_user 被删除，新增 uq_gateways_device_key"
    - "现有行（device_key = NULL）不受影响，读取正常"
    - "migration 幂等：重复执行不报 ER_DUP_FIELDNAME，Server 多次启动不会崩溃"
  artifacts:
    - path: "apps/server/sql/009_multi_device_gateway.sql"
      provides: "DDL migration: add columns + swap unique key (idempotent)"
  key_links:
    - from: "009_multi_device_gateway.sql"
      to: "apps/server/app/service/db.ts (ensureSchema)"
      via: "db.ts 动态加载 sql/ 目录下全部文件，按文件名排序执行"
---

<objective>
为 gateways 表新增多设备支持所需的三列（device_key、hostname、local_port），并将 UNIQUE KEY 从 (account_id, user_id) 替换为 (account_id, user_id, device_key)。

Purpose: 后续 Plan 02 的服务端 upsert-by-device-key 逻辑依赖新唯一键；Plan 03 的 CLI 登录需要 device_key 列可写。
Output: `apps/server/sql/009_multi_device_gateway.sql`

**注意：** 008 编号已被 `008_gateway_session_title_source.sql` 占用（在本规划后写入）。本 migration 命名为 009。
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

<!-- db.ts ensureSchema() 幂等性现状：
  - 已对 ADD INDEX / ADD KEY 重复做容错（跳过错误码 ER_DUP_KEYNAME）
  - 对 ADD COLUMN 重复没有容错（ER_DUP_FIELDNAME 会抛出）
  - 现有模式见 apps/server/sql/008_gateway_session_title_source.sql：
    用 INFORMATION_SCHEMA 查列是否存在，再 PREPARE/EXECUTE 条件 ALTER
  - 本 migration 必须对每个 ADD COLUMN 使用同样的条件包装
-->

<!-- 已有 migration 幂等模式（来自 008_gateway_session_title_source.sql）：
SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '<table>'
    AND COLUMN_NAME = '<column>'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE <table> ADD COLUMN <definition>',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
-->
</context>

<tasks>

<task type="auto">
  <name>Task 1: 创建 009_multi_device_gateway.sql（幂等 DDL）</name>
  <files>apps/server/sql/009_multi_device_gateway.sql</files>
  <action>
    创建迁移文件。文件中的每个 DDL 操作都必须包裹在幂等条件中，完全复用
    008_gateway_session_title_source.sql 中已确立的模式。

    **ADD COLUMN 操作——对每列独立检查：**

    对 device_key、hostname、local_port 各写一段 INFORMATION_SCHEMA 检查：
    ```sql
    -- 1. ADD COLUMN device_key
    SET @col_exists := (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gateways'
        AND COLUMN_NAME = 'device_key'
    );
    SET @sql := IF(
      @col_exists = 0,
      'ALTER TABLE gateways ADD COLUMN device_key VARCHAR(128) DEFAULT NULL AFTER admin_user_id',
      'SELECT 1'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    ```
    对 hostname（AFTER device_key）和 local_port（AFTER hostname）重复同样结构。

    **DROP INDEX uq_gateways_account_user——先检查是否存在：**
    ```sql
    SET @idx_exists := (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gateways'
        AND INDEX_NAME = 'uq_gateways_account_user'
    );
    SET @sql := IF(
      @idx_exists > 0,
      'ALTER TABLE gateways DROP INDEX uq_gateways_account_user',
      'SELECT 1'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    ```

    **ADD UNIQUE KEY uq_gateways_device_key——先检查是否已存在：**
    ```sql
    SET @idx_exists := (
      SELECT COUNT(*)
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'gateways'
        AND INDEX_NAME = 'uq_gateways_device_key'
    );
    SET @sql := IF(
      @idx_exists = 0,
      'ALTER TABLE gateways ADD UNIQUE KEY uq_gateways_device_key (account_id, user_id, device_key)',
      'SELECT 1'
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
    ```

    **注意事项：**
    - 禁止在此文件中 DROP workspace_id 或 fk_gateways_workspace（007 已执行）
    - device_key 允许 NULL（兼容历史无 device_key 的旧行）
    - UNIQUE KEY 中 device_key 允许 NULL：MySQL 中多行 NULL device_key 不冲突（NULL != NULL in UNIQUE index）
    - 文件编码 UTF-8，首行注释说明用途和日期
    - 文件命名为 009_multi_device_gateway.sql（008 已被 gateway_session_title_source.sql 占用）

    参考 apps/server/sql/008_gateway_session_title_source.sql 的注释风格和幂等模式。
  </action>
  <verify>
    在本地 MySQL 中执行两次，验证幂等性：
    ```bash
    mysql -u root tether < apps/server/sql/009_multi_device_gateway.sql
    mysql -u root tether < apps/server/sql/009_multi_device_gateway.sql
    mysql -u root tether -e "DESCRIBE gateways"
    mysql -u root tether -e "SHOW INDEX FROM gateways WHERE Key_name LIKE '%device_key%' OR Key_name LIKE '%account_user%'"
    ```
    预期：
    - 第一次和第二次执行都无错误输出
    - DESCRIBE 显示 device_key, hostname, local_port 三列存在
    - SHOW INDEX 显示 uq_gateways_device_key 存在，uq_gateways_account_user 不存在
  </verify>
  <done>
    - 文件存在于 apps/server/sql/009_multi_device_gateway.sql
    - 执行两次均无报错（幂等）
    - DESCRIBE gateways 包含 device_key, hostname, local_port
    - uq_gateways_account_user 被删除，uq_gateways_device_key 存在
    - 旧行 device_key = NULL，SELECT * FROM gateways 查询无报错
  </done>
</task>

</tasks>

<verification>
```bash
# 类型检查（migration 文件是纯 SQL，无 TypeScript 改动）
pnpm --filter @tether/server typecheck
```
</verification>

<success_criteria>
- 009_multi_device_gateway.sql 存在且语法无误
- 在 MySQL 中执行后 gateways 表结构符合 D-01/D-02/D-03 要求
- 重复执行不报错（幂等），Server 多次启动不崩溃（H1 修复）
- 旧行（device_key = NULL）仍可正常读取
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-01-SUMMARY.md`，记录：
- migration 文件路径和编号（009）
- 新增的三列和新唯一键
- 确认 workspace_id 相关操作未触碰
- 幂等验证（执行两次无报错）
</output>
