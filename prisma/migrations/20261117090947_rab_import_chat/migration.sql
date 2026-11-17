-- CreateTable
CREATE TABLE `rab_mapping_profile_defaults` (
    `project_id` CHAR(36) NOT NULL,
    `profile_id` CHAR(36) NOT NULL,
    `set_by` CHAR(36) NOT NULL,
    `set_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`project_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rab_import_chat_messages` (
    `id` CHAR(36) NOT NULL,
    `import_id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `role` ENUM('USER', 'ASSISTANT') NOT NULL,
    `content` TEXT NOT NULL,
    `proposals` JSON NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rab_import_chat_messages_import_id_created_at_idx`(`import_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rab_mapping_profile_defaults` ADD CONSTRAINT `rab_mapping_profile_defaults_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_mapping_profile_defaults` ADD CONSTRAINT `rab_mapping_profile_defaults_profile_id_fkey` FOREIGN KEY (`profile_id`) REFERENCES `rab_mapping_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_mapping_profile_defaults` ADD CONSTRAINT `rab_mapping_profile_defaults_set_by_fkey` FOREIGN KEY (`set_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_chat_messages` ADD CONSTRAINT `rab_import_chat_messages_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `rab_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_chat_messages` ADD CONSTRAINT `rab_import_chat_messages_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_chat_messages` ADD CONSTRAINT `rab_import_chat_messages_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
