-- D-078 schedule scenarios (simulasi jadwal). Additive: two new tables; entries cascade with their scenario.

-- CreateTable
CREATE TABLE `schedule_scenarios` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `schedule_version_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `week_count` SMALLINT UNSIGNED NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `schedule_scenarios_project_id_idx`(`project_id`),
    INDEX `schedule_scenarios_schedule_version_id_idx`(`schedule_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_scenario_entries` (
    `id` CHAR(36) NOT NULL,
    `scenario_id` CHAR(36) NOT NULL,
    `group_item_id` CHAR(36) NOT NULL,
    `week_number` SMALLINT UNSIGNED NOT NULL,
    `planned_weight` DECIMAL(30, 18) NOT NULL,

    INDEX `schedule_scenario_entries_group_item_id_idx`(`group_item_id`),
    UNIQUE INDEX `schedule_scenario_entries_scenario_id_group_item_id_week_num_key`(`scenario_id`, `group_item_id`, `week_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schedule_scenarios` ADD CONSTRAINT `schedule_scenarios_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_scenarios` ADD CONSTRAINT `schedule_scenarios_schedule_version_id_fkey` FOREIGN KEY (`schedule_version_id`) REFERENCES `schedule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_scenarios` ADD CONSTRAINT `schedule_scenarios_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_scenarios` ADD CONSTRAINT `schedule_scenarios_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_scenario_entries` ADD CONSTRAINT `schedule_scenario_entries_scenario_id_fkey` FOREIGN KEY (`scenario_id`) REFERENCES `schedule_scenarios`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_scenario_entries` ADD CONSTRAINT `schedule_scenario_entries_group_item_id_fkey` FOREIGN KEY (`group_item_id`) REFERENCES `rab_version_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
