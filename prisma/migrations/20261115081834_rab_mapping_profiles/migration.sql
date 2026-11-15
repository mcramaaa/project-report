-- AlterTable
ALTER TABLE `rab_imports` ADD COLUMN `mapping_profile` JSON NULL,
    ADD COLUMN `mapping_profile_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `rab_mapping_profiles` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `origin` ENUM('BAWAAN', 'MANUAL', 'AI') NOT NULL,
    `profile` JSON NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rab_mapping_profiles_project_id_created_at_idx`(`project_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rab_mapping_profiles` ADD CONSTRAINT `rab_mapping_profiles_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_mapping_profiles` ADD CONSTRAINT `rab_mapping_profiles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_mapping_profile_id_fkey` FOREIGN KEY (`mapping_profile_id`) REFERENCES `rab_mapping_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
