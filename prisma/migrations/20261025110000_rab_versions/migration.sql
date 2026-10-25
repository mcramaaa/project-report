-- CreateTable
CREATE TABLE `rab_versions` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `version_type` ENUM('CONTRACT', 'MC0', 'ADDENDUM') NOT NULL,
    `revision_number` SMALLINT UNSIGNED NOT NULL,
    `document_number` VARCHAR(100) NULL,
    `document_date` DATE NULL,
    `previous_version_id` CHAR(36) NULL,
    `status` ENUM('DRAFT', 'APPROVED', 'DISCARDED') NOT NULL DEFAULT 'DRAFT',
    `total_before_tax` DECIMAL(20, 2) NULL,
    `total_tax` DECIMAL(20, 2) NULL,
    `total_value` DECIMAL(20, 2) NULL,
    `created_by` CHAR(36) NOT NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `discarded_by` CHAR(36) NULL,
    `discarded_at` DATETIME(3) NULL,
    `discard_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rab_versions_project_id_status_idx`(`project_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `work_items` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `internal_code` VARCHAR(20) NOT NULL,
    `canonical_description` VARCHAR(1000) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `work_items_project_id_internal_code_key`(`project_id`, `internal_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rab_version_items` (
    `id` CHAR(36) NOT NULL,
    `rab_version_id` CHAR(36) NOT NULL,
    `work_item_id` CHAR(36) NULL,
    `parent_item_id` CHAR(36) NULL,
    `sort_order` INTEGER UNSIGNED NOT NULL,
    `row_type` ENUM('SECTION', 'SUBSECTION', 'PARENT_ITEM', 'ITEM') NOT NULL,
    `display_number` VARCHAR(30) NULL,
    `description` VARCHAR(1000) NOT NULL,
    `volume` DECIMAL(18, 4) NULL,
    `unit` VARCHAR(30) NULL,
    `analysis_code` VARCHAR(50) NULL,
    `unit_price` DECIMAL(20, 2) NULL,
    `tax_percent` DECIMAL(5, 2) NULL,
    `unit_price_with_tax` DECIMAL(20, 2) NULL,
    `subtotal` DECIMAL(20, 2) NULL,
    `weight` DECIMAL(12, 6) NULL,
    `previous_version_item_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `rab_version_items_rab_version_id_parent_item_id_sort_order_idx`(`rab_version_id`, `parent_item_id`, `sort_order`),
    UNIQUE INDEX `rab_version_items_rab_version_id_work_item_id_key`(`rab_version_id`, `work_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rab_versions` ADD CONSTRAINT `rab_versions_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_versions` ADD CONSTRAINT `rab_versions_previous_version_id_fkey` FOREIGN KEY (`previous_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_versions` ADD CONSTRAINT `rab_versions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_versions` ADD CONSTRAINT `rab_versions_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_versions` ADD CONSTRAINT `rab_versions_discarded_by_fkey` FOREIGN KEY (`discarded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `work_items` ADD CONSTRAINT `work_items_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_items` ADD CONSTRAINT `rab_version_items_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_items` ADD CONSTRAINT `rab_version_items_work_item_id_fkey` FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_items` ADD CONSTRAINT `rab_version_items_parent_item_id_fkey` FOREIGN KEY (`parent_item_id`) REFERENCES `rab_version_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_items` ADD CONSTRAINT `rab_version_items_previous_version_item_id_fkey` FOREIGN KEY (`previous_version_item_id`) REFERENCES `rab_version_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Default RAB permissions for the system project roles (D-041); custom roles are left as they are.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT r.`id`, p.`code`
FROM `roles` r
JOIN (
  SELECT 'FILLER' AS role_code, 'rab.read' AS code
  UNION ALL SELECT 'REVIEWER', 'rab.read'
  UNION ALL SELECT 'ADMIN', 'rab.read'
  UNION ALL SELECT 'ADMIN', 'rab.edit'
  UNION ALL SELECT 'MANAGER', 'rab.read'
  UNION ALL SELECT 'MANAGER', 'rab.edit'
  UNION ALL SELECT 'MANAGER', 'rab.approve'
) p ON p.role_code = r.`code`
WHERE r.`is_system` = true;
