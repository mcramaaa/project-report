-- D-090: reviewer-corrected column mapping of a RAB sheet read by header words.
-- AlterTable
ALTER TABLE `rab_import_documents` ADD COLUMN `column_map` JSON NULL;
