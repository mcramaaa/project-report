-- Preserve import history while allowing unused runs to be removed from the active list.
ALTER TABLE `rab_imports` ADD COLUMN `deleted_at` DATETIME(3) NULL;
