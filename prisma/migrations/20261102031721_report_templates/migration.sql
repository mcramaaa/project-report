-- D-082 report templates and project logos (M14). projects.signatories (D-081, never released) moves into the templates.
/*
  Warnings:

  - You are about to drop the column `signatories` on the `projects` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `projects` DROP COLUMN `signatories`;

-- CreateTable
CREATE TABLE `report_templates` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `report_type` ENUM('DAILY', 'WEEKLY', 'MONTHLY') NOT NULL,
    `config` JSON NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `report_templates_project_id_report_type_key`(`project_id`, `report_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_logos` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `kind` ENUM('AGENCY', 'CONSULTANT', 'CONTRACTOR') NOT NULL,
    `filename` VARCHAR(64) NOT NULL,
    `mime_type` VARCHAR(100) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `project_logos_project_id_kind_key`(`project_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `report_templates` ADD CONSTRAINT `report_templates_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_templates` ADD CONSTRAINT `report_templates_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_logos` ADD CONSTRAINT `project_logos_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_logos` ADD CONSTRAINT `project_logos_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
