CREATE TABLE IF NOT EXISTS gateway_sessions (
  id VARCHAR(128) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  gateway_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(64) DEFAULT NULL,
  provider VARCHAR(64) NOT NULL,
  title VARCHAR(255) DEFAULT NULL,
  project_path VARCHAR(1024) DEFAULT NULL,
  agent_session_id VARCHAR(255) DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  transport VARCHAR(64) NOT NULL DEFAULT 'pty-event-stream',
  last_active_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gateway_sessions_account_workspace (account_id, workspace_id),
  KEY idx_gateway_sessions_gateway_id (gateway_id)
);

CREATE TABLE IF NOT EXISTS gateway_chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  turn_index INT NOT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  tools_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_messages_session_turn (session_id, turn_index),
  KEY idx_chat_messages_session_id (session_id)
);

CREATE TABLE IF NOT EXISTS gateway_runtime_events (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  event_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_runtime_events_session_event (session_id, event_id),
  KEY idx_runtime_events_session_id_id (session_id, id)
);

CREATE TABLE IF NOT EXISTS gateway_sync_cursors (
  id BIGINT NOT NULL AUTO_INCREMENT,
  gateway_id VARCHAR(128) NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  last_event_id BIGINT DEFAULT NULL,
  last_turn_index INT DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sync_cursors_gateway_session (gateway_id, session_id)
);
