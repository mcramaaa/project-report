-- D-068 reopen/correction of approved RAB versions. Additive only: no existing row, role or membership changes.
-- AlterTable
ALTER TABLE `rab_versions` MODIFY `status` ENUM('DRAFT', 'APPROVED', 'DISCARDED', 'REOPENED') NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE `rab_version_snapshots` (
    `id` CHAR(36) NOT NULL,
    `rab_version_id` CHAR(36) NOT NULL,
    `sequence` SMALLINT UNSIGNED NOT NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `total_value` DECIMAL(50, 18) NULL,
    `payload` JSON NOT NULL,
    `checksum` CHAR(64) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rab_version_snapshots_rab_version_id_sequence_key`(`rab_version_id`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rab_version_snapshots` ADD CONSTRAINT `rab_version_snapshots_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_snapshots` ADD CONSTRAINT `rab_version_snapshots_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_snapshots` ADD CONSTRAINT `rab_version_snapshots_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- New system project role RAB_EDITOR (Editor RAB). Skipped when the code is already taken; existing
-- roles do not get the new permissions rab.reopen / ahsp.edit (super admin holds every permission).
INSERT IGNORE INTO `roles` (`id`, `code`, `name`, `description`, `scope`, `is_system`, `is_active`, `updated_at`) VALUES
    ('6f2d1c3e-8b7a-4e5f-9a1b-2c3d4e5f6a7b', 'RAB_EDITOR', 'Editor RAB', 'Mengelola draft, membuka kembali dan mengoreksi RAB serta sumber analisa, lalu approve (D-068).', 'PROJECT', true, true, CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT r.`id`, p.`code`
FROM `roles` r
JOIN (
  SELECT 'project.read' AS code
  UNION ALL SELECT 'rab.read'
  UNION ALL SELECT 'rab.edit'
  UNION ALL SELECT 'rab.approve'
  UNION ALL SELECT 'rab.reopen'
  UNION ALL SELECT 'ahsp.read'
  UNION ALL SELECT 'ahsp.edit'
  UNION ALL SELECT 'document.read'
) p
WHERE r.`id` = '6f2d1c3e-8b7a-4e5f-9a1b-2c3d4e5f6a7b' AND r.`code` = 'RAB_EDITOR' AND r.`is_system` = true;
