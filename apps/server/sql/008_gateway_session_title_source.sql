SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateway_sessions'
    AND COLUMN_NAME = 'title_source'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE gateway_sessions ADD COLUMN title_source VARCHAR(32) NOT NULL DEFAULT ''gateway'' AFTER title',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
