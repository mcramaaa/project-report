-- D-081 weekly reports (M12). Additive: projects.signatories, two new tables, plus report.review for the system
-- roles REVIEWER and MANAGER and report.finalize for MANAGER (defaults chosen with D-081); custom roles are not changed.

-- AlterTable
ALTER TABLE `projects` ADD COLUMN `signatories` JSON NULL;

-- CreateTable
CREATE TABLE `weekly_reports` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'REVIEWED', 'FINAL', 'REOPENED') NOT NULL DEFAULT 'DRAFT',
    `submitted_by` CHAR(36) NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_note` TEXT NULL,
    `finalized_by` CHAR(36) NULL,
    `finalized_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `weekly_reports_week_id_key`(`week_id`),
    INDEX `weekly_reports_project_id_status_idx`(`project_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weekly_report_snapshots` (
    `id` CHAR(36) NOT NULL,
    `weekly_report_id` CHAR(36) NOT NULL,
    `payload` JSON NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `weekly_report_snapshots_weekly_report_id_created_at_idx`(`weekly_report_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `weekly_reports` ADD CONSTRAINT `weekly_reports_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_reports` ADD CONSTRAINT `weekly_reports_week_id_fkey` FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_reports` ADD CONSTRAINT `weekly_reports_submitted_by_fkey` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_reports` ADD CONSTRAINT `weekly_reports_reviewed_by_fkey` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_reports` ADD CONSTRAINT `weekly_reports_finalized_by_fkey` FOREIGN KEY (`finalized_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_report_snapshots` ADD CONSTRAINT `weekly_report_snapshots_weekly_report_id_fkey` FOREIGN KEY (`weekly_report_id`) REFERENCES `weekly_reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_report_snapshots` ADD CONSTRAINT `weekly_report_snapshots_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Default permissions of the system roles (D-081 butir 2).
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`, `created_at`)
SELECT r.`id`, 'report.review', CURRENT_TIMESTAMP(3)
FROM `roles` r
WHERE r.`code` IN ('REVIEWER', 'MANAGER') AND r.`is_system` = true AND r.`scope` = 'PROJECT';

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`, `created_at`)
SELECT r.`id`, 'report.finalize', CURRENT_TIMESTAMP(3)
FROM `roles` r
WHERE r.`code` = 'MANAGER' AND r.`is_system` = true AND r.`scope` = 'PROJECT';
