-- D-048..D-053: documents, RAB import runs, AI runs, price lists, AHSP, RAB item <-> analysis link. Additive only.
-- AlterTable
ALTER TABLE `rab_version_items` ADD COLUMN `analysis_unit_price` DECIMAL(40, 12) NULL,
    ADD COLUMN `analysis_version_id` CHAR(36) NULL,
    ADD COLUMN `price_decided_at` DATETIME(3) NULL,
    ADD COLUMN `price_decided_by` CHAR(36) NULL,
    ADD COLUMN `price_note` TEXT NULL,
    ADD COLUMN `price_source` ENUM('MANUAL', 'ANALYSIS', 'SOURCE_OVERRIDE', 'DIRECT') NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `source_locator` JSON NULL,
    ADD COLUMN `source_unit_price` DECIMAL(40, 12) NULL;

-- CreateTable
CREATE TABLE `project_documents` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `stored_filename` VARCHAR(80) NOT NULL,
    `mime_type` VARCHAR(120) NOT NULL,
    `file_size` INTEGER UNSIGNED NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploaded_by` CHAR(36) NOT NULL,
    `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `project_documents_stored_filename_key`(`stored_filename`),
    INDEX `project_documents_project_id_idx`(`project_id`),
    INDEX `project_documents_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rab_imports` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `target_version_type` ENUM('CONTRACT', 'MC0', 'ADDENDUM') NOT NULL,
    `status` ENUM('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'UPLOADED',
    `attempt_number` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `previous_import_id` CHAR(36) NULL,
    `guide_version` VARCHAR(40) NOT NULL,
    `parser_version` VARCHAR(40) NOT NULL,
    `draft` JSON NULL,
    `error_message` TEXT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `processed_at` DATETIME(3) NULL,
    `approved_by` CHAR(36) NULL,
    `approved_at` DATETIME(3) NULL,
    `rejected_by` CHAR(36) NULL,
    `rejected_at` DATETIME(3) NULL,
    `reject_reason` TEXT NULL,
    `rab_version_id` CHAR(36) NULL,
    `price_list_id` CHAR(36) NULL,

    UNIQUE INDEX `rab_imports_price_list_id_key`(`price_list_id`),
    INDEX `rab_imports_project_id_status_idx`(`project_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rab_import_documents` (
    `import_id` CHAR(36) NOT NULL,
    `document_id` CHAR(36) NOT NULL,

    INDEX `rab_import_documents_document_id_idx`(`document_id`),
    PRIMARY KEY (`import_id`, `document_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rab_import_decisions` (
    `id` CHAR(36) NOT NULL,
    `import_id` CHAR(36) NOT NULL,
    `row_key` VARCHAR(100) NOT NULL,
    `kind` ENUM('ANALYSIS_LINK', 'PRICE_CHOICE', 'DIRECT_PRICE', 'WORK_ITEM_MATCH') NOT NULL,
    `value` JSON NOT NULL,
    `reason` TEXT NULL,
    `decided_by` CHAR(36) NOT NULL,
    `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rab_import_decisions_import_id_row_key_kind_idx`(`import_id`, `row_key`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_runs` (
    `id` CHAR(36) NOT NULL,
    `import_id` CHAR(36) NOT NULL,
    `purpose` VARCHAR(60) NOT NULL,
    `instruction_version` VARCHAR(40) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `attempt` SMALLINT UNSIGNED NOT NULL,
    `status` ENUM('SUCCEEDED', 'FAILED') NOT NULL,
    `error` TEXT NULL,
    `response` JSON NULL,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NOT NULL,

    INDEX `ai_runs_import_id_idx`(`import_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `price_lists` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `version_number` SMALLINT UNSIGNED NOT NULL,
    `location` VARCHAR(255) NULL,
    `period` VARCHAR(100) NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `price_lists_project_id_version_number_key`(`project_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `price_items` (
    `id` CHAR(36) NOT NULL,
    `price_list_id` CHAR(36) NOT NULL,
    `name` VARCHAR(500) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `price` DECIMAL(40, 12) NOT NULL,
    `source_locator` JSON NOT NULL,

    INDEX `price_items_price_list_id_idx`(`price_list_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ahsp_analyses` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `code` VARCHAR(50) NULL,
    `name` VARCHAR(1000) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ahsp_analyses_project_id_code_idx`(`project_id`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ahsp_analysis_versions` (
    `id` CHAR(36) NOT NULL,
    `analysis_id` CHAR(36) NOT NULL,
    `version_number` SMALLINT UNSIGNED NOT NULL,
    `price_list_id` CHAR(36) NOT NULL,
    `source_import_id` CHAR(36) NOT NULL,
    `code` VARCHAR(50) NULL,
    `name` VARCHAR(1000) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `discipline` VARCHAR(60) NULL,
    `overhead_percent` DECIMAL(9, 4) NULL,
    `rounding_scale` TINYINT NULL,
    `direct_cost` DECIMAL(50, 24) NOT NULL,
    `overhead_amount` DECIMAL(50, 24) NOT NULL,
    `price_exact` DECIMAL(50, 24) NOT NULL,
    `price` DECIMAL(40, 12) NOT NULL,
    `source_locator` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ahsp_analysis_versions_analysis_id_version_number_key`(`analysis_id`, `version_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ahsp_components` (
    `id` CHAR(36) NOT NULL,
    `analysis_version_id` CHAR(36) NOT NULL,
    `sort_order` SMALLINT UNSIGNED NOT NULL,
    `category` ENUM('LABOR', 'MATERIAL', 'EQUIPMENT') NOT NULL,
    `description` VARCHAR(1000) NOT NULL,
    `unit` VARCHAR(30) NULL,
    `coefficient` DECIMAL(30, 12) NOT NULL,
    `price_item_id` CHAR(36) NULL,
    `sub_analysis_version_id` CHAR(36) NULL,
    `sub_price_basis` ENUM('EXACT', 'ROUNDED') NULL,
    `unit_price` DECIMAL(40, 12) NOT NULL,
    `amount` DECIMAL(65, 24) NOT NULL,
    `source_locator` JSON NOT NULL,

    INDEX `ahsp_components_analysis_version_id_sort_order_idx`(`analysis_version_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `rab_version_items_analysis_version_id_idx` ON `rab_version_items`(`analysis_version_id`);

-- AddForeignKey
ALTER TABLE `rab_version_items` ADD CONSTRAINT `rab_version_items_analysis_version_id_fkey` FOREIGN KEY (`analysis_version_id`) REFERENCES `ahsp_analysis_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_version_items` ADD CONSTRAINT `rab_version_items_price_decided_by_fkey` FOREIGN KEY (`price_decided_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_documents` ADD CONSTRAINT `project_documents_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_previous_import_id_fkey` FOREIGN KEY (`previous_import_id`) REFERENCES `rab_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_approved_by_fkey` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_rejected_by_fkey` FOREIGN KEY (`rejected_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_rab_version_id_fkey` FOREIGN KEY (`rab_version_id`) REFERENCES `rab_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_imports` ADD CONSTRAINT `rab_imports_price_list_id_fkey` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_documents` ADD CONSTRAINT `rab_import_documents_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `rab_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_documents` ADD CONSTRAINT `rab_import_documents_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `project_documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_decisions` ADD CONSTRAINT `rab_import_decisions_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `rab_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rab_import_decisions` ADD CONSTRAINT `rab_import_decisions_decided_by_fkey` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_import_id_fkey` FOREIGN KEY (`import_id`) REFERENCES `rab_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_lists` ADD CONSTRAINT `price_lists_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_lists` ADD CONSTRAINT `price_lists_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `price_items` ADD CONSTRAINT `price_items_price_list_id_fkey` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_analyses` ADD CONSTRAINT `ahsp_analyses_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_analysis_versions` ADD CONSTRAINT `ahsp_analysis_versions_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `ahsp_analyses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_analysis_versions` ADD CONSTRAINT `ahsp_analysis_versions_price_list_id_fkey` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_analysis_versions` ADD CONSTRAINT `ahsp_analysis_versions_source_import_id_fkey` FOREIGN KEY (`source_import_id`) REFERENCES `rab_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_components` ADD CONSTRAINT `ahsp_components_analysis_version_id_fkey` FOREIGN KEY (`analysis_version_id`) REFERENCES `ahsp_analysis_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_components` ADD CONSTRAINT `ahsp_components_price_item_id_fkey` FOREIGN KEY (`price_item_id`) REFERENCES `price_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ahsp_components` ADD CONSTRAINT `ahsp_components_sub_analysis_version_id_fkey` FOREIGN KEY (`sub_analysis_version_id`) REFERENCES `ahsp_analysis_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Default permissions for the system project roles (D-049); custom roles are left as they are.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT r.`id`, p.`code`
FROM `roles` r
JOIN (
  SELECT 'FILLER' AS role_code, 'ahsp.read' AS code
  UNION ALL SELECT 'REVIEWER', 'ahsp.read'
  UNION ALL SELECT 'ADMIN', 'ahsp.read'
  UNION ALL SELECT 'ADMIN', 'document.read'
  UNION ALL SELECT 'ADMIN', 'document.upload'
  UNION ALL SELECT 'ADMIN', 'rabImport.review'
  UNION ALL SELECT 'MANAGER', 'ahsp.read'
  UNION ALL SELECT 'MANAGER', 'document.read'
  UNION ALL SELECT 'MANAGER', 'document.upload'
  UNION ALL SELECT 'MANAGER', 'rabImport.review'
  UNION ALL SELECT 'MANAGER', 'rabImport.approve'
) p ON p.role_code = r.`code`
WHERE r.`is_system` = true;
