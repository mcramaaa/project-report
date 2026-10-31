-- D-080: company-wide worker database (name, position, unique NIK, optional private KTP file).
-- CreateTable
CREATE TABLE `workers` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `position` VARCHAR(150) NOT NULL,
    `nik` CHAR(16) NOT NULL,
    `ktp_filename` VARCHAR(64) NULL,
    `ktp_mime_type` VARCHAR(100) NULL,
    `ktp_file_size` INTEGER NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` CHAR(36) NOT NULL,
    `updated_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `workers_nik_key`(`nik`),
    INDEX `workers_is_active_name_idx`(`is_active`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `workers` ADD CONSTRAINT `workers_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workers` ADD CONSTRAINT `workers_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
