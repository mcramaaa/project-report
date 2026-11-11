-- D-072 time schedule (M8). Additive: two new tables, plus schedule.edit and schedule.approve for the system
-- roles MANAGER and RAB_EDITOR (the defaults the user chose); custom roles are not changed.

-- CreateTable
CREATE TABLE `schedule_versions` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `rab_version_id` CHAR(36) NOT NULL,
    `status` ENUM('DRAFT', 'APPROVED', 'REOPENED') NOT NULL DEFAULT 'DRAFT',
    `source_document_id` CHAR(36) NULL,
    `created_by` CHAR(36) NOT NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `schedule_versions_rab_version_id_key`(`rab_version_id`),
    INDEX `schedule_versions_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_entries` (
    `id` CHAR(36) NOT NULL,
    `schedule_version_id` CHAR(36) NOT NULL,
    `group_item_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `planned_weight` DECIMAL(30, 18) NOT NULL,

    INDEX `schedule_entries_group_item_id_idx`(`group_item_id`),
    INDEX `schedule_entries_week_id_idx`(`week_id`),
    UNIQUE INDEX `schedule_entries_schedule_version_id_group_item_id_week_id_key`(`schedule_version_id`, `group_item_id`, `week_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_source_document_id_fkey` FOREIGN KEY (`source_document_id`) REFERENCES `project_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_versions` ADD CONSTRAINT `schedule_versions_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_entries` ADD CONSTRAINT `schedule_entries_schedule_version_id_fkey` FOREIGN KEY (`schedule_version_id`) REFERENCES `schedule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_entries` ADD CONSTRAINT `schedule_entries_group_item_id_fkey` FOREIGN KEY (`group_item_id`) REFERENCES `rab_version_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_entries` ADD CONSTRAINT `schedule_entries_week_id_fkey` FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`, `created_at`)
SELECT r.`id`, p.`code`, CURRENT_TIMESTAMP(3)
FROM `roles` r
CROSS JOIN (SELECT 'schedule.edit' AS `code` UNION ALL SELECT 'schedule.approve') p
WHERE r.`code` IN ('MANAGER', 'RAB_EDITOR') AND r.`is_system` = true AND r.`scope` = 'PROJECT';
