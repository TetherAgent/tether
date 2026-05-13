CREATE TABLE IF NOT EXISTS gateway_runtime_chats_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id  VARCHAR(128)    NOT NULL,
  event_id    BIGINT          NOT NULL,
  event_type  VARCHAR(64)     NOT NULL,
  raw_json    MEDIUMTEXT      NOT NULL,
  provider_raw_json MEDIUMTEXT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY  uk_session_event (session_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @p16_event_id_type = (
  SELECT DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_runtime_chats_events'
    AND COLUMN_NAME = 'event_id'
  LIMIT 1
);
SET @p16_event_id_ddl = IF(
  @p16_event_id_type <> 'bigint',
  'ALTER TABLE gateway_runtime_chats_events MODIFY COLUMN event_id BIGINT NOT NULL',
  'SELECT 1 /* event_id already bigint */'
);
PREPARE p16_event_id_stmt FROM @p16_event_id_ddl;
EXECUTE p16_event_id_stmt;
DEALLOCATE PREPARE p16_event_id_stmt;

SET @p16_col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_chat_messages' AND COLUMN_NAME = 'raw_json');
SET @p16_ddl = IF(@p16_col_exists = 0, 'ALTER TABLE gateway_chat_messages ADD COLUMN raw_json MEDIUMTEXT NULL', 'SELECT 1 /* raw_json already exists */');
PREPARE p16_stmt FROM @p16_ddl;
EXECUTE p16_stmt;
DEALLOCATE PREPARE p16_stmt;

SET @p16_provider_raw_col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gateway_runtime_chats_events' AND COLUMN_NAME = 'provider_raw_json');
SET @p16_provider_raw_ddl = IF(@p16_provider_raw_col_exists = 0, 'ALTER TABLE gateway_runtime_chats_events ADD COLUMN provider_raw_json MEDIUMTEXT NULL AFTER raw_json', 'SELECT 1 /* provider_raw_json already exists */');
PREPARE p16_provider_raw_stmt FROM @p16_provider_raw_ddl;
EXECUTE p16_provider_raw_stmt;
DEALLOCATE PREPARE p16_provider_raw_stmt;
