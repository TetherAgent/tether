CREATE TABLE IF NOT EXISTS gateway_chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(128) NOT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  usage_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chat_messages_session_id (session_id)
);
