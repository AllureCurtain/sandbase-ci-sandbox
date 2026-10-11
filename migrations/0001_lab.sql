-- SandBase Lab owns its scene data. Model calls are billed by apiserver to the
-- signed-in user's organization; Lab stores only public results and the cost
-- read back from apiserver. It never stores user JWTs, API keys or balances.

CREATE TABLE IF NOT EXISTS lab_runs (
  id           TEXT PRIMARY KEY,
  scene        TEXT NOT NULL,                 -- pelican-test
  user_id      TEXT NOT NULL,                 -- apiserver user id (from /default/v1/me), for limits only
  author_name  TEXT NOT NULL,                 -- public tester name (English)
  subject      TEXT NOT NULL,
  title        TEXT NOT NULL,
  models_json  TEXT NOT NULL,                 -- ["openai/gpt-5.5", ...]
  kinds_json   TEXT NOT NULL,                 -- ["static","animated"]
  judge_model  TEXT NOT NULL,
  status       TEXT NOT NULL,                 -- running | succeeded | failed
  hidden       INTEGER NOT NULL DEFAULT 0,    -- moderation
  total_cost   REAL NOT NULL DEFAULT 0,       -- USD, sum of results
  error        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_lab_runs_scene_created ON lab_runs(scene, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_runs_user_created ON lab_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_runs_status ON lab_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS lab_results (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES lab_runs(id),
  scene               TEXT NOT NULL,
  model               TEXT NOT NULL,
  kind                TEXT NOT NULL,          -- static | animated
  position            INTEGER NOT NULL,       -- display order inside the run
  status              TEXT NOT NULL,          -- pending | drawing | rendering | judging | done | failed
  task_id             TEXT,                   -- apiserver task id of the drawing call
  judge_task_id       TEXT,
  png_key             TEXT,                   -- R2 keys, served under /lab/media/
  svg_key             TEXT,
  score               REAL,
  scores_json         TEXT,
  comment             TEXT,
  motion              REAL,                   -- animated only: 0 = no animation code, 1 = animates
  cost                REAL,                   -- USD actually billed for drawing + judging
  latency_ms          INTEGER,
  completion_tokens   INTEGER,
  error               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_results_run ON lab_results(run_id, position);
CREATE INDEX IF NOT EXISTS idx_lab_results_scene_model ON lab_results(scene, model);
