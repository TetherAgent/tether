CREATE TABLE IF NOT EXISTS gateway_chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  source_event_id BIGINT DEFAULT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  usage_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_messages_session_event (session_id, source_event_id),
  KEY idx_chat_messages_session_id (session_id)
);
