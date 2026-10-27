-- D-069: RAB documents are one Kontrak plus MC-0 … MC-100; Addendum is no longer a version type.
-- MC0 (revision 0) becomes MC 0; any ADDENDUM n becomes MC n (MC0 held 0, addenda were 1, 2, …).

-- rab_versions.version_type
ALTER TABLE `rab_versions` MODIFY `version_type` ENUM('CONTRACT', 'MC0', 'ADDENDUM', 'MC') NOT NULL;
UPDATE `rab_versions` SET `version_type` = 'MC' WHERE `version_type` IN ('MC0', 'ADDENDUM');
ALTER TABLE `rab_versions` MODIFY `version_type` ENUM('CONTRACT', 'MC') NOT NULL;

-- rab_imports: target type plus the MC number the run imports.
ALTER TABLE `rab_imports` ADD COLUMN `target_revision_number` SMALLINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE `rab_imports` MODIFY `target_version_type` ENUM('CONTRACT', 'MC0', 'ADDENDUM', 'MC') NOT NULL;
-- An approved Addendum run takes the number of the version it created; other old runs stay 0.
UPDATE `rab_imports` i JOIN `rab_versions` v ON v.`id` = i.`rab_version_id`
  SET i.`target_revision_number` = v.`revision_number`
  WHERE i.`target_version_type` = 'ADDENDUM';
UPDATE `rab_imports` SET `target_version_type` = 'MC' WHERE `target_version_type` IN ('MC0', 'ADDENDUM');
ALTER TABLE `rab_imports` MODIFY `target_version_type` ENUM('CONTRACT', 'MC') NOT NULL;

-- Stored drafts are re-validated on read; keep their target type valid.
UPDATE `rab_imports`
  SET `draft` = JSON_SET(`draft`, '$.targetVersionType', 'MC', '$.targetRevisionNumber', `target_revision_number`)
  WHERE `draft` IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(`draft`, '$.targetVersionType')) IN ('MC0', 'ADDENDUM');

-- System role text, only where an admin has not edited it.
UPDATE `roles` SET `description` = 'Fungsi reviewer, aktivasi baseline, reopen laporan, MC.'
  WHERE `code` = 'MANAGER' AND `is_system` = true AND `description` = 'Fungsi reviewer, aktivasi baseline, reopen laporan, Addendum.';

-- Snapshots (rab_version_snapshots) and audit logs keep their recorded values: they are history.
