-- CreateTable
CREATE TABLE `rab_profile_ai_runs` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `instruction_version` VARCHAR(40) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `attempt` SMALLINT UNSIGNED NOT NULL,
    `status` ENUM('SUCCEEDED', 'FAILED') NOT NULL,
    `error` TEXT NULL,
    `request` JSON NOT NULL,
    `response` JSON NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NOT NULL,

    INDEX `rab_profile_ai_runs_project_id_started_at_idx`(`project_id`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rab_profile_ai_runs` ADD CONSTRAINT `rab_profile_ai_runs_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_profile_ai_runs` ADD CONSTRAINT `rab_profile_ai_runs_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
