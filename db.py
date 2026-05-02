import sqlite3
import click
from flask import current_app, g


def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(
            current_app.config['DATABASE'],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute('PRAGMA foreign_keys = ON')
    return g.db


def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def migrate_db(db):
    cols = [r[1] for r in db.execute('PRAGMA table_info(experiment)').fetchall()]
    if 'archived' not in cols:
        db.execute('ALTER TABLE experiment ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
        db.commit()


def init_db():
    db = get_db()
    with current_app.open_resource('schema.sql') as f:
        db.executescript(f.read().decode('utf8'))
    migrate_db(db)


def seed_db():
    db = get_db()
    stages = [
        ('pretrain',  'pretrain',  10),
        ('midtrain',  'midtrain',  20),
        ('sft',       'posttrain', 30),
        ('rl',        'posttrain', 40),
        ('distill',   'posttrain', 50),
    ]
    for name, category, sort_order in stages:
        db.execute(
            'INSERT OR IGNORE INTO stage (name, category, sort_order) VALUES (?, ?, ?)',
            (name, category, sort_order),
        )
    db.commit()


@click.command('init-db')
def init_db_command():
    init_db()
    click.echo('Initialized the database.')


@click.command('seed')
def seed_command():
    seed_db()
    click.echo('Seeded stages.')


_migrated = False


def auto_migrate():
    global _migrated
    if not _migrated:
        migrate_db(get_db())
        _migrated = True


def init_app(app):
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    app.cli.add_command(seed_command)
