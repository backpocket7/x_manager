#!/usr/bin/env python3
"""xm — CLI for X Manager API."""
import argparse
import json
import sys
import urllib.request
import urllib.error
import os

BASE = os.environ.get('XM_BASE_URL', 'http://localhost:5001')


def _req(method, path, data=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    if body:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as resp:
            if resp.status == 204:
                return None
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err = json.loads(e.read()) if e.headers.get('content-type', '').startswith('application/json') else {}
        print(f"Error {e.code}: {err.get('error', e.reason)}", file=sys.stderr)
        sys.exit(1)


def _print(obj):
    print(json.dumps(obj, indent=2))


def _table(rows, cols):
    if not rows:
        print('(none)')
        return
    widths = {c: len(c) for c in cols}
    str_rows = []
    for r in rows:
        sr = {}
        for c in cols:
            v = r.get(c, '')
            if isinstance(v, list):
                v = ', '.join(str(x) if not isinstance(x, dict) else x.get('name', str(x)) for x in v)
            sr[c] = str(v) if v is not None else ''
            widths[c] = max(widths[c], len(sr[c]))
        str_rows.append(sr)
    header = '  '.join(c.ljust(widths[c]) for c in cols)
    print(header)
    print('  '.join('-' * widths[c] for c in cols))
    for sr in str_rows:
        print('  '.join(sr[c].ljust(widths[c]) for c in cols))


_stages_cache = None

def _resolve_stage(val):
    if val is None:
        return None
    if val.isdigit():
        return int(val)
    global _stages_cache
    if _stages_cache is None:
        _stages_cache = _req('GET', '/api/stages')
    for s in _stages_cache:
        if s['name'].lower() == val.lower():
            return s['id']
    print(f"Unknown stage: {val}", file=sys.stderr)
    sys.exit(1)


# --- Commands ---

def cmd_stages(args):
    _table(_req('GET', '/api/stages'), ['id', 'name', 'category', 'experiment_count'])


def cmd_ls(args):
    params = []
    if args.stage: params.append(f'stage_id={_resolve_stage(args.stage)}')
    if args.status: params.append(f'status={args.status}')
    if args.tag: params.append(f'tag={args.tag}')
    if args.search: params.append(f'search={args.search}')
    if args.after: params.append(f'after={args.after}')
    if args.before: params.append(f'before={args.before}')
    if args.archived: params.append('show_archived=1')
    qs = '&'.join(params)
    path = '/api/experiments' + ('?' + qs if qs else '')
    exps = _req('GET', path)
    _table(exps, ['id', 'name', 'alias', 'stage_name', 'status', 'tags', 'updated_at'])


def cmd_get(args):
    _print(_req('GET', f'/api/experiments/{args.id}'))


def cmd_create(args):
    data = {'name': args.name, 'stage_id': _resolve_stage(args.stage)}
    if args.status: data['status'] = args.status
    if args.alias: data['alias'] = args.alias
    if args.tags: data['tags'] = [t.strip() for t in args.tags.split(',')]
    if args.notes: data['notes'] = args.notes
    if args.wandb_entity: data['wandb_entity'] = args.wandb_entity
    if args.wandb_project: data['wandb_project'] = args.wandb_project
    if args.wandb_run_id: data['wandb_run_id'] = args.wandb_run_id
    _print(_req('POST', '/api/experiments', data))


def cmd_update(args):
    data = {}
    if args.name: data['name'] = args.name
    if args.stage: data['stage_id'] = _resolve_stage(args.stage)
    if args.status: data['status'] = args.status
    if args.alias is not None: data['alias'] = args.alias or None
    if args.tags is not None: data['tags'] = [t.strip() for t in args.tags.split(',')] if args.tags else []
    if args.notes is not None: data['notes'] = args.notes
    if args.wandb_entity is not None: data['wandb_entity'] = args.wandb_entity or None
    if args.wandb_project is not None: data['wandb_project'] = args.wandb_project or None
    if args.wandb_run_id is not None: data['wandb_run_id'] = args.wandb_run_id or None
    if not data:
        print('Nothing to update. Use flags like --name, --status, etc.', file=sys.stderr)
        sys.exit(1)
    _print(_req('PUT', f'/api/experiments/{args.id}', data))


def cmd_archive(args):
    _req('POST', f'/api/experiments/{args.id}/archive')
    print(f'Archived experiment {args.id}')


def cmd_unarchive(args):
    _req('POST', f'/api/experiments/{args.id}/unarchive')
    print(f'Unarchived experiment {args.id}')


def cmd_bulk_create(args):
    items = json.loads(sys.stdin.read())
    _print(_req('POST', '/api/experiments/bulk', items))


def cmd_add_parent(args):
    data = {'parent_id': args.parent_id, 'relation': args.relation}
    _print(_req('POST', f'/api/experiments/{args.id}/parents', data))


def cmd_rm_parent(args):
    _req('DELETE', f'/api/experiments/{args.id}/parents/{args.parent_id}')
    print(f'Removed parent {args.parent_id} from experiment {args.id}')


def cmd_evals(args):
    evals = _req('GET', f'/api/experiments/{args.id}/evals')
    for e in evals:
        if e.get('metrics_json'):
            e['metrics'] = e['metrics_json']
            del e['metrics_json']
    _table(evals, ['id', 'name', 'status', 'metrics', 'updated_at'])


def cmd_add_eval(args):
    data = {'name': args.name}
    if args.status: data['status'] = args.status
    if args.metrics: data['metrics'] = json.loads(args.metrics)
    if args.wandb_entity: data['wandb_entity'] = args.wandb_entity
    if args.wandb_project: data['wandb_project'] = args.wandb_project
    if args.wandb_run_id: data['wandb_run_id'] = args.wandb_run_id
    _print(_req('POST', f'/api/experiments/{args.id}/evals', data))


def cmd_update_eval(args):
    data = {}
    if args.name: data['name'] = args.name
    if args.status: data['status'] = args.status
    if args.metrics is not None: data['metrics'] = json.loads(args.metrics)
    if not data:
        print('Nothing to update.', file=sys.stderr)
        sys.exit(1)
    _print(_req('PUT', f'/api/evals/{args.id}', data))


def cmd_rm_eval(args):
    _req('DELETE', f'/api/evals/{args.id}')
    print(f'Deleted eval {args.id}')


def cmd_bulk_evals(args):
    items = json.loads(sys.stdin.read())
    _print(_req('POST', f'/api/experiments/{args.id}/evals/bulk', items))


def cmd_tags(args):
    _table(_req('GET', '/api/tags'), ['id', 'name'])


def cmd_tag(args):
    _print(_req('POST', f'/api/experiments/{args.id}/tags', {'name': args.name}))


def cmd_untag(args):
    _print(_req('DELETE', f'/api/experiments/{args.id}/tags/{args.tag_id}'))


def cmd_bulk_tag(args):
    ids = [int(x) for x in args.ids.split(',')]
    _print(_req('POST', '/api/experiments/bulk-add-tag', {'name': args.name, 'experiment_ids': ids}))


def cmd_bulk_untag(args):
    ids = [int(x) for x in args.ids.split(',')]
    _print(_req('POST', '/api/experiments/bulk-remove-tag', {'name': args.name, 'experiment_ids': ids}))


def cmd_compare(args):
    ids = [int(x) for x in args.ids.split(',')]
    result = _req('POST', '/api/compare', {'experiment_ids': ids})
    for w in result.get('warnings', []):
        print(f'Warning: {w}', file=sys.stderr)
    for u in result.get('urls', []):
        print(u['url'])


def main():
    p = argparse.ArgumentParser(prog='xm', description='X Manager CLI')
    sub = p.add_subparsers(dest='command', required=True)

    sub.add_parser('stages', help='List stages')

    ls_p = sub.add_parser('ls', help='List experiments')
    ls_p.add_argument('--stage', help='Stage name or ID (e.g. sft, 3)')
    ls_p.add_argument('--status', help='Filter by status')
    ls_p.add_argument('--tag', help='Filter by tag name')
    ls_p.add_argument('--search', '-s', help='Search by name/alias')
    ls_p.add_argument('--from', dest='after', help='Show experiments created on or after this date (YYYY-MM-DD)')
    ls_p.add_argument('--to', dest='before', help='Show experiments created on or before this date (YYYY-MM-DD)')
    ls_p.add_argument('--archived', action='store_true', help='Include archived experiments')

    get_p = sub.add_parser('get', help='Get experiment detail')
    get_p.add_argument('id', type=int)

    cr_p = sub.add_parser('create', help='Create experiment')
    cr_p.add_argument('name')
    cr_p.add_argument('--stage', required=True, help='Stage name or ID (e.g. sft, 3)')
    cr_p.add_argument('--status', default='pending')
    cr_p.add_argument('--alias')
    cr_p.add_argument('--tags', help='Comma-separated tag names')
    cr_p.add_argument('--notes')
    cr_p.add_argument('--wandb-entity')
    cr_p.add_argument('--wandb-project')
    cr_p.add_argument('--wandb-run-id')

    up_p = sub.add_parser('update', help='Update experiment')
    up_p.add_argument('id', type=int)
    up_p.add_argument('--name')
    up_p.add_argument('--stage', help='Stage name or ID')
    up_p.add_argument('--status')
    up_p.add_argument('--alias', nargs='?', const='')
    up_p.add_argument('--tags', nargs='?', const='')
    up_p.add_argument('--notes', nargs='?', const='')
    up_p.add_argument('--wandb-entity', nargs='?', const='')
    up_p.add_argument('--wandb-project', nargs='?', const='')
    up_p.add_argument('--wandb-run-id', nargs='?', const='')

    arch_p = sub.add_parser('archive', help='Archive experiment')
    arch_p.add_argument('id', type=int)

    unarch_p = sub.add_parser('unarchive', help='Unarchive experiment')
    unarch_p.add_argument('id', type=int)

    sub.add_parser('bulk-create', help='Bulk create experiments (JSON array from stdin)')

    ap_p = sub.add_parser('add-parent', help='Add parent to experiment')
    ap_p.add_argument('id', type=int, help='Child experiment ID')
    ap_p.add_argument('parent_id', type=int)
    ap_p.add_argument('--relation', default='init_from', choices=['init_from', 'distill_from'])

    rp_p = sub.add_parser('rm-parent', help='Remove parent from experiment')
    rp_p.add_argument('id', type=int, help='Child experiment ID')
    rp_p.add_argument('parent_id', type=int)

    ev_p = sub.add_parser('evals', help='List eval runs for experiment')
    ev_p.add_argument('id', type=int)

    ae_p = sub.add_parser('add-eval', help='Add eval run to experiment')
    ae_p.add_argument('id', type=int, help='Experiment ID')
    ae_p.add_argument('name', help='Eval name (e.g. mmlu)')
    ae_p.add_argument('--status', default='pending')
    ae_p.add_argument('--metrics', help='JSON string, e.g. \'{"accuracy": 0.85}\'')
    ae_p.add_argument('--wandb-entity')
    ae_p.add_argument('--wandb-project')
    ae_p.add_argument('--wandb-run-id')

    ue_p = sub.add_parser('update-eval', help='Update eval run')
    ue_p.add_argument('id', type=int, help='Eval run ID')
    ue_p.add_argument('--name')
    ue_p.add_argument('--status')
    ue_p.add_argument('--metrics', help='JSON string')

    re_p = sub.add_parser('rm-eval', help='Delete eval run')
    re_p.add_argument('id', type=int)

    be_p = sub.add_parser('bulk-evals', help='Bulk create evals (JSON array from stdin)')
    be_p.add_argument('id', type=int, help='Experiment ID')

    sub.add_parser('tags', help='List all tags')

    tg_p = sub.add_parser('tag', help='Add tag to experiment')
    tg_p.add_argument('id', type=int, help='Experiment ID')
    tg_p.add_argument('name', help='Tag name')

    ut_p = sub.add_parser('untag', help='Remove tag from experiment')
    ut_p.add_argument('id', type=int, help='Experiment ID')
    ut_p.add_argument('tag_id', type=int)

    bt_p = sub.add_parser('bulk-tag', help='Add tag to multiple experiments')
    bt_p.add_argument('name', help='Tag name')
    bt_p.add_argument('--ids', required=True, help='Comma-separated experiment IDs')

    bu_p = sub.add_parser('bulk-untag', help='Remove tag from multiple experiments')
    bu_p.add_argument('name', help='Tag name')
    bu_p.add_argument('--ids', required=True, help='Comma-separated experiment IDs')

    cmp_p = sub.add_parser('compare', help='Generate wandb compare URLs')
    cmp_p.add_argument('--ids', required=True, help='Comma-separated experiment IDs')

    args = p.parse_args()
    cmds = {
        'stages': cmd_stages, 'ls': cmd_ls, 'get': cmd_get,
        'create': cmd_create, 'update': cmd_update,
        'archive': cmd_archive, 'unarchive': cmd_unarchive,
        'bulk-create': cmd_bulk_create,
        'add-parent': cmd_add_parent, 'rm-parent': cmd_rm_parent,
        'evals': cmd_evals, 'add-eval': cmd_add_eval,
        'update-eval': cmd_update_eval, 'rm-eval': cmd_rm_eval,
        'bulk-evals': cmd_bulk_evals,
        'tags': cmd_tags, 'tag': cmd_tag, 'untag': cmd_untag,
        'bulk-tag': cmd_bulk_tag, 'bulk-untag': cmd_bulk_untag,
        'compare': cmd_compare,
    }
    cmds[args.command](args)


if __name__ == '__main__':
    main()
