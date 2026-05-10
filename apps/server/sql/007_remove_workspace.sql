-- 移除 workspace 概念：删除 workspace_id 列、相关 FK/索引，以及 workspaces 表
-- workspace 始终是每 account 一个的空壳，从未用于业务隔离，改用 account_id 直接标识

-- users
ALTER TABLE users
  DROP FOREIGN KEY fk_users_workspace,
  DROP INDEX idx_users_account_workspace,
  DROP COLUMN workspace_id;

-- admin_users
ALTER TABLE admin_users
  DROP FOREIGN KEY fk_admin_users_workspace,
  DROP INDEX idx_admin_users_account_workspace,
  DROP COLUMN workspace_id;

-- devices
ALTER TABLE devices
  DROP FOREIGN KEY fk_devices_workspace,
  DROP INDEX idx_devices_account_workspace,
  DROP COLUMN workspace_id;

-- gateways
ALTER TABLE gateways
  DROP FOREIGN KEY fk_gateways_workspace,
  DROP INDEX idx_gateways_account_workspace,
  DROP COLUMN workspace_id;

-- refresh_tokens
ALTER TABLE refresh_tokens
  DROP FOREIGN KEY fk_refresh_tokens_workspace,
  DROP INDEX idx_refresh_tokens_account_workspace,
  DROP COLUMN workspace_id;

-- gateway_refresh_tokens
ALTER TABLE gateway_refresh_tokens
  DROP FOREIGN KEY fk_gateway_refresh_tokens_workspace,
  DROP INDEX idx_gateway_refresh_tokens_account_workspace,
  DROP COLUMN workspace_id;

-- revoked_tokens（无 FK，无 index，直接删列）
ALTER TABLE revoked_tokens
  DROP COLUMN workspace_id;

-- audit_events（无 FK，有复合索引）
ALTER TABLE audit_events
  DROP INDEX idx_audit_events_account_workspace,
  DROP COLUMN workspace_id;

-- 最后删 workspaces 表（其 FK fk_workspaces_account 随表一起消失）
DROP TABLE workspaces;
