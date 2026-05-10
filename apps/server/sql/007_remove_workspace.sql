-- 移除 workspace 概念：删除 workspace_id 列、相关 FK/索引，以及 workspaces 表
-- workspace 始终是每 account 一个的空壳，从未用于业务隔离，改用 account_id 直接标识

-- users
ALTER TABLE users DROP FOREIGN KEY fk_users_workspace;
ALTER TABLE users DROP INDEX idx_users_account_workspace;
ALTER TABLE users DROP COLUMN workspace_id;

-- admin_users
ALTER TABLE admin_users DROP FOREIGN KEY fk_admin_users_workspace;
ALTER TABLE admin_users DROP INDEX idx_admin_users_account_workspace;
ALTER TABLE admin_users DROP COLUMN workspace_id;

-- devices
ALTER TABLE devices DROP FOREIGN KEY fk_devices_workspace;
ALTER TABLE devices DROP INDEX idx_devices_account_workspace;
ALTER TABLE devices DROP COLUMN workspace_id;

-- gateways
ALTER TABLE gateways DROP FOREIGN KEY fk_gateways_workspace;
ALTER TABLE gateways DROP INDEX idx_gateways_account_workspace;
ALTER TABLE gateways DROP COLUMN workspace_id;

-- refresh_tokens
ALTER TABLE refresh_tokens DROP FOREIGN KEY fk_refresh_tokens_workspace;
ALTER TABLE refresh_tokens DROP INDEX idx_refresh_tokens_account_workspace;
ALTER TABLE refresh_tokens DROP COLUMN workspace_id;

-- gateway_refresh_tokens
ALTER TABLE gateway_refresh_tokens DROP FOREIGN KEY fk_gateway_refresh_tokens_workspace;
ALTER TABLE gateway_refresh_tokens DROP INDEX idx_gateway_refresh_tokens_account_workspace;
ALTER TABLE gateway_refresh_tokens DROP COLUMN workspace_id;

-- revoked_tokens（无 FK，无 index，直接删列）
ALTER TABLE revoked_tokens DROP COLUMN workspace_id;

-- audit_events（无 FK，有复合索引）
ALTER TABLE audit_events DROP INDEX idx_audit_events_account_workspace;
ALTER TABLE audit_events DROP COLUMN workspace_id;

-- 最后删 workspaces 表（其 FK fk_workspaces_account 随表一起消失）
DROP TABLE IF EXISTS workspaces;

-- gateway_sessions（来自 002_gateway_runtime_sync.sql）
ALTER TABLE gateway_sessions DROP INDEX idx_gateway_sessions_account_workspace;
ALTER TABLE gateway_sessions DROP COLUMN workspace_id;

-- gateway_deleted_sessions（来自 005_gateway_deleted_sessions.sql）
-- 先删旧主键（含 workspace_id），再建新主键
ALTER TABLE gateway_deleted_sessions DROP PRIMARY KEY;
ALTER TABLE gateway_deleted_sessions DROP COLUMN workspace_id;
ALTER TABLE gateway_deleted_sessions ADD PRIMARY KEY (session_id, account_id, user_id);
