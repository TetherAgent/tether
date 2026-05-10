SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_chat_messages'
    AND COLUMN_NAME = 'source_event_id'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE gateway_chat_messages ADD COLUMN source_event_id BIGINT DEFAULT NULL AFTER session_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_chat_messages'
    AND INDEX_NAME = 'uq_chat_messages_session_event'
);
SET @sql := IF(
  @index_exists = 0,
  'ALTER TABLE gateway_chat_messages ADD UNIQUE KEY uq_chat_messages_session_event (session_id, source_event_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
