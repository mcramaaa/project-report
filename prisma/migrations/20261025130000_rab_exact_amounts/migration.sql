-- D-043: exact amounts like the office workbook. Widening is lossless; weight is derived from subtotals and no longer stored.
-- AlterTable
ALTER TABLE `rab_version_items` DROP COLUMN `weight`,
    MODIFY `volume` DECIMAL(30, 12) NULL,
    MODIFY `unit_price_with_tax` DECIMAL(26, 6) NULL,
    MODIFY `subtotal` DECIMAL(48, 18) NULL;

-- AlterTable
ALTER TABLE `rab_versions` MODIFY `total_before_tax` DECIMAL(50, 18) NULL,
    MODIFY `total_tax` DECIMAL(50, 18) NULL,
    MODIFY `total_value` DECIMAL(50, 18) NULL;

