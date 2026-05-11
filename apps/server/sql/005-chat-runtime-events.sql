CREATE TABLE IF NOT EXISTS gateway_runtime_chats_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(128)    NOT NULL,
  event_id    INT             NOT NULL,
  event_type  VARCHAR(64)     NOT NULL,
  raw_json    MEDIUMTEXT      NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY  uk_session_event (session_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @p16_col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_chat_messages' AND COLUMN_NAME = 'raw_json');
SET @p16_ddl = IF(@p16_col_exists = 0, 'ALTER TABLE gateway_chat_messages ADD COLUMN raw_json MEDIUMTEXT NULL', 'SELECT 1 /* raw_json already exists */');
PREPARE p16_stmt FROM @p16_ddl;
EXECUTE p16_stmt;
DEALLOCATE PREPARE p16_stmt;
