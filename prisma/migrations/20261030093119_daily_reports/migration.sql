-- D-079 daily reports (M11). Additive: four new tables, plus report.reopen for the system role MANAGER
-- (the default chosen with D-079); custom roles are not changed.

-- CreateTable
CREATE TABLE `daily_reports` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `report_date` DATE NOT NULL,
    `status` ENUM('DRAFT', 'FINAL', 'REOPENED') NOT NULL DEFAULT 'DRAFT',
    `note` TEXT NULL,
    `created_by` CHAR(36) NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `finalized_by` CHAR(36) NULL,
    `finalized_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `daily_reports_week_id_idx`(`week_id`),
    UNIQUE INDEX `daily_reports_project_id_report_date_key`(`project_id`, `report_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_report_resources` (
    `id` CHAR(36) NOT NULL,
    `daily_report_id` CHAR(36) NOT NULL,
    `category` ENUM('LABOR', 'MATERIAL', 'EQUIPMENT') NOT NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL,
    `source_key` VARCHAR(1100) NULL,
    `name` VARCHAR(500) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `calculated_quantity` DECIMAL(30, 12) NULL,
    `actual_quantity` DECIMAL(30, 12) NULL,
    `note` VARCHAR(1000) NULL,

    INDEX `daily_report_resources_daily_report_id_category_sort_order_idx`(`daily_report_id`, `category`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_report_weather` (
    `id` CHAR(36) NOT NULL,
    `daily_report_id` CHAR(36) NOT NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL,
    `condition` ENUM('CLEAR', 'CLOUDY', 'DRIZZLE', 'RAIN', 'OTHER') NOT NULL,
    `from_time` CHAR(5) NULL,
    `to_time` CHAR(5) NULL,
    `note` VARCHAR(500) NULL,

    INDEX `daily_report_weather_daily_report_id_idx`(`daily_report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_report_work` (
    `id` CHAR(36) NOT NULL,
    `daily_report_id` CHAR(36) NOT NULL,
    `work_item_id` CHAR(36) NOT NULL,
    `volume` DECIMAL(30, 12) NOT NULL,

    UNIQUE INDEX `daily_report_work_daily_report_id_work_item_id_key`(`daily_report_id`, `work_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_week_id_fkey` FOREIGN KEY (`week_id`) REFERENCES `weeks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_reports` ADD CONSTRAINT `daily_reports_finalized_by_fkey` FOREIGN KEY (`finalized_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_report_resources` ADD CONSTRAINT `daily_report_resources_daily_report_id_fkey` FOREIGN KEY (`daily_report_id`) REFERENCES `daily_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_report_weather` ADD CONSTRAINT `daily_report_weather_daily_report_id_fkey` FOREIGN KEY (`daily_report_id`) REFERENCES `daily_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_report_work` ADD CONSTRAINT `daily_report_work_daily_report_id_fkey` FOREIGN KEY (`daily_report_id`) REFERENCES `daily_reports`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_report_work` ADD CONSTRAINT `daily_report_work_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`, `created_at`)
SELECT r.`id`, 'report.reopen', CURRENT_TIMESTAMP(3)
FROM `roles` r
WHERE r.`code` = 'MANAGER' AND r.`is_system` = true AND r.`scope` = 'PROJECT';
