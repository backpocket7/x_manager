CREATE TABLE IF NOT EXISTS stage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    category    TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS experiment (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    alias           TEXT,
    stage_id        INTEGER NOT NULL REFERENCES stage(id),
    status          TEXT NOT NULL DEFAULT 'pending',
    wandb_project   TEXT,
    wandb_run_id    TEXT,
    wandb_entity    TEXT,
    config_json     TEXT,
    notes           TEXT NOT NULL DEFAULT '',
    archived        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiment_lineage (
    parent_id   INTEGER NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    child_id    INTEGER NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    relation    TEXT NOT NULL DEFAULT 'init_from',
    PRIMARY KEY (parent_id, child_id),
    CHECK (parent_id != child_id)
);

CREATE TABLE IF NOT EXISTS eval_run (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id   INTEGER NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    wandb_project   TEXT,
    wandb_run_id    TEXT,
    wandb_entity    TEXT,
    metrics_json    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tag (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS experiment_tag (
    experiment_id INTEGER NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
    PRIMARY KEY (experiment_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_experiment_stage ON experiment(stage_id);
CREATE INDEX IF NOT EXISTS idx_experiment_status ON experiment(status);
CREATE INDEX IF NOT EXISTS idx_eval_run_experiment ON eval_run(experiment_id);
CREATE INDEX IF NOT EXISTS idx_lineage_parent ON experiment_lineage(parent_id);
CREATE INDEX IF NOT EXISTS idx_lineage_child ON experiment_lineage(child_id);
CREATE INDEX IF NOT EXISTS idx_experiment_tag_exp ON experiment_tag(experiment_id);
CREATE INDEX IF NOT EXISTS idx_experiment_tag_tag ON experiment_tag(tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_experiment_alias ON experiment(alias) WHERE alias IS NOT NULL;
