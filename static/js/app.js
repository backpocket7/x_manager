// ====== Shared state ======
let stages = [];
let allTags = [];
const panes = [];

const ALL_COLUMNS = [
    { key: 'check',   label: '',        fixed: true },
    { key: 'expand',  label: '',        fixed: true },
    { key: 'name',    label: 'Name' },
    { key: 'alias',   label: 'Alias' },
    { key: 'actions', label: '',        fixed: true },
    { key: 'stage',   label: 'Stage' },
    { key: 'status',  label: 'Status' },
    { key: 'tags',    label: 'Tags' },
    { key: 'parent',  label: 'Parent' },
    { key: 'started', label: 'Start time' },
    { key: 'updated', label: 'Updated' },
];

const visibleColumns = new Set(ALL_COLUMNS.map(c => c.key));
const ACRONYMS = new Set(['sft', 'rl']);
const SORTABLE = new Set(['name', 'alias', 'stage', 'status', 'started', 'updated']);
const ONGOING_STATUSES = new Set(['pending', 'running']);

// ====== Utilities ======

function capitalize(str) {
    if (!str) return '';
    if (ACRONYMS.has(str.toLowerCase())) return str.toUpperCase();
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function sortValue(exp, key) {
    switch (key) {
        case 'name':    return (exp.name || '').toLowerCase();
        case 'alias':   return (exp.alias || exp.name || '').toLowerCase();
        case 'stage':   return (exp.stage_name || '').toLowerCase();
        case 'status':  return (exp.status || '').toLowerCase();
        case 'started': return exp.created_at || '';
        case 'updated': return exp.updated_at || '';
        default:        return '';
    }
}

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatPST(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'Z');
    const pst = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const mon = String(pst.getMonth() + 1).padStart(2, '0');
    const day = String(pst.getDate()).padStart(2, '0');
    const h = String(pst.getHours()).padStart(2, '0');
    const m = String(pst.getMinutes()).padStart(2, '0');
    return `${pst.getFullYear()}-${mon}-${day} ${h}:${m} ${DAYS[pst.getDay()]}`;
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'Z');
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ====== Shared column prefs ======

function loadColumnPrefs() {
    const saved = localStorage.getItem('xm-columns');
    if (!saved) return;
    const visible = new Set(JSON.parse(saved));
    const toggleable = ALL_COLUMNS.filter(c => !c.fixed && c.label);
    for (const col of toggleable) {
        if (visible.has(col.key)) visibleColumns.add(col.key);
        else visibleColumns.delete(col.key);
    }
}

function saveColumnPrefs() {
    const toggleable = ALL_COLUMNS.filter(c => !c.fixed && c.label);
    const visible = toggleable.filter(c => visibleColumns.has(c.key)).map(c => c.key);
    localStorage.setItem('xm-columns', JSON.stringify(visible));
}

function colVisible(key) { return visibleColumns.has(key); }
function visColCount() { return ALL_COLUMNS.filter(c => colVisible(c.key)).length; }

function refreshAllPanes() { for (const p of panes) p.loadExperiments(); }

// ====== Render helpers ======

function renderParentLinksCompact(parents) {
    if (!parents || parents.length === 0) return '<span class="text-muted">—</span>';
    return parents.map(p =>
        `<a class="parent-link" onclick="scrollToExperiment(${p.id})">${esc(p.name)}</a>`
    ).join(', ');
}

function renderParentLinks(parents) {
    if (!parents || parents.length === 0) return '<span class="text-muted">—</span>';
    return parents.map(p => {
        const alias = p.alias ? ' <span class="text-muted">(' + esc(p.alias) + ')</span>' : '';
        return `<a class="parent-link" onclick="scrollToExperiment(${p.id})">${esc(p.name)}</a>${alias}` +
            ` <span class="parent-relation">(${p.relation})</span> ` +
            `<button class="remove-parent-btn" data-parent-id="${p.id}" title="Remove">&times;</button>`;
    }).join(' ');
}

function renderTags(tags) {
    if (!tags || tags.length === 0) return '<span class="text-muted" style="font-size:10px">No tags</span>';
    return tags.map(t =>
        `<span class="badge badge-tag">${esc(t.name)} <button class="remove-tag-btn" data-tag-id="${t.id}" title="Remove">&times;</button></span>`
    ).join(' ');
}

function renderWandbLink(exp) {
    if (exp.wandb_entity && exp.wandb_project && exp.wandb_run_id) {
        return `<div style="margin-top:8px"><a href="https://wandb.ai/${exp.wandb_entity}/${exp.wandb_project}/runs/${exp.wandb_run_id}" target="_blank" class="parent-link">wandb ↗</a></div>`;
    }
    return '';
}

