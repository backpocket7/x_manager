import json
import os
from flask import Flask, request, jsonify, render_template
from db import get_db, init_db, seed_db, init_app, auto_migrate


app = Flask(__name__)
app.config['DATABASE'] = os.path.join(app.instance_path, '..', 'x_manager.db')
init_app(app)


def get_experiment_tags(db, exp_id):
    rows = db.execute(
        '''SELECT t.id, t.name FROM tag t
           JOIN experiment_tag et ON et.tag_id = t.id
           WHERE et.experiment_id = ? ORDER BY t.name''',
        (exp_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def enrich_with_tags(db, experiments):
    if not experiments:
        return experiments
    ids = [e['id'] for e in experiments]
    ph = ','.join('?' * len(ids))
    rows = db.execute(
        f'''SELECT et.experiment_id, t.id, t.name FROM experiment_tag et
            JOIN tag t ON t.id = et.tag_id
            WHERE et.experiment_id IN ({ph}) ORDER BY t.name''',
        ids,
    ).fetchall()
    tag_map = {}
    for r in rows:
        tag_map.setdefault(r['experiment_id'], []).append({'id': r['id'], 'name': r['name']})
    for e in experiments:
        e['tags'] = tag_map.get(e['id'], [])
    return experiments


@app.before_request
def _run_migrations():
    auto_migrate()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/tree/<int:exp_id>')
def tree_page(exp_id):
    return render_template('tree.html', exp_id=exp_id)


@app.route('/api/experiments/<int:exp_id>/tree')
def get_tree(exp_id):
    db = get_db()
    rows = db.execute(
        '''WITH RECURSIVE ancestors(id, depth) AS (
               SELECT ?, 0
               UNION ALL
               SELECT el.parent_id, a.depth + 1
               FROM experiment_lineage el
               JOIN ancestors a ON a.id = el.child_id
           )
           SELECT e.*, s.name as stage_name, s.category as stage_category, a.depth,
                  el.parent_id, el.relation
           FROM ancestors a
           JOIN experiment e ON e.id = a.id
           JOIN stage s ON e.stage_id = s.id
           LEFT JOIN experiment_lineage el ON el.child_id = e.id
               AND el.parent_id IN (SELECT id FROM ancestors)
           ORDER BY a.depth DESC, e.name''',
        (exp_id,),
    ).fetchall()
    experiments = [dict(r) for r in rows]
    enrich_with_tags(db, experiments)
    return jsonify(experiments)


# --- Stages ---

@app.route('/api/stages')
def list_stages():
    db = get_db()
    rows = db.execute(
        '''SELECT s.*, COUNT(e.id) as experiment_count
           FROM stage s LEFT JOIN experiment e ON e.stage_id = s.id
           GROUP BY s.id ORDER BY s.sort_order'''
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# --- Tags ---

@app.route('/api/tags')
def list_tags():
    db = get_db()
    rows = db.execute('SELECT * FROM tag ORDER BY name').fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/tags', methods=['POST'])
def create_tag():
    data = request.json
    name = (data or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    db = get_db()
    try:
        cur = db.execute('INSERT INTO tag (name) VALUES (?)', (name,))
        db.commit()
    except db.IntegrityError:
        row = db.execute('SELECT * FROM tag WHERE name = ?', (name,)).fetchone()
        return jsonify(dict(row))
    row = db.execute('SELECT * FROM tag WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/tags/<int:tag_id>', methods=['DELETE'])
def delete_tag(tag_id):
    db = get_db()
    db.execute('DELETE FROM tag WHERE id = ?', (tag_id,))
    db.commit()
    return '', 204


# --- Experiments ---

@app.route('/api/experiments')
def list_experiments():
    db = get_db()
    clauses, params = [], []

    stage_id = request.args.get('stage_id')
    if stage_id:
        clauses.append('e.stage_id = ?')
        params.append(int(stage_id))

    status = request.args.get('status')
    if status:
        clauses.append('e.status = ?')
        params.append(status)

    search = request.args.get('search')
    if search:
        clauses.append('(e.name LIKE ? OR e.alias LIKE ?)')
        params.extend([f'%{search}%', f'%{search}%'])

    tag = request.args.get('tag')
    if tag:
        clauses.append('e.id IN (SELECT et.experiment_id FROM experiment_tag et JOIN tag t ON t.id = et.tag_id WHERE t.name = ?)')
        params.append(tag)

    after = request.args.get('after')
    if after:
        clauses.append('e.created_at >= ?')
        params.append(after)

    before = request.args.get('before')
    if before:
        clauses.append('e.created_at <= ?')
        params.append(before)

    show_archived = request.args.get('show_archived')
    if not show_archived:
        clauses.append('e.archived = 0')

    where = ('WHERE ' + ' AND '.join(clauses)) if clauses else ''
    rows = db.execute(
        f'''SELECT e.*, s.name as stage_name, s.category as stage_category
            FROM experiment e JOIN stage s ON e.stage_id = s.id
            {where} ORDER BY e.updated_at DESC''',
        params,
    ).fetchall()
    experiments = [dict(r) for r in rows]
    enrich_with_tags(db, experiments)

    if experiments:
        ids = [e['id'] for e in experiments]
        ph = ','.join('?' * len(ids))
        parent_rows = db.execute(
            f'''SELECT el.child_id, e.id, e.name, e.alias, el.relation
                FROM experiment_lineage el
                JOIN experiment e ON e.id = el.parent_id
                WHERE el.child_id IN ({ph})''',
            ids,
        ).fetchall()
        parent_map = {}
        for r in parent_rows:
            parent_map.setdefault(r['child_id'], []).append({
                'id': r['id'], 'name': r['name'], 'alias': r['alias'], 'relation': r['relation'],
            })
        for e in experiments:
            e['parents'] = parent_map.get(e['id'], [])

    return jsonify(experiments)


@app.route('/api/experiments', methods=['POST'])
def create_experiment():
    data = request.json
    if not data or not data.get('name') or not data.get('stage_id'):
        return jsonify({'error': 'name and stage_id are required'}), 400

    alias = data.get('alias', '').strip() or None
    db = get_db()
    try:
        cur = db.execute(
            '''INSERT INTO experiment (name, alias, stage_id, status, wandb_project, wandb_run_id, wandb_entity, config_json, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                data['name'], alias, data['stage_id'],
                data.get('status', 'pending'),
                data.get('wandb_project'), data.get('wandb_run_id'), data.get('wandb_entity'),
                json.dumps(data['config']) if data.get('config') else None,
                data.get('notes', ''),
            ),
        )
    except db.IntegrityError:
        return jsonify({'error': f'alias "{alias}" is already in use'}), 400
    db.commit()

    exp_id = cur.lastrowid
    _sync_tags(db, exp_id, data.get('tags', []))

    exp = db.execute('SELECT * FROM experiment WHERE id = ?', (exp_id,)).fetchone()
    result = dict(exp)
    result['tags'] = get_experiment_tags(db, exp_id)
    return jsonify(result), 201


@app.route('/api/experiments/bulk', methods=['POST'])
def bulk_create_experiments():
    items = request.json
    if not isinstance(items, list):
        return jsonify({'error': 'expected a JSON array'}), 400

    db = get_db()
    created = []
    for data in items:
        if not data.get('name') or not data.get('stage_id'):
            continue
        alias = data.get('alias', '').strip() or None
        try:
            cur = db.execute(
                '''INSERT INTO experiment (name, alias, stage_id, status, wandb_project, wandb_run_id, wandb_entity, config_json, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    data['name'], alias, data['stage_id'],
                    data.get('status', 'pending'),
                    data.get('wandb_project'), data.get('wandb_run_id'), data.get('wandb_entity'),
                    json.dumps(data['config']) if data.get('config') else None,
                    data.get('notes', ''),
                ),
            )
            created.append(cur.lastrowid)
            _sync_tags(db, cur.lastrowid, data.get('tags', []))
        except db.IntegrityError:
            continue
    db.commit()

    rows = db.execute(
        f'SELECT * FROM experiment WHERE id IN ({",".join("?" * len(created))})', created
    ).fetchall()
    experiments = [dict(r) for r in rows]
    enrich_with_tags(db, experiments)
    return jsonify(experiments), 201


@app.route('/api/experiments/<int:exp_id>')
def get_experiment(exp_id):
    db = get_db()
    exp = db.execute(
        '''SELECT e.*, s.name as stage_name, s.category as stage_category
           FROM experiment e JOIN stage s ON e.stage_id = s.id
           WHERE e.id = ?''',
        (exp_id,),
    ).fetchone()
    if not exp:
        return jsonify({'error': 'not found'}), 404

    result = dict(exp)
    result['tags'] = get_experiment_tags(db, exp_id)

    parents = db.execute(
        '''SELECT e.*, s.name as stage_name, el.relation
           FROM experiment_lineage el
           JOIN experiment e ON e.id = el.parent_id
           JOIN stage s ON e.stage_id = s.id
           WHERE el.child_id = ?''',
        (exp_id,),
    ).fetchall()
    result['parents'] = [dict(r) for r in parents]

    children = db.execute(
        '''SELECT e.*, s.name as stage_name, el.relation
           FROM experiment_lineage el
           JOIN experiment e ON e.id = el.child_id
           JOIN stage s ON e.stage_id = s.id
           WHERE el.parent_id = ?''',
        (exp_id,),
    ).fetchall()
    result['children'] = [dict(r) for r in children]

    evals = db.execute(
        'SELECT * FROM eval_run WHERE experiment_id = ? ORDER BY created_at DESC',
        (exp_id,),
    ).fetchall()
    result['eval_runs'] = [dict(r) for r in evals]

    return jsonify(result)


@app.route('/api/experiments/<int:exp_id>', methods=['PUT'])
def update_experiment(exp_id):
    data = request.json
    db = get_db()

    exp = db.execute('SELECT * FROM experiment WHERE id = ?', (exp_id,)).fetchone()
    if not exp:
        return jsonify({'error': 'not found'}), 404

    fields = {}
    for key in ('name', 'stage_id', 'status', 'wandb_project', 'wandb_run_id', 'wandb_entity', 'notes'):
        if key in data:
            fields[key] = data[key]
    if 'alias' in data:
        fields['alias'] = data['alias'].strip() if data['alias'] else None
    if 'config' in data:
        fields['config_json'] = json.dumps(data['config'])

    if fields:
        set_clause = ', '.join(f'{k} = ?' for k in fields)
        params = list(fields.values()) + [exp_id]
        try:
            db.execute(
                f"UPDATE experiment SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
                params,
            )
        except db.IntegrityError:
            return jsonify({'error': f'alias "{fields.get("alias")}" is already in use'}), 400
        db.commit()

    if 'tags' in data:
        _sync_tags(db, exp_id, data['tags'])

    updated = db.execute('SELECT * FROM experiment WHERE id = ?', (exp_id,)).fetchone()
    result = dict(updated)
    result['tags'] = get_experiment_tags(db, exp_id)
    return jsonify(result)


@app.route('/api/experiments/<int:exp_id>/archive', methods=['POST'])
def archive_experiment(exp_id):
    db = get_db()
    db.execute("UPDATE experiment SET archived = 1, updated_at = datetime('now') WHERE id = ?", (exp_id,))
    db.commit()
    return jsonify({'id': exp_id, 'archived': True})


@app.route('/api/experiments/<int:exp_id>/unarchive', methods=['POST'])
def unarchive_experiment(exp_id):
    db = get_db()
    db.execute("UPDATE experiment SET archived = 0, updated_at = datetime('now') WHERE id = ?", (exp_id,))
    db.commit()
    return jsonify({'id': exp_id, 'archived': False})


# --- Experiment tags ---

@app.route('/api/experiments/<int:exp_id>/tags', methods=['POST'])
def add_experiment_tag(exp_id):
    data = request.json
    name = (data or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': 'tag name is required'}), 400

    db = get_db()
    tag = db.execute('SELECT * FROM tag WHERE name = ?', (name,)).fetchone()
    if not tag:
        cur = db.execute('INSERT INTO tag (name) VALUES (?)', (name,))
        db.commit()
        tag_id = cur.lastrowid
    else:
        tag_id = tag['id']

    try:
        db.execute('INSERT INTO experiment_tag (experiment_id, tag_id) VALUES (?, ?)', (exp_id, tag_id))
        db.commit()
    except db.IntegrityError:
        pass

    return jsonify(get_experiment_tags(db, exp_id))


@app.route('/api/experiments/<int:exp_id>/tags/<int:tag_id>', methods=['DELETE'])
def remove_experiment_tag(exp_id, tag_id):
    db = get_db()
    db.execute('DELETE FROM experiment_tag WHERE experiment_id = ? AND tag_id = ?', (exp_id, tag_id))
    db.commit()
    return jsonify(get_experiment_tags(db, exp_id))


def _sync_tags(db, exp_id, tag_names):
    """Sync tags from a list of tag name strings. Creates tags that don't exist."""
    if not tag_names:
        return
    for name in tag_names:
        name = name.strip()
        if not name:
            continue
        tag = db.execute('SELECT id FROM tag WHERE name = ?', (name,)).fetchone()
        if not tag:
            cur = db.execute('INSERT INTO tag (name) VALUES (?)', (name,))
            tag_id = cur.lastrowid
        else:
            tag_id = tag['id']
        try:
            db.execute('INSERT INTO experiment_tag (experiment_id, tag_id) VALUES (?, ?)', (exp_id, tag_id))
        except db.IntegrityError:
            pass
    db.commit()


# --- Bulk tag operations ---

@app.route('/api/experiments/bulk-add-tag', methods=['POST'])
def bulk_add_tag():
    data = request.json
    name = (data or {}).get('name', '').strip()
    ids = (data or {}).get('experiment_ids', [])
    if not name or not ids:
        return jsonify({'error': 'name and experiment_ids are required'}), 400

    db = get_db()
    tag = db.execute('SELECT * FROM tag WHERE name = ?', (name,)).fetchone()
    if not tag:
        cur = db.execute('INSERT INTO tag (name) VALUES (?)', (name,))
        db.commit()
        tag_id = cur.lastrowid
    else:
        tag_id = tag['id']

    for eid in ids:
        try:
            db.execute('INSERT INTO experiment_tag (experiment_id, tag_id) VALUES (?, ?)', (eid, tag_id))
        except db.IntegrityError:
            pass
    db.commit()
    return jsonify({'tagged': len(ids)})


@app.route('/api/experiments/bulk-remove-tag', methods=['POST'])
def bulk_remove_tag():
    data = request.json
    name = (data or {}).get('name', '').strip()
    ids = (data or {}).get('experiment_ids', [])
    if not name or not ids:
        return jsonify({'error': 'name and experiment_ids are required'}), 400

    db = get_db()
    tag = db.execute('SELECT * FROM tag WHERE name = ?', (name,)).fetchone()
    if not tag:
        return jsonify({'removed': 0})

    ph = ','.join('?' * len(ids))
    db.execute(
        f'DELETE FROM experiment_tag WHERE tag_id = ? AND experiment_id IN ({ph})',
        [tag['id']] + list(ids),
    )
    db.commit()
    return jsonify({'removed': db.total_changes})


# --- Lineage ---

@app.route('/api/experiments/<int:exp_id>/parents', methods=['POST'])
def add_parent(exp_id):
    data = request.json
    parent_id = data.get('parent_id')
    relation = data.get('relation', 'init_from')
    if not parent_id:
        return jsonify({'error': 'parent_id is required'}), 400

    db = get_db()
    try:
        db.execute(
            'INSERT INTO experiment_lineage (parent_id, child_id, relation) VALUES (?, ?, ?)',
            (parent_id, exp_id, relation),
        )
        db.commit()
    except db.IntegrityError:
        return jsonify({'error': 'relationship already exists or invalid ids'}), 400

    return jsonify({'parent_id': parent_id, 'child_id': exp_id, 'relation': relation}), 201


@app.route('/api/experiments/<int:exp_id>/parents/<int:parent_id>', methods=['DELETE'])
def remove_parent(exp_id, parent_id):
    db = get_db()
    db.execute(
        'DELETE FROM experiment_lineage WHERE parent_id = ? AND child_id = ?',
        (parent_id, exp_id),
    )
    db.commit()
    return '', 204


# --- Eval runs ---

@app.route('/api/experiments/<int:exp_id>/evals')
def list_evals(exp_id):
    db = get_db()
    rows = db.execute(
        'SELECT * FROM eval_run WHERE experiment_id = ? ORDER BY created_at DESC',
        (exp_id,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/experiments/<int:exp_id>/evals', methods=['POST'])
def create_eval(exp_id):
    data = request.json
    if not data or not data.get('name'):
        return jsonify({'error': 'name is required'}), 400

    db = get_db()
    cur = db.execute(
        '''INSERT INTO eval_run (experiment_id, name, status, wandb_project, wandb_run_id, wandb_entity, metrics_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)''',
        (
            exp_id, data['name'],
            data.get('status', 'pending'),
            data.get('wandb_project'), data.get('wandb_run_id'), data.get('wandb_entity'),
            json.dumps(data['metrics']) if data.get('metrics') else None,
        ),
    )
    db.commit()
    row = db.execute('SELECT * FROM eval_run WHERE id = ?', (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/experiments/<int:exp_id>/evals/bulk', methods=['POST'])
def bulk_create_evals(exp_id):
    items = request.json
    if not isinstance(items, list):
        return jsonify({'error': 'expected a JSON array'}), 400

    db = get_db()
    created = []
    for data in items:
        if not data.get('name'):
            continue
        cur = db.execute(
            '''INSERT INTO eval_run (experiment_id, name, status, wandb_project, wandb_run_id, wandb_entity, metrics_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)''',
            (
                exp_id, data['name'],
                data.get('status', 'pending'),
                data.get('wandb_project'), data.get('wandb_run_id'), data.get('wandb_entity'),
                json.dumps(data['metrics']) if data.get('metrics') else None,
            ),
        )
        created.append(cur.lastrowid)
    db.commit()

    rows = db.execute(
        f'SELECT * FROM eval_run WHERE id IN ({",".join("?" * len(created))})', created
    ).fetchall()
    return jsonify([dict(r) for r in rows]), 201


@app.route('/api/evals/<int:eval_id>', methods=['PUT'])
def update_eval(eval_id):
    data = request.json
    db = get_db()

    row = db.execute('SELECT * FROM eval_run WHERE id = ?', (eval_id,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404

    fields = {}
    for key in ('name', 'status', 'wandb_project', 'wandb_run_id', 'wandb_entity'):
        if key in data:
            fields[key] = data[key]
    if 'metrics' in data:
        fields['metrics_json'] = json.dumps(data['metrics'])

    if fields:
        set_clause = ', '.join(f'{k} = ?' for k in fields)
        params = list(fields.values()) + [eval_id]
        db.execute(
            f"UPDATE eval_run SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            params,
        )
        db.commit()

    updated = db.execute('SELECT * FROM eval_run WHERE id = ?', (eval_id,)).fetchone()
    return jsonify(dict(updated))


@app.route('/api/evals/<int:eval_id>', methods=['DELETE'])
def delete_eval(eval_id):
    db = get_db()
    db.execute('DELETE FROM eval_run WHERE id = ?', (eval_id,))
    db.commit()
    return '', 204


# --- Compare ---

@app.route('/api/compare', methods=['POST'])
def compare_experiments():
    data = request.json
    ids = data.get('experiment_ids', [])
    if len(ids) < 2:
        return jsonify({'error': 'select at least 2 experiments'}), 400

    db = get_db()
    rows = db.execute(
        f'SELECT * FROM experiment WHERE id IN ({",".join("?" * len(ids))})', ids
    ).fetchall()

    experiments = [dict(r) for r in rows]
    valid = [e for e in experiments if e.get('wandb_run_id') and e.get('wandb_entity') and e.get('wandb_project')]
    if not valid:
        return jsonify({'error': 'none of the selected experiments have wandb info'}), 400

    warnings = []
    skipped = [e for e in experiments if e not in valid]
    if skipped:
        warnings.append(f'{len(skipped)} experiment(s) skipped (missing wandb info)')

    by_project = {}
    for e in valid:
        key = (e['wandb_entity'], e['wandb_project'])
        by_project.setdefault(key, []).append(e['wandb_run_id'])

    urls = []
    for (entity, project), run_ids in by_project.items():
        url = f"https://wandb.ai/{entity}/{project}/workspace?runs={','.join(run_ids)}"
        urls.append({'entity': entity, 'project': project, 'url': url})

    if len(urls) > 1:
        warnings.append('experiments span multiple wandb projects — generated separate URLs')

    return jsonify({'urls': urls, 'warnings': warnings})
