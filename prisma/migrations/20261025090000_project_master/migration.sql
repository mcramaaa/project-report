-- AlterTable
ALTER TABLE `projects` ADD COLUMN `contract_value` DECIMAL(20, 2) NULL,
    ADD COLUMN `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE `weeks` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `report_period_id` CHAR(36) NOT NULL,
    `week_number` SMALLINT UNSIGNED NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `weeks_report_period_id_idx`(`report_period_id`),
    UNIQUE INDEX `weeks_project_id_week_number_key`(`project_id`, `week_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `report_periods` (
    `id` CHAR(36) NOT NULL,
    `project_id` CHAR(36) NOT NULL,
    `period_number` SMALLINT UNSIGNED NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `report_periods_project_id_period_number_key`(`project_id`, `period_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `weeks` ADD CONSTRAINT `weeks_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weeks` ADD CONSTRAINT `weeks_report_period_id_fkey` FOREIGN KEY (`report_period_id`) REFERENCES `report_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `report_periods` ADD CONSTRAINT `report_periods_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill weeks and report periods for projects created before Milestone 3 (D-037):
-- weeks are 7-day blocks from start_date, B.n = weeks 4n-3..4n, both cut at start_date + duration_days - 1.
SET SESSION cte_max_recursion_depth = 10000;

INSERT INTO `report_periods` (`id`, `project_id`, `period_number`, `start_date`, `end_date`, `created_at`, `updated_at`)
WITH RECURSIVE n (k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 2400)
SELECT UUID(), p.`id`, n.k,
       DATE_ADD(p.`start_date`, INTERVAL (n.k - 1) * 28 DAY),
       LEAST(DATE_ADD(p.`start_date`, INTERVAL n.k * 28 - 1 DAY), DATE_ADD(p.`start_date`, INTERVAL p.`duration_days` - 1 DAY)),
       CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `projects` p JOIN n ON (n.k - 1) * 28 < p.`duration_days`;

INSERT INTO `weeks` (`id`, `project_id`, `report_period_id`, `week_number`, `start_date`, `end_date`, `created_at`, `updated_at`)
WITH RECURSIVE n (k) AS (SELECT 1 UNION ALL SELECT k + 1 FROM n WHERE k < 9400)
SELECT UUID(), p.`id`, rp.`id`, n.k,
       DATE_ADD(p.`start_date`, INTERVAL (n.k - 1) * 7 DAY),
       LEAST(DATE_ADD(p.`start_date`, INTERVAL n.k * 7 - 1 DAY), DATE_ADD(p.`start_date`, INTERVAL p.`duration_days` - 1 DAY)),
       CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `projects` p
JOIN n ON (n.k - 1) * 7 < p.`duration_days`
JOIN `report_periods` rp ON rp.`project_id` = p.`id` AND rp.`period_number` = CEIL(n.k / 4);

-- New default for the MANAGER system role (D-039); other roles keep their permissions.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_code`)
SELECT `id`, 'project.update' FROM `roles` WHERE `code` = 'MANAGER' AND `is_system` = true;