function renderEvalTable(evals) {
    if (!evals || evals.length === 0) return '<div class="text-muted" style="font-size:10px;margin-bottom:6px">No eval runs.</div>';
    let html = '<table class="eval-table"><thead><tr><th>Name</th><th>Status</th><th>Metrics</th><th>wandb</th><th></th></tr></thead><tbody>';
    for (const ev of evals) {
        const metrics = ev.metrics_json ? JSON.parse(ev.metrics_json) : {};
        const metricsStr = Object.entries(metrics).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
        let wandbCell = '—';
        if (ev.wandb_entity && ev.wandb_project && ev.wandb_run_id) {
            wandbCell = `<a href="https://wandb.ai/${ev.wandb_entity}/${ev.wandb_project}/runs/${ev.wandb_run_id}" target="_blank">↗</a>`;
        }
        html += `<tr>
            <td>${esc(ev.name)}</td>
            <td><span class="badge badge-${ev.status}">${capitalize(ev.status)}</span></td>
            <td>${esc(metricsStr)}</td>
            <td>${wandbCell}</td>
            <td><button class="btn btn-sm btn-danger delete-eval-btn" data-eval-id="${ev.id}">&times;</button></td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}

function stageOptions(selectedId) {
    return stages.map(s =>
        `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${capitalize(s.name)}</option>`
    ).join('');
}

function statusOptions(selected) {
    return ['pending','running','stopped','completed','failed','cancelled'].map(s =>
        `<option value="${s}" ${s === selected ? 'selected' : ''}>${capitalize(s)}</option>`
    ).join('');
}

// ====== Pane class ======

class Pane {
    constructor(container, isPrimary) {
        this.container = container;
        this.isPrimary = isPrimary;
        this.filters = { stage: '', status: '', tag: '', search: '', after: '', before: '', show_archived: false };
        this.checkedIds = new Set();
        this.expandedId = null;
        this.sortKey = '';
        this.sortDir = 'asc';
        this.displayedCount = 0;
        this.merged = false;
        this.buildDOM();
        this.buildColumnPicker();
        this.bindEvents();
    }

    $(sel) { return this.el.querySelector(sel); }

    buildDOM() {
        this.el = document.createElement('div');
        this.el.className = 'pane';
        this.el.innerHTML = `
            <div class="pane-search">
                <input type="text" class="pane-search-input" placeholder="Search experiments…">
            </div>
            <div class="toolbar">
                <div class="toolbar-row">
                    <div class="filter-group">
                        <span class="filter-label">From</span>
                        <input type="date" class="date-input filter-after">
                    </div>
                    <div class="filter-group">
                        <span class="filter-label">To</span>
                        <input type="date" class="date-input filter-before">
                    </div>
                    <div class="filter-group col-picker-wrap">
                        <span class="filter-label">Columns</span>
                        <button class="filter-select col-picker-btn">All ▾</button>
                        <div class="col-picker-dropdown" style="display:none"></div>
                    </div>
                    <div class="active-filters"></div>
                    <label class="archived-toggle"><input type="checkbox" class="show-archived-toggle"> Show archived</label>
                    <label class="archived-toggle"><input type="checkbox" class="detailed-view-toggle"> Detailed view</label>
                    <label class="archived-toggle"><input type="checkbox" class="merge-toggle"> Merge tables</label>
                </div>
                <div class="toolbar-row">
                    <div class="toolbar-actions">
                        <button class="btn btn-sm btn-primary compare-btn" disabled>Compare (0)</button>
                        <button class="btn btn-sm btn-primary bulk-tag-btn" disabled>Tags (0)</button>
                        <button class="btn btn-sm btn-primary new-experiment-btn">+ New</button>
                    </div>
                </div>
                <div class="toolbar-row">
                    <span class="status-counts"></span>
                </div>
            </div>
            <div class="tables-area">
                <div class="table-section section-ongoing">
                    <div class="section-header">Ongoing</div>
                    <div class="table-wrap">
                        <table><thead></thead><tbody></tbody></table>
                        <div class="empty-state" style="display:none">No ongoing experiments.</div>
                    </div>
                </div>
                <div class="table-section section-finished">
                    <div class="section-header">Finished</div>
                    <div class="table-wrap">
                        <table><thead></thead><tbody></tbody></table>
                        <div class="empty-state" style="display:none">No finished experiments.</div>
                    </div>
                </div>
                <div class="table-section section-merged" style="display:none">
                    <div class="table-wrap">
                        <table><thead></thead><tbody></tbody></table>
                        <div class="empty-state" style="display:none">No experiments yet.</div>
                    </div>
                </div>
            </div>
        `;
        this.container.appendChild(this.el);
    }

    bindEvents() {
        this.$('.pane-search-input').addEventListener('input', debounce(() => {
            this.filters.search = this.$('.pane-search-input').value;
            this.filterChanged();
        }, 300));
        this.$('.filter-after').addEventListener('change', () => {
            this.filters.after = this.$('.filter-after').value;
            this.filterChanged();
        });
        this.$('.filter-before').addEventListener('change', () => {
            this.filters.before = this.$('.filter-before').value;
            this.filterChanged();
        });
        this.$('.show-archived-toggle').addEventListener('change', (e) => {
            this.filters.show_archived = e.target.checked;
            this.filterChanged();
        });
        this.$('.detailed-view-toggle').addEventListener('change', (e) => {
            this.el.querySelectorAll('.table-wrap').forEach(tw =>
                tw.classList.toggle('detailed-view', e.target.checked)
            );
        });
        this.$('.merge-toggle').addEventListener('change', (e) => {
            this.merged = e.target.checked;
            this.loadExperiments();
        });
        this.$('.compare-btn').addEventListener('click', () => this.handleCompare());
        this.$('.bulk-tag-btn').addEventListener('click', () => showBulkTagModal(this));
        this.$('.new-experiment-btn').addEventListener('click', () => showNewExperimentModal());

        const pickerBtn = this.$('.col-picker-btn');
        const pickerDrop = this.$('.col-picker-dropdown');
        pickerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            pickerDrop.style.display = pickerDrop.style.display === 'none' ? 'block' : 'none';
        });
        pickerDrop.addEventListener('click', (e) => e.stopPropagation());
    }

    buildColumnPicker() {
        const dropdown = this.$('.col-picker-dropdown');
        dropdown.innerHTML = '';
        const toggleable = ALL_COLUMNS.filter(c => !c.fixed && c.label);
        for (const col of toggleable) {
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = visibleColumns.has(col.key);
            cb.addEventListener('change', () => {
                if (cb.checked) visibleColumns.add(col.key);
                else visibleColumns.delete(col.key);
                saveColumnPrefs();
                for (const p of panes) { p.buildColumnPicker(); p.loadExperiments(); }
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + col.label));
            dropdown.appendChild(label);
        }
        const btn = this.$('.col-picker-btn');
        const onCount = toggleable.filter(c => visibleColumns.has(c.key)).length;
        btn.textContent = (onCount === toggleable.length ? 'All' : onCount + '/' + toggleable.length) + ' ▾';
    }

    filterChanged() {
        if (this.isPrimary) pushFilterState(this.filters);
        this.renderActiveFilters();
        this.loadExperiments();
    }

    renderActiveFilters() {
        const container = this.$('.active-filters');
        container.innerHTML = '';
        if (this.filters.stage) {
            const s = stages.find(s => String(s.id) === String(this.filters.stage));
            const label = s ? capitalize(s.name) : this.filters.stage;
            container.appendChild(this.makeFilterChip('Stage: ' + label, 'stage'));
        }
        if (this.filters.status) {
            container.appendChild(this.makeFilterChip('Status: ' + capitalize(this.filters.status), 'status'));
        }
        if (this.filters.tag) {
            container.appendChild(this.makeFilterChip('Tag: ' + this.filters.tag, 'tag'));
        }
        if (this.filters.after) {
            container.appendChild(this.makeFilterChip('From: ' + this.filters.after, 'after', () => {
                this.$('.filter-after').value = '';
            }));
        }
        if (this.filters.before) {
            container.appendChild(this.makeFilterChip('To: ' + this.filters.before, 'before', () => {
                this.$('.filter-before').value = '';
            }));
        }
    }

    makeFilterChip(text, filterKey, extraClear) {
        const chip = document.createElement('span');
        chip.className = 'filter-chip';
        chip.innerHTML = esc(text) + ' <button class="filter-chip-clear">&times;</button>';
        chip.querySelector('button').addEventListener('click', () => {
            this.filters[filterKey] = '';
            if (extraClear) extraClear();
            this.filterChanged();
        });
        return chip;
    }

    buildTableHead(theadEl) {
        theadEl.innerHTML = '';
        const headTr = document.createElement('tr');
        for (const col of ALL_COLUMNS) {
            if (!colVisible(col.key)) continue;
            const th = document.createElement('th');
            if (col.key === 'check') th.className = 'col-check';
            else if (col.key === 'expand') th.className = 'col-expand';
            if (SORTABLE.has(col.key)) {
                th.classList.add('sortable');
                let indicator = '';
                if (this.sortKey === col.key) indicator = this.sortDir === 'asc' ? ' ▲' : ' ▼';
                th.textContent = col.label + indicator;
                th.addEventListener('click', () => {
                    if (this.sortKey === col.key) {
                        this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
                    } else {
                        this.sortKey = col.key;
                        this.sortDir = 'asc';
                    }
                    this.loadExperiments();
                });
            } else {
                th.textContent = col.label;
            }
            headTr.appendChild(th);
        }
        theadEl.appendChild(headTr);
    }

    renderRows(experiments, tbodyEl) {
        tbodyEl.innerHTML = '';
        for (const exp of experiments) {
            const tr = document.createElement('tr');
            tr.className = 'exp-row';
            tr.dataset.id = exp.id;
            if (exp.id === this.expandedId) tr.classList.add('expanded');
            if (exp.archived) tr.classList.add('archived');

            const displayAlias = exp.alias || exp.name;
            const tagBadges = (exp.tags || []).map(t =>
                `<span class="badge badge-tag clickable-filter" data-filter-tag="${esc(t.name)}">${esc(t.name)}</span>`
            ).join('<br>') || '<span class="text-muted">—</span>';

            const cells = {
                check:   `<td class="col-check"><input type="checkbox" data-id="${exp.id}" ${this.checkedIds.has(exp.id) ? 'checked' : ''}></td>`,
                expand:  `<td class="col-expand"><span class="expand-toggle">&#9654;</span></td>`,
                name:    `<td>${esc(exp.name)}</td>`,
                alias:   `<td title="${esc(exp.notes || '')}">${esc(displayAlias)}${exp.notes ? '<div class="notes-preview">' + esc(exp.notes) + '</div>' : ''}</td>`,
                stage:   `<td><span class="badge badge-${exp.stage_category} clickable-filter" data-filter-stage="${exp.stage_id}">${capitalize(exp.stage_name)}</span></td>`,
                status:  `<td><span class="badge badge-${exp.status} clickable-filter" data-filter-status="${exp.status}">${capitalize(exp.status)}</span></td>`,
                tags:    `<td>${tagBadges}</td>`,
                parent:  `<td>${renderParentLinksCompact(exp.parents)}</td>`,
                started: `<td>${formatPST(exp.created_at)}</td>`,
                updated: `<td>${timeAgo(exp.updated_at)}</td>`,
                actions: `<td class="col-actions"><button class="icon-btn edit-btn" data-id="${exp.id}" title="Edit">✎</button><a class="icon-btn tree-btn" href="/tree/${exp.id}" target="_blank" title="Dep tree"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="2.5" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="13" cy="13" r="1.5"/><line x1="8" y1="4" x2="8" y2="8"/><line x1="8" y1="8" x2="3" y2="11.5"/><line x1="8" y1="8" x2="13" y2="11.5"/></svg></a><button class="icon-btn archive-btn" data-id="${exp.id}" title="${exp.archived ? 'Unarchive' : 'Archive'}">${exp.archived
                    ? '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14v4H1V1zm1 5h12v9H2V6zm5 4V8h2v2h1.5L8 12.5 6.5 10H8z"/></svg>'
                    : '<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M1 1h14v4H1V1zm1 5h12v9H2V6zm4 2v1h4V8H6z"/></svg>'
                }</button></td>`,
            };

            let html = '';
            for (const col of ALL_COLUMNS) {
                if (!colVisible(col.key)) continue;
                html += cells[col.key];
            }
            tr.innerHTML = html;

            tr.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox' || e.target.closest('.edit-btn') || e.target.closest('.archive-btn') || e.target.closest('.tree-btn') || e.target.closest('.parent-link')) return;
                const filter = e.target.closest('.clickable-filter');
                if (filter) {
                    if (filter.dataset.filterStage) { this.filters.stage = filter.dataset.filterStage; this.filterChanged(); }
                    else if (filter.dataset.filterStatus) { this.filters.status = filter.dataset.filterStatus; this.filterChanged(); }
                    else if (filter.dataset.filterTag) { this.filters.tag = filter.dataset.filterTag; this.filterChanged(); }
                    return;
                }
                this.toggleDetail(exp.id);
            });

            const cb = tr.querySelector('input[type=checkbox]');
            if (cb) {
                cb.addEventListener('change', () => {
                    if (cb.checked) this.checkedIds.add(exp.id);
                    else this.checkedIds.delete(exp.id);
                    this.updateCompareButton();
                });
            }

            const editBtn = tr.querySelector('.edit-btn');
            if (editBtn) editBtn.addEventListener('click', () => showEditExperimentModal(exp.id));
            const archiveBtn = tr.querySelector('.archive-btn');
            if (archiveBtn) archiveBtn.addEventListener('click', () => this.handleArchiveExperiment(exp));

            tbodyEl.appendChild(tr);

            if (exp.id === this.expandedId) {
                this.loadDetailRow(exp.id, tr);
            }
        }
    }

    async loadExperiments() {
        const params = new URLSearchParams();
        if (this.filters.stage) params.set('stage_id', this.filters.stage);
        if (this.filters.status) params.set('status', this.filters.status);
        if (this.filters.search) params.set('search', this.filters.search);
        if (this.filters.tag) params.set('tag', this.filters.tag);
        if (this.filters.after) params.set('after', this.filters.after);
        if (this.filters.before) params.set('before', this.filters.before);
        if (this.filters.show_archived) params.set('show_archived', '1');

        let experiments = await API.get('/api/experiments?' + params.toString());
        if (this.sortKey) {
            const dir = this.sortDir === 'asc' ? 1 : -1;
            experiments = [...experiments].sort((a, b) => {
                const va = sortValue(a, this.sortKey);
                const vb = sortValue(b, this.sortKey);
                if (va < vb) return -1 * dir;
                if (va > vb) return 1 * dir;
                return 0;
            });
        }

        const ongoingSection = this.$('.section-ongoing');
        const finishedSection = this.$('.section-finished');
        const mergedSection = this.$('.section-merged');

        if (this.merged) {
            ongoingSection.style.display = 'none';
            finishedSection.style.display = 'none';
            mergedSection.style.display = '';

            ongoingSection.querySelector('tbody').innerHTML = '';
            finishedSection.querySelector('tbody').innerHTML = '';
            this.buildTableHead(mergedSection.querySelector('thead'));
            this.renderRows(experiments, mergedSection.querySelector('tbody'));
            mergedSection.querySelector('.empty-state').style.display = experiments.length === 0 ? 'flex' : 'none';
        } else {
            ongoingSection.style.display = '';
            finishedSection.style.display = '';
            mergedSection.style.display = 'none';

            mergedSection.querySelector('tbody').innerHTML = '';
            const ongoing = experiments.filter(e => ONGOING_STATUSES.has(e.status));
            const finished = experiments.filter(e => !ONGOING_STATUSES.has(e.status));

            this.buildTableHead(ongoingSection.querySelector('thead'));
            this.renderRows(ongoing, ongoingSection.querySelector('tbody'));
            ongoingSection.querySelector('.section-header').textContent = `Ongoing (${ongoing.length})`;
            ongoingSection.querySelector('.empty-state').style.display = ongoing.length === 0 ? 'flex' : 'none';

            this.buildTableHead(finishedSection.querySelector('thead'));
            this.renderRows(finished, finishedSection.querySelector('tbody'));
            finishedSection.querySelector('.section-header').textContent = `Finished (${finished.length})`;
            finishedSection.querySelector('.empty-state').style.display = finished.length === 0 ? 'flex' : 'none';
        }

        this.displayedCount = experiments.length;
        this.updateStatusCounts();
    }

    updateCompareButton() {
        const btn = this.$('.compare-btn');
        btn.textContent = `Compare (${this.checkedIds.size})`;
        btn.disabled = this.checkedIds.size < 2;
        const tagBtn = this.$('.bulk-tag-btn');
        tagBtn.textContent = `Tags (${this.checkedIds.size})`;
        tagBtn.disabled = this.checkedIds.size < 1;
        this.updateStatusCounts();
    }

    updateStatusCounts() {
        this.$('.status-counts').textContent =
            `total ${this.displayedCount} experiment${this.displayedCount !== 1 ? 's' : ''}, ${this.checkedIds.size} selected`;
    }

    async toggleDetail(expId) {
        const mainRow = this.el.querySelector(`.exp-row[data-id="${expId}"]`);
        if (!mainRow) return;
        const tbody = mainRow.closest('tbody');
        const existingDetail = tbody.querySelector(`.detail-row[data-id="${expId}"]`);

        if (existingDetail) {
            existingDetail.remove();
            mainRow.classList.remove('expanded');
            this.expandedId = null;
            return;
        }

        const prevDetail = this.el.querySelector('.detail-row');
        if (prevDetail) {
            const prevId = prevDetail.dataset.id;
            prevDetail.remove();
            const prevRow = this.el.querySelector(`.exp-row[data-id="${prevId}"]`);
            if (prevRow) prevRow.classList.remove('expanded');
        }

        this.expandedId = expId;
        mainRow.classList.add('expanded');
        await this.loadDetailRow(expId, mainRow);
    }

    async loadDetailRow(expId, afterRow) {
        const exp = await API.get('/api/experiments/' + expId);

        const old = this.el.querySelector(`.detail-row[data-id="${expId}"]`);
        if (old) old.remove();

        const mainRow = this.el.querySelector(`.exp-row[data-id="${expId}"]`);
        if (mainRow && colVisible('parent')) {
            const parentIdx = ALL_COLUMNS.filter(c => colVisible(c.key)).findIndex(c => c.key === 'parent');
            if (parentIdx >= 0 && mainRow.children[parentIdx]) {
                mainRow.children[parentIdx].innerHTML = renderParentLinksCompact(exp.parents);
            }
        }

        const detailTr = document.createElement('tr');
        detailTr.className = 'detail-row';
        detailTr.dataset.id = expId;

        const td = document.createElement('td');
        td.colSpan = visColCount();

        td.innerHTML = `
            <div class="detail-inner">
                <div class="detail-col">
                    <h4>Lineage</h4>
                    <div style="margin-bottom:6px">
                        <strong>Name:</strong> ${esc(exp.name)}${exp.alias ? ' <span class="text-muted">(' + esc(exp.alias) + ')</span>' : ''}
                    </div>
                    <div style="margin-bottom:6px">
                        <strong>Parents:</strong> ${renderParentLinks(exp.parents)}
                        <button class="btn btn-sm btn-primary add-parent-btn">Add</button>
                        <a class="icon-btn" href="/tree/${expId}" target="_blank" title="Dep tree"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="2.5" r="1.5"/><circle cx="3" cy="13" r="1.5"/><circle cx="13" cy="13" r="1.5"/><line x1="8" y1="4" x2="8" y2="8"/><line x1="8" y1="8" x2="3" y2="11.5"/><line x1="8" y1="8" x2="13" y2="11.5"/></svg></a>
                    </div>
                    ${renderWandbLink(exp)}
                    <h4 style="margin-top:10px">Tags</h4>
                    <div class="tag-list">${renderTags(exp.tags)}</div>
                    <div class="tag-add" style="margin-top:4px">
                        <input class="tag-input" placeholder="Add tag…" style="width:100px;font-size:10px;padding:2px 4px;border:1px solid #e0e0e0;border-radius:3px">
                        <button class="btn btn-sm add-tag-btn">+</button>
                    </div>
                    <h4 style="margin-top:10px">Notes</h4>
                    <textarea class="detail-notes" data-id="${expId}" rows="3">${esc(exp.notes || '')}</textarea>
                    <button class="btn btn-sm btn-primary save-notes-btn" data-id="${expId}">Save</button>
                </div>
                <div class="detail-col">
                    <h4>Eval Runs</h4>
                    ${renderEvalTable(exp.eval_runs)}
                    <button class="btn btn-sm add-eval-btn">+ Add eval</button>
                </div>
            </div>
        `;

        detailTr.appendChild(td);
        afterRow.after(detailTr);

        td.querySelector('.add-parent-btn').addEventListener('click', () => showAddParentModal(expId));
        td.querySelector('.add-eval-btn').addEventListener('click', () => showAddEvalModal(expId));
        td.querySelector('.save-notes-btn').addEventListener('click', async () => {
            const notes = td.querySelector('.detail-notes').value;
            await API.put('/api/experiments/' + expId, { notes });
        });

        const tagInput = td.querySelector('.tag-input');
        const addTagBtn = td.querySelector('.add-tag-btn');
        const addTag = async () => {
            const name = tagInput.value.trim();
            if (!name) return;
            await API.post(`/api/experiments/${expId}/tags`, { name });
            allTags = await API.get('/api/tags');
            refreshAllPanes();
        };
        addTagBtn.addEventListener('click', addTag);
        tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

        td.querySelectorAll('.remove-tag-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const tagId = parseInt(btn.dataset.tagId);
                await API.del(`/api/experiments/${expId}/tags/${tagId}`);
                allTags = await API.get('/api/tags');
                refreshAllPanes();
            });
        });

        td.querySelectorAll('.remove-parent-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const parentId = parseInt(btn.dataset.parentId);
                if (!confirm('Remove this parent relationship?')) return;
                await API.del(`/api/experiments/${expId}/parents/${parentId}`);
                refreshAllPanes();
            });
        });

        td.querySelectorAll('.delete-eval-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const evalId = parseInt(btn.dataset.evalId);
                if (!confirm('Delete this eval run?')) return;
                await API.del('/api/evals/' + evalId);
                refreshAllPanes();
            });
        });
    }

    async handleCompare() {
        if (this.checkedIds.size < 2) return;
        try {
            const result = await API.post('/api/compare', { experiment_ids: [...this.checkedIds] });
            if (result.warnings.length) alert(result.warnings.join('\n'));
            for (const u of result.urls) window.open(u.url, '_blank');
        } catch (err) {
            alert(err.error || 'Compare failed');
        }
    }

    async handleArchiveExperiment(exp) {
        const action = exp.archived ? 'unarchive' : 'archive';
        await API.post(`/api/experiments/${exp.id}/${action}`, {});
        if (this.expandedId === exp.id) this.expandedId = null;
        refreshAllPanes();
    }

    setFiltersFromURL(params) {
        if (params.get('stage')) this.filters.stage = params.get('stage');
        if (params.get('status')) this.filters.status = params.get('status');
        if (params.get('tag')) this.filters.tag = params.get('tag');
        if (params.get('after')) this.filters.after = params.get('after');
        if (params.get('before')) this.filters.before = params.get('before');
        if (params.get('show_archived')) {
            this.filters.show_archived = true;
            this.$('.show-archived-toggle').checked = true;
        }
        if (params.get('search')) {
            this.filters.search = params.get('search');
            this.$('.pane-search-input').value = this.filters.search;
        }
        if (this.filters.after) this.$('.filter-after').value = this.filters.after;
        if (this.filters.before) this.$('.filter-before').value = this.filters.before;
        this.renderActiveFilters();
    }

    restoreState(state) {
        this.filters.stage = (state && state.stage) || '';
        this.filters.status = (state && state.status) || '';
        this.filters.tag = (state && state.tag) || '';
        this.filters.search = (state && state.search) || '';
        this.filters.after = (state && state.after) || '';
        this.filters.before = (state && state.before) || '';
        this.filters.show_archived = !!(state && state.show_archived);
        this.$('.pane-search-input').value = this.filters.search;
        this.$('.filter-after').value = this.filters.after;
        this.$('.filter-before').value = this.filters.before;
        this.$('.show-archived-toggle').checked = this.filters.show_archived;
        this.renderActiveFilters();
        this.loadExperiments();
    }

    destroy() {
        this.el.remove();
    }
}

