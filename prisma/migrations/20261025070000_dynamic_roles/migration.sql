-- Dynamic roles (D-035). Hand-written so existing memberships keep their role:
-- create roles, seed the four system project roles, map project_users.role -> role_id, then drop the enum.

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `scope` ENUM('GLOBAL', 'PROJECT') NOT NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_code` VARCHAR(80) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`role_id`, `permission_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_global_roles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(36) NULL,

    INDEX `user_global_roles_role_id_idx`(`role_id`),
    UNIQUE INDEX `user_global_roles_user_id_role_id_key`(`user_id`, `role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed system project roles (PRD §2) with the permission enforced today.
INSERT INTO `roles` (`id`, `code`, `name`, `description`, `scope`, `is_system`, `is_active`, `updated_at`) VALUES
    ('ef5d8034-f1b9-4978-b152-b177fa1dad24', 'FILLER', 'Filler', 'Input progres dan laporan harian.', 'PROJECT', true, true, CURRENT_TIMESTAMP(3)),
    ('aff635cd-a7c8-4d52-9df8-8fe4c4835a02', 'REVIEWER', 'Reviewer', 'Memeriksa dan memfinalisasi laporan (bukan input sendiri).', 'PROJECT', true, true, CURRENT_TIMESTAMP(3)),
    ('dc52c145-f176-4916-b3b3-34f61c8e9ad8', 'MANAGER', 'Manager', 'Fungsi reviewer, aktivasi baseline, reopen laporan, Addendum.', 'PROJECT', true, true, CURRENT_TIMESTAMP(3)),
    ('c01130fc-600f-4da2-9b7c-02d2ffe16598', 'ADMIN', 'Admin Proyek', 'Upload dokumen dan review ekstraksi AI.', 'PROJECT', true, true, CURRENT_TIMESTAMP(3));

INSERT INTO `role_permissions` (`role_id`, `permission_code`)
    SELECT `id`, 'project.read' FROM `roles` WHERE `is_system` = true;

-- Map existing memberships (including revoked ones) to the matching system role.
ALTER TABLE `project_users` ADD COLUMN `role_id` CHAR(36) NULL;
UPDATE `project_users` pu JOIN `roles` r ON r.`code` = pu.`role` SET pu.`role_id` = r.`id`;
ALTER TABLE `project_users` MODIFY `role_id` CHAR(36) NOT NULL, DROP COLUMN `role`;

-- CreateIndex
CREATE INDEX `project_users_role_id_idx` ON `project_users`(`role_id`);

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_users` ADD CONSTRAINT `project_users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_global_roles` ADD CONSTRAINT `user_global_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_global_roles` ADD CONSTRAINT `user_global_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_global_roles` ADD CONSTRAINT `user_global_roles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_global_roles` ADD CONSTRAINT `user_global_roles_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
