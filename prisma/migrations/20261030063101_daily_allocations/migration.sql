-- D-075 daily allocation (M10). Additive: weekly_progress.daily_method (default DAILY_FACTOR) and a table for manual daily volumes.

-- AlterTable
ALTER TABLE `weekly_progress` ADD COLUMN `daily_method` ENUM('DAILY_FACTOR', 'MANUAL') NOT NULL DEFAULT 'DAILY_FACTOR';

-- CreateTable
CREATE TABLE `daily_allocations` (
    `id` CHAR(36) NOT NULL,
    `weekly_progress_id` CHAR(36) NOT NULL,
    `work_date` DATE NOT NULL,
    `volume` DECIMAL(30, 12) NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_allocations_weekly_progress_id_work_date_key`(`weekly_progress_id`, `work_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_allocations` ADD CONSTRAINT `daily_allocations_weekly_progress_id_fkey` FOREIGN KEY (`weekly_progress_id`) REFERENCES `weekly_progress`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_allocations` ADD CONSTRAINT `daily_allocations_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