// ====== URL state (primary pane only) ======

function pushFilterState(filters) {
    const params = new URLSearchParams();
    if (filters.stage) params.set('stage', filters.stage);
    if (filters.status) params.set('status', filters.status);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.search) params.set('search', filters.search);
    if (filters.after) params.set('after', filters.after);
    if (filters.before) params.set('before', filters.before);
    if (filters.show_archived) params.set('show_archived', '1');
    const qs = params.toString();
    const url = qs ? '?' + qs : window.location.pathname;
    history.pushState({ ...filters }, '', url);
}

// ====== Navigate to experiment ======

window.scrollToExperiment = function(expId) {
    for (const pane of panes) {
        const row = pane.el.querySelector(`.exp-row[data-id="${expId}"]`);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            pane.toggleDetail(expId);
            return;
        }
    }
};

// ====== Modals ======

function openModal(title, bodyHtml, onSubmit) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById('modal-submit').onclick = async () => {
        await onSubmit();
        closeModal();
    };
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function showNewExperimentModal() {
    openModal('New Experiment', `
        <label>Name</label>
        <input id="m-name" required>
        <label>Alias</label>
        <input id="m-alias" placeholder="optional (defaults to name)">
        <label>Stage</label>
        <select id="m-stage">${stageOptions()}</select>
        <label>Status</label>
        <select id="m-status">${statusOptions('pending')}</select>
        <label>Tags</label>
        <input id="m-tags" placeholder="comma-separated, e.g. v2, baseline">
        <label>wandb entity</label>
        <input id="m-wandb-entity" placeholder="optional">
        <label>wandb project</label>
        <input id="m-wandb-project" placeholder="optional">
        <label>wandb run ID</label>
        <input id="m-wandb-run-id" placeholder="optional">
    `, async () => {
        const tagsStr = document.getElementById('m-tags').value;
        const tags = tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
        const data = {
            name: document.getElementById('m-name').value,
            alias: document.getElementById('m-alias').value || null,
            stage_id: parseInt(document.getElementById('m-stage').value),
            status: document.getElementById('m-status').value,
            tags,
            wandb_entity: document.getElementById('m-wandb-entity').value || null,
            wandb_project: document.getElementById('m-wandb-project').value || null,
            wandb_run_id: document.getElementById('m-wandb-run-id').value || null,
        };
        if (!data.name) return alert('Name is required');
        await API.post('/api/experiments', data);
        allTags = await API.get('/api/tags');
        refreshAllPanes();
    });
}

