"""Seed script with sample data for development."""
import json
from app import app
from db import get_db, seed_db


def seed_sample_data():
    with app.app_context():
        seed_db()
        db = get_db()

        stage_ids = {}
        for row in db.execute('SELECT id, name FROM stage').fetchall():
            stage_ids[row['name']] = row['id']

        experiments = [
            ('llama-3-base', 'pretrain', 'completed', 'my-team', 'llm-pretrain', 'run-pt-001'),
            ('llama-3-mid-v1', 'midtrain', 'completed', 'my-team', 'llm-midtrain', 'run-mt-001'),
            ('llama-3-sft-v1', 'sft', 'completed', 'my-team', 'llm-sft', 'run-sft-001'),
            ('llama-3-sft-v2', 'sft', 'running', 'my-team', 'llm-sft', 'run-sft-002'),
            ('llama-3-rl-v1', 'rl', 'running', 'my-team', 'llm-rl', 'run-rl-001'),
            ('llama-3-distill-7b', 'distill', 'pending', 'my-team', 'llm-distill', None),
        ]

        exp_ids = {}
        for name, stage, status, entity, project, run_id in experiments:
            cur = db.execute(
                '''INSERT INTO experiment (name, stage_id, status, wandb_entity, wandb_project, wandb_run_id, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (name, stage_ids[stage], status, entity, project, run_id,
                 f'Sample {stage} experiment'),
            )
            exp_ids[name] = cur.lastrowid

        lineage = [
            ('llama-3-base', 'llama-3-mid-v1', 'init_from'),
            ('llama-3-mid-v1', 'llama-3-sft-v1', 'init_from'),
            ('llama-3-mid-v1', 'llama-3-sft-v2', 'init_from'),
            ('llama-3-sft-v1', 'llama-3-rl-v1', 'init_from'),
            ('llama-3-sft-v1', 'llama-3-distill-7b', 'distill_from'),
        ]
        for parent, child, relation in lineage:
            db.execute(
                'INSERT INTO experiment_lineage (parent_id, child_id, relation) VALUES (?, ?, ?)',
                (exp_ids[parent], exp_ids[child], relation),
            )

        eval_runs = [
            ('llama-3-sft-v1', 'mmlu', 'completed', {'accuracy': 0.847}, 'my-team', 'llm-evals', 'eval-001'),
            ('llama-3-sft-v1', 'humaneval', 'completed', {'pass@1': 0.72}, 'my-team', 'llm-evals', 'eval-002'),
            ('llama-3-sft-v1', 'gsm8k', 'completed', {'accuracy': 0.68}, 'my-team', 'llm-evals', 'eval-003'),
            ('llama-3-sft-v2', 'mmlu', 'running', None, 'my-team', 'llm-evals', 'eval-004'),
            ('llama-3-rl-v1', 'mmlu', 'pending', None, None, None, None),
        ]
        for exp_name, name, status, metrics, entity, project, run_id in eval_runs:
            db.execute(
                '''INSERT INTO eval_run (experiment_id, name, status, metrics_json, wandb_entity, wandb_project, wandb_run_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (exp_ids[exp_name], name, status,
                 json.dumps(metrics) if metrics else None,
                 entity, project, run_id),
            )

        db.commit()
        print(f'Seeded {len(experiments)} experiments, {len(lineage)} lineage edges, {len(eval_runs)} eval runs.')


if __name__ == '__main__':
    seed_sample_data()
