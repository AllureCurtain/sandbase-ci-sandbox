-- HTML game artifacts for code scenes (endless-runner). Additive only:
-- existing rows and code keep working with html_key NULL.
ALTER TABLE lab_results ADD COLUMN html_key TEXT;