async function showEditExperimentModal(expId) {
    const exp = await API.get('/api/experiments/' + expId);
    const currentTags = (exp.tags || []).map(t => t.name).join(', ');
    openModal('Edit Experiment', `
        <label>Name</label>
        <input id="m-name" value="${esc(exp.name)}">
        <label>Alias</label>
        <input id="m-alias" value="${esc(exp.alias || '')}" placeholder="optional (defaults to name)">
        <label>Stage</label>
        <select id="m-stage">${stageOptions(exp.stage_id)}</select>
        <label>Status</label>
        <select id="m-status">${statusOptions(exp.status)}</select>
        <label>Tags</label>
        <input id="m-tags" value="${esc(currentTags)}" placeholder="comma-separated">
        <label>wandb entity</label>
        <input id="m-wandb-entity" value="${esc(exp.wandb_entity || '')}" placeholder="optional">
        <label>wandb project</label>
        <input id="m-wandb-project" value="${esc(exp.wandb_project || '')}" placeholder="optional">
        <label>wandb run ID</label>
        <input id="m-wandb-run-id" value="${esc(exp.wandb_run_id || '')}" placeholder="optional">
    `, async () => {
        const tagsStr = document.getElementById('m-tags').value;
        const tags = tagsStr ? tagsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
        const data = {
            name: document.getElementById('m-name').value,
            alias: document.getElementById('m-alias').value || null,
            stage_id: parseInt(document.getElementById('m-stage').value),
            status: document.getElementById('m-status').value,
            tags,
            wandb_entity: document.getElementById('m-wandb-entity').value || null,
            wandb_project: document.getElementById('m-wandb-project').value || null,
            wandb_run_id: document.getElementById('m-wandb-run-id').value || null,
        };
        await API.put('/api/experiments/' + expId, data);
        allTags = await API.get('/api/tags');
        refreshAllPanes();
    });
}

