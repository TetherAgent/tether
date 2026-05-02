CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_accounts_email (email)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  slug VARCHAR(128) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  default_workspace_account_id VARCHAR(64)
    GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN account_id ELSE NULL END) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_workspaces_account_slug (account_id, slug),
  UNIQUE KEY uq_workspaces_default_per_account (default_workspace_account_id),
  KEY idx_workspaces_account_id (account_id),
  CONSTRAINT fk_workspaces_account
    FOREIGN KEY (account_id) REFERENCES accounts (id)
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  device_id VARCHAR(64) DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_account_email (account_id, email),
  KEY idx_users_account_workspace (account_id, workspace_id),
  CONSTRAINT fk_users_account
    FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_users_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_users_account_email (account_id, email),
  KEY idx_admin_users_account_workspace (account_id, workspace_id),
  CONSTRAINT fk_admin_users_account
    FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_admin_users_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);

CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  admin_user_id VARCHAR(64) DEFAULT NULL,
  name VARCHAR(255) NOT NULL,
  platform VARCHAR(64) NOT NULL,
  token_class VARCHAR(64) NOT NULL,
  jti VARCHAR(128) NOT NULL,
  expires_at DATETIME DEFAULT NULL,
  revoked_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_devices_jti (jti),
  KEY idx_devices_account_workspace (account_id, workspace_id),
  CONSTRAINT fk_devices_account
    FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_devices_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_devices_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_devices_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users (id)
);

CREATE TABLE IF NOT EXISTS gateways (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) DEFAULT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  admin_user_id VARCHAR(64) DEFAULT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  last_seen_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gateways_account_workspace (account_id, workspace_id),
  CONSTRAINT fk_gateways_account
    FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_gateways_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_gateways_device
    FOREIGN KEY (device_id) REFERENCES devices (id),
  CONSTRAINT fk_gateways_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_gateways_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users (id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  admin_user_id VARCHAR(64) DEFAULT NULL,
  device_id VARCHAR(64) DEFAULT NULL,
  session_id VARCHAR(128) DEFAULT NULL,
  token_class VARCHAR(64) NOT NULL,
  jti VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_tokens_jti (jti),
  KEY idx_refresh_tokens_account_workspace (account_id, workspace_id),
  CONSTRAINT fk_refresh_tokens_account
    FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_refresh_tokens_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_refresh_tokens_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users (id),
  CONSTRAINT fk_refresh_tokens_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
);

CREATE TABLE IF NOT EXISTS gateway_refresh_tokens (
  id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  gateway_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) DEFAULT NULL,
  session_id VARCHAR(128) DEFAULT NULL,
  token_class VARCHAR(64) NOT NULL,
  jti VARCHAR(128) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gateway_refresh_tokens_jti (jti),
  KEY idx_gateway_refresh_tokens_account_workspace (account_id, workspace_id),
  CONSTRAINT fk_gateway_refresh_tokens_account
    FOREIGN KEY (account_id) REFERENCES accounts (id),
  CONSTRAINT fk_gateway_refresh_tokens_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id),
  CONSTRAINT fk_gateway_refresh_tokens_gateway
    FOREIGN KEY (gateway_id) REFERENCES gateways (id),
  CONSTRAINT fk_gateway_refresh_tokens_device
    FOREIGN KEY (device_id) REFERENCES devices (id)
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  id BIGINT NOT NULL AUTO_INCREMENT,
  jti VARCHAR(128) NOT NULL,
  token_class VARCHAR(64) DEFAULT NULL,
  account_id VARCHAR(64) DEFAULT NULL,
  workspace_id VARCHAR(64) DEFAULT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  admin_user_id VARCHAR(64) DEFAULT NULL,
  device_id VARCHAR(64) DEFAULT NULL,
  gateway_id VARCHAR(64) DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  revoked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_revoked_tokens_jti (jti),
  KEY idx_revoked_tokens_account_revoked_at (account_id, revoked_at)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) DEFAULT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  admin_user_id VARCHAR(64) DEFAULT NULL,
  device_id VARCHAR(64) DEFAULT NULL,
  gateway_id VARCHAR(64) DEFAULT NULL,
  session_id VARCHAR(128) DEFAULT NULL,
  token_class VARCHAR(64) DEFAULT NULL,
  jti VARCHAR(128) DEFAULT NULL,
  event_type VARCHAR(128) NOT NULL,
  actor_type VARCHAR(64) NOT NULL,
  actor_id VARCHAR(64) DEFAULT NULL,
  payload_json JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_events_account_created_at (account_id, created_at),
  KEY idx_audit_events_account_workspace (account_id, workspace_id)
);
