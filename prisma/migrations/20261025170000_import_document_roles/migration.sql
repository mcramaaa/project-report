-- D-055 document roles per import, rab sheet choice, upload-time sheet inventory. Additive only.
-- AlterTable
ALTER TABLE `project_documents` ADD COLUMN `sheet_inventory` JSON NULL;

-- AlterTable
ALTER TABLE `rab_import_documents` ADD COLUMN `rab_sheet` VARCHAR(120) NULL,
    ADD COLUMN `role` ENUM('RAB', 'SUPPORT') NOT NULL DEFAULT 'RAB',
    ADD COLUMN `sort_order` SMALLINT UNSIGNED NOT NULL DEFAULT 0;

