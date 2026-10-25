-- D-056/D-057: analysis/price packages are owned by a RAB version. Non-destructive: owners are backfilled
-- from the approved import that created each package; approved cross-package links are left as history.

-- AlterTable (nullable first, NOT NULL after the backfill)
ALTER TABLE `ahsp_analyses` ADD COLUMN `rab_version_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `ahsp_analysis_versions` ADD COLUMN `copied_from_id` CHAR(36) NULL,
    MODIFY `source_import_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `price_items` ADD COLUMN `copied_from_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `price_lists` ADD COLUMN `rab_version_id` CHAR(36) NULL;

-- Backfill: every price list and analysis version so far came from exactly one approved import.
UPDATE `price_lists` pl
  JOIN `rab_imports` i ON i.`price_list_id` = pl.`id`
  SET pl.`rab_version_id` = i.`rab_version_id`;

UPDATE `ahsp_analyses` a
  JOIN (
    SELECT v.`analysis_id`, MIN(i.`rab_version_id`) AS `rab_version_id`
    FROM `ahsp_analysis_versions` v
    JOIN `rab_imports` i ON i.`id` = v.`source_import_id`
    GROUP BY v.`analysis_id`
  ) src ON src.`analysis_id` = a.`id`
  SET a.`rab_version_id` = src.`rab_version_id`;

-- Fails (strict mode) if any package could not be assigned an owner, so nothing is left ambiguous.
ALTER TABLE `ahsp_analyses` MODIFY `rab_version_id` CHAR(36) NOT NULL;
ALTER TABLE `price_lists` MODIFY `rab_version_id` CHAR(36) NOT NULL;

-- CreateIndex
CREATE INDEX `ahsp_analyses_rab_version_id_code_idx` ON `ahsp_analyses`(`rab_version_id`, `code`);

-- CreateIndex
CREATE UNIQUE INDEX `price_lists_rab_version_id_key` ON `price_lists`(`rab_version_id`);

-- AddForeignKey
ALTER TABLE `price_lists` ADD CONSTRAINT `price_lists_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_items` ADD CONSTRAINT `price_items_copied_from_id_fkey` FOREIGN KEY (`copied_from_id`) REFERENCES `price_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_analyses` ADD CONSTRAINT `ahsp_analyses_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_analysis_versions` ADD CONSTRAINT `ahsp_analysis_versions_copied_from_id_fkey` FOREIGN KEY (`copied_from_id`) REFERENCES `ahsp_analysis_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
