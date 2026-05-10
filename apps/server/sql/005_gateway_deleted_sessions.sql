CREATE TABLE IF NOT EXISTS gateway_deleted_sessions (
  session_id VARCHAR(128) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  gateway_id VARCHAR(128) DEFAULT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, account_id, workspace_id, user_id),
  KEY idx_gateway_deleted_sessions_gateway (gateway_id)
);
