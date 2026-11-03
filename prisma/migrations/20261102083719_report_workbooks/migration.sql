-- D-086: office Excel workbook per project and report type (exports fill it).
-- CreateTable
CREATE TABLE `report_workbooks` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `report_type` ENUM('DAILY', 'WEEKLY', 'MONTHLY') NOT NULL,
    `filename` VARCHAR(64) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `report_workbooks_project_id_report_type_key`(`project_id`, `report_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report_workbooks` ADD CONSTRAINT `report_workbooks_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_workbooks` ADD CONSTRAINT `report_workbooks_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
