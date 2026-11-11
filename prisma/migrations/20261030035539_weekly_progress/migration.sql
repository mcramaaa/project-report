-- D-073 weekly progress (M9). Additive: a new table, plus progress.input for the system roles FILLER and MANAGER
-- (the defaults the user chose); custom roles are not changed.

-- CreateTable
CREATE TABLE `weekly_progress` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `work_item_id` CHAR(36) NOT NULL,
    `input_mode` ENUM('VOLUME_WEEK', 'PERCENT_CUMULATIVE') NOT NULL,
    `input_percentage` DECIMAL(9, 6) NULL,
    `actual_volume` DECIMAL(30, 12) NOT NULL,
    `note` TEXT NULL,
    `entered_by` CHAR(36) NOT NULL,
    `entered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `weekly_progress_project_id_work_item_id_idx`(`project_id`, `work_item_id`),
    INDEX `weekly_progress_work_item_id_idx`(`work_item_id`),
    UNIQUE INDEX `weekly_progress_week_id_work_item_id_key`(`week_id`, `work_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `weekly_progress` ADD CONSTRAINT `weekly_progress_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_progress` ADD CONSTRAINT `weekly_progress_week_id_fkey` FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_progress` ADD CONSTRAINT `weekly_progress_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_progress` ADD CONSTRAINT `weekly_progress_entered_by_fkey` FOREIGN KEY (`entered_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weekly_progress` ADD CONSTRAINT `weekly_progress_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`, `created_at`)
SELECT r.`id`, 'progress.input', CURRENT_TIMESTAMP(3)
FROM `roles` r
WHERE r.`code` IN ('FILLER', 'MANAGER') AND r.`is_system` = true AND r.`scope` = 'PROJECT';