async function showAddParentModal(expId) {
    const allExps = await API.get('/api/experiments');
    const options = allExps
        .filter(e => e.id !== expId)
        .map(e => `<option value="${e.id}">${esc(e.name)} (${capitalize(e.stage_name)})</option>`)
        .join('');

    openModal('Add Parent', `
        <label>Parent experiment</label>
        <select id="m-parent-id">${options}</select>
        <label>Relation</label>
        <select id="m-relation">
            <option value="init_from">Init from</option>
            <option value="distill_from">Distill from</option>
        </select>
    `, async () => {
        const parentId = parseInt(document.getElementById('m-parent-id').value);
        const relation = document.getElementById('m-relation').value;
        if (!parentId) return alert('Select a parent experiment');
        await API.post(`/api/experiments/${expId}/parents`, { parent_id: parentId, relation });
        refreshAllPanes();
    });
}

function showAddEvalModal(expId) {
    openModal('Add Eval Run', `
        <label>Eval name</label>
        <input id="m-eval-name" required placeholder="e.g. mmlu, humaneval">
        <label>Status</label>
        <select id="m-eval-status">${statusOptions('pending')}</select>
        <label>Metrics (JSON)</label>
        <input id="m-eval-metrics" placeholder='{"accuracy": 0.85}'>
        <label>wandb entity</label>
        <input id="m-eval-wandb-entity" placeholder="optional">
        <label>wandb project</label>
        <input id="m-eval-wandb-project" placeholder="optional">
        <label>wandb run ID</label>
        <input id="m-eval-wandb-run-id" placeholder="optional">
    `, async () => {
        const name = document.getElementById('m-eval-name').value;
        if (!name) return alert('Name is required');
        const metricsStr = document.getElementById('m-eval-metrics').value;
        let metrics = null;
        if (metricsStr) {
            try { metrics = JSON.parse(metricsStr); }
            catch { return alert('Invalid JSON in metrics'); }
        }
        await API.post(`/api/experiments/${expId}/evals`, {
            name,
            status: document.getElementById('m-eval-status').value,
            metrics,
            wandb_entity: document.getElementById('m-eval-wandb-entity').value || null,
            wandb_project: document.getElementById('m-eval-wandb-project').value || null,
            wandb_run_id: document.getElementById('m-eval-wandb-run-id').value || null,
        });
        refreshAllPanes();
    });
}

