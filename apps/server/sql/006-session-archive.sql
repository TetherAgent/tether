SET @p17_archived_at_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_sessions'
    AND COLUMN_NAME = 'archived_at'
);
SET @p17_archived_at_ddl = IF(
  @p17_archived_at_exists = 0,
  'ALTER TABLE gateway_sessions ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1 /* archived_at already exists */'
);
PREPARE p17_archived_at_stmt FROM @p17_archived_at_ddl;
EXECUTE p17_archived_at_stmt;
DEALLOCATE PREPARE p17_archived_at_stmt;

SET @p17_archived_idx_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_sessions'
    AND INDEX_NAME = 'idx_gateway_sessions_archive_scope'
);
SET @p17_archived_idx_ddl = IF(
  @p17_archived_idx_exists = 0,
  'ALTER TABLE gateway_sessions ADD INDEX idx_gateway_sessions_archive_scope (account_id, user_id, archived_at, last_active_at)',
  'SELECT 1 /* idx_gateway_sessions_archive_scope already exists */'
);
PREPARE p17_archived_idx_stmt FROM @p17_archived_idx_ddl;
EXECUTE p17_archived_idx_stmt;
DEALLOCATE PREPARE p17_archived_idx_stmt;
