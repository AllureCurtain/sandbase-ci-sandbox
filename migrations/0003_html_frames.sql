-- Browser-rendered html scenes (watermelon-test) and the per-call cost split.
-- Additive only: existing rows and code keep working with these columns NULL.
--  - frames_json: JSON array of R2 keys of the probe's screenshots, in order
--  - checks_json: JSON object of the probe's automated checks
--  - draw_cost / judge_cost: the two parts of `cost` (USD) when known
ALTER TABLE lab_results ADD COLUMN frames_json TEXT;
ALTER TABLE lab_results ADD COLUMN checks_json TEXT;
ALTER TABLE lab_results ADD COLUMN draw_cost REAL;
ALTER TABLE lab_results ADD COLUMN judge_cost REAL;
