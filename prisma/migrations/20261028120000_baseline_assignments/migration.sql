-- D-071 baseline assignments (M6). Additive: a new table, plus baseline.activate for the system roles MANAGER and
-- RAB_EDITOR (the defaults the user chose); custom roles are not changed.

-- CreateTable
CREATE TABLE `baseline_assignments` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `rab_version_id` CHAR(36) NOT NULL,
    `effective_from` DATE NOT NULL,
    `activation_mode` ENUM('NEXT_WEEK', 'EXACT_DATE') NOT NULL,
    `reason` TEXT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(36) NULL,
    `revoke_reason` TEXT NULL,

    INDEX `baseline_assignments_project_id_effective_from_idx`(`project_id`, `effective_from`),
    INDEX `baseline_assignments_rab_version_id_idx`(`rab_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `baseline_assignments` ADD CONSTRAINT `baseline_assignments_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `baseline_assignments` ADD CONSTRAINT `baseline_assignments_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `baseline_assignments` ADD CONSTRAINT `baseline_assignments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `baseline_assignments` ADD CONSTRAINT `baseline_assignments_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`, `created_at`)
SELECT r.`id`, 'baseline.activate', CURRENT_TIMESTAMP(3)
FROM `roles` r
WHERE r.`code` IN ('MANAGER', 'RAB_EDITOR') AND r.`is_system` = true AND r.`scope` = 'PROJECT';