function showBulkTagModal(pane) {
    if (pane.checkedIds.size < 1) return;
    const tagOptions = allTags.map(t =>
        `<option value="${esc(t.name)}">${esc(t.name)}</option>`
    ).join('');

    openModal('Manage Tags', `
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">${pane.checkedIds.size} experiment(s) selected</p>
        <label>Add tag to all selected</label>
        <div style="display:flex;gap:6px">
            <input id="m-bulk-tag-add" placeholder="Tag name">
            <button class="btn btn-sm btn-primary" id="m-bulk-tag-add-btn">Add</button>
        </div>
        <label>Remove tag from all selected</label>
        <div style="display:flex;gap:6px">
            <select id="m-bulk-tag-remove"><option value="">Choose…</option>${tagOptions}</select>
            <button class="btn btn-sm btn-danger" id="m-bulk-tag-remove-btn">Remove</button>
        </div>
    `, () => closeModal());

    setTimeout(() => {
        document.getElementById('m-bulk-tag-add-btn').addEventListener('click', async () => {
            const name = document.getElementById('m-bulk-tag-add').value.trim();
            if (!name) return;
            await API.post('/api/experiments/bulk-add-tag', { name, experiment_ids: [...pane.checkedIds] });
            allTags = await API.get('/api/tags');
            refreshAllPanes();
            document.getElementById('m-bulk-tag-add').value = '';
        });

        document.getElementById('m-bulk-tag-remove-btn').addEventListener('click', async () => {
            const name = document.getElementById('m-bulk-tag-remove').value;
            if (!name) return;
            await API.post('/api/experiments/bulk-remove-tag', { name, experiment_ids: [...pane.checkedIds] });
            allTags = await API.get('/api/tags');
            refreshAllPanes();
        });
    }, 0);
}

// ====== Init ======

document.addEventListener('DOMContentLoaded', async () => {
    [stages, allTags] = await Promise.all([
        API.get('/api/stages'),
        API.get('/api/tags'),
    ]);
    loadColumnPrefs();

    const container = document.getElementById('pane-container');
    const primaryPane = new Pane(container, true);
    panes.push(primaryPane);

    primaryPane.setFiltersFromURL(new URLSearchParams(window.location.search));
    history.replaceState({ ...primaryPane.filters }, '', window.location.href);
    await primaryPane.loadExperiments();

    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    document.addEventListener('click', () => {
        for (const p of panes) {
            const dd = p.$('.col-picker-dropdown');
            if (dd) dd.style.display = 'none';
        }
    });

    window.addEventListener('popstate', (e) => {
        if (panes[0]) panes[0].restoreState(e.state);
    });
});
