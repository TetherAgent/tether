-- Phase 14 multi-device Gateway routing (2026-05-11)
-- Add per-device gateway metadata and replace the legacy per-user unique key.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateways'
    AND COLUMN_NAME = 'device_key'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE gateways ADD COLUMN device_key VARCHAR(128) DEFAULT NULL AFTER admin_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateways'
    AND COLUMN_NAME = 'hostname'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE gateways ADD COLUMN hostname VARCHAR(255) DEFAULT NULL AFTER device_key',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateways'
    AND COLUMN_NAME = 'local_port'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE gateways ADD COLUMN local_port INT DEFAULT NULL AFTER hostname',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateways'
    AND INDEX_NAME = 'uq_gateways_account_user'
);
SET @sql := IF(
  @index_exists > 0,
  'ALTER TABLE gateways DROP INDEX uq_gateways_account_user',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gateways'
    AND INDEX_NAME = 'uq_gateways_device_key'
);
SET @sql := IF(
  @index_exists = 0,
  'ALTER TABLE gateways ADD UNIQUE KEY uq_gateways_device_key (account_id, user_id, device_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
