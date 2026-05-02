let stages = [];
let allTags = [];
const checkedIds = new Set();
let expandedId = null;
let sortKey = '';
let sortDir = 'asc';
let displayedCount = 0;

const filters = { stage: '', status: '', tag: '', search: '', after: '', before: '', show_archived: false };

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

function capitalize(str) {
    if (!str) return '';
    if (ACRONYMS.has(str.toLowerCase())) return str.toUpperCase();
    return str.charAt(0).toUpperCase() + str.slice(1);
}

const SORTABLE = new Set(['name', 'alias', 'stage', 'status', 'started', 'updated']);

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

function sortExperiments(experiments) {
    if (!sortKey) return experiments;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...experiments].sort((a, b) => {
        const va = sortValue(a, sortKey);
        const vb = sortValue(b, sortKey);
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    [stages, allTags] = await Promise.all([
        API.get('/api/stages'),
        API.get('/api/tags'),
    ]);
    loadColumnPrefs();
    buildColumnPicker();

    const initial = new URLSearchParams(window.location.search);
    if (initial.get('stage')) filters.stage = initial.get('stage');
    if (initial.get('status')) filters.status = initial.get('status');
    if (initial.get('tag')) filters.tag = initial.get('tag');
    if (initial.get('after')) filters.after = initial.get('after');
    if (initial.get('before')) filters.before = initial.get('before');
    if (initial.get('show_archived')) {
        filters.show_archived = true;
        document.getElementById('show-archived-toggle').checked = true;
    }
    if (initial.get('search')) {
        filters.search = initial.get('search');
        document.getElementById('filter-search').value = filters.search;
    }
    if (filters.after) document.getElementById('filter-after').value = filters.after;
    if (filters.before) document.getElementById('filter-before').value = filters.before;

    history.replaceState({ ...filters }, '', window.location.href);

    renderActiveFilters();
    await loadExperiments();
    bindEvents();

    window.addEventListener('popstate', (e) => restoreFilterState(e.state));
});

function renderActiveFilters() {
    const container = document.getElementById('active-filters');
    container.innerHTML = '';
    if (filters.stage) {
        const s = stages.find(s => String(s.id) === String(filters.stage));
        const label = s ? capitalize(s.name) : filters.stage;
        container.appendChild(makeFilterChip('Stage: ' + label, 'stage'));
    }
    if (filters.status) {
        container.appendChild(makeFilterChip('Status: ' + capitalize(filters.status), 'status'));
    }
    if (filters.tag) {
        container.appendChild(makeFilterChip('Tag: ' + filters.tag, 'tag'));
    }
    if (filters.after) {
        container.appendChild(makeFilterChip('From: ' + filters.after, 'after', () => {
            document.getElementById('filter-after').value = '';
        }));
    }
    if (filters.before) {
        container.appendChild(makeFilterChip('To: ' + filters.before, 'before', () => {
            document.getElementById('filter-before').value = '';
        }));
    }
}

function makeFilterChip(text, filterKey, extraClear) {
    const chip = document.createElement('span');
    chip.className = 'filter-chip';
    chip.innerHTML = esc(text) + ' <button class="filter-chip-clear">&times;</button>';
    chip.querySelector('button').addEventListener('click', () => {
        filters[filterKey] = '';
        if (extraClear) extraClear();
        filterChanged();
    });
    return chip;
}

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

function buildColumnPicker() {
    const dropdown = document.getElementById('col-picker-dropdown');
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
            updateColumnPickerLabel(toggleable);
            saveColumnPrefs();
            loadExperiments();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + col.label));
        dropdown.appendChild(label);
    }
    updateColumnPickerLabel(toggleable);
}

function updateColumnPickerLabel(toggleable) {
    const btn = document.getElementById('col-picker-btn');
    const onCount = toggleable.filter(c => visibleColumns.has(c.key)).length;
    btn.textContent = (onCount === toggleable.length ? 'All' : onCount + '/' + toggleable.length) + ' ▾';
}

function pushFilterState() {
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

function restoreFilterState(state) {
    filters.stage = (state && state.stage) || '';
    filters.status = (state && state.status) || '';
    filters.tag = (state && state.tag) || '';
    filters.search = (state && state.search) || '';
    filters.after = (state && state.after) || '';
    filters.before = (state && state.before) || '';
    filters.show_archived = !!(state && state.show_archived);
    document.getElementById('filter-search').value = filters.search;
    document.getElementById('filter-after').value = filters.after;
    document.getElementById('filter-before').value = filters.before;
    document.getElementById('show-archived-toggle').checked = filters.show_archived;
    renderActiveFilters();
    loadExperiments();
}

function filterChanged() {
    pushFilterState();
    renderActiveFilters();
    loadExperiments();
}

function bindEvents() {
    document.getElementById('filter-search').addEventListener('input', debounce(() => {
        filters.search = document.getElementById('filter-search').value;
        filterChanged();
    }, 300));
    document.getElementById('filter-after').addEventListener('change', () => {
        filters.after = document.getElementById('filter-after').value;
        filterChanged();
    });
    document.getElementById('filter-before').addEventListener('change', () => {
        filters.before = document.getElementById('filter-before').value;
        filterChanged();
    });
    document.getElementById('show-archived-toggle').addEventListener('change', (e) => {
        filters.show_archived = e.target.checked;
        filterChanged();
    });
    document.getElementById('detailed-view-toggle').addEventListener('change', (e) => {
        document.querySelector('.table-wrap').classList.toggle('detailed-view', e.target.checked);
    });
    document.getElementById('compare-btn').addEventListener('click', handleCompare);
    document.getElementById('bulk-tag-btn').addEventListener('click', showBulkTagModal);
    document.getElementById('new-experiment-btn').addEventListener('click', showNewExperimentModal);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);

    const pickerBtn = document.getElementById('col-picker-btn');
    const pickerDrop = document.getElementById('col-picker-dropdown');
    pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerDrop.style.display = pickerDrop.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { pickerDrop.style.display = 'none'; });
    pickerDrop.addEventListener('click', (e) => e.stopPropagation());
}

function colVisible(key) {
    return visibleColumns.has(key);
}

function visColCount() {
    return ALL_COLUMNS.filter(c => colVisible(c.key)).length;
}

// --- Experiment list ---

async function loadExperiments() {
    const params = new URLSearchParams();
    if (filters.stage) params.set('stage_id', filters.stage);
    if (filters.status) params.set('status', filters.status);
    if (filters.search) params.set('search', filters.search);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.after) params.set('after', filters.after);
    if (filters.before) params.set('before', filters.before);
    if (filters.show_archived) params.set('show_archived', '1');

    const experiments = sortExperiments(await API.get('/api/experiments?' + params.toString()));

    const thead = document.getElementById('experiment-thead');
    thead.innerHTML = '';
    const headTr = document.createElement('tr');
    for (const col of ALL_COLUMNS) {
        if (!colVisible(col.key)) continue;
        const th = document.createElement('th');
        if (col.key === 'check') th.className = 'col-check';
        else if (col.key === 'expand') th.className = 'col-expand';
        if (SORTABLE.has(col.key)) {
            th.classList.add('sortable');
            th.dataset.sortKey = col.key;
            let indicator = '';
            if (sortKey === col.key) indicator = sortDir === 'asc' ? ' ▲' : ' ▼';
            th.textContent = col.label + indicator;
            th.addEventListener('click', () => {
                if (sortKey === col.key) {
                    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortKey = col.key;
                    sortDir = 'asc';
                }
                loadExperiments();
            });
        } else {
            th.textContent = col.label;
        }
        headTr.appendChild(th);
    }
    thead.appendChild(headTr);

    const tbody = document.getElementById('experiment-tbody');
    const emptyState = document.getElementById('empty-state');
    tbody.innerHTML = '';

    displayedCount = experiments.length;
    updateStatusCounts();

    if (experiments.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }
    emptyState.style.display = 'none';

    for (const exp of experiments) {
        const tr = document.createElement('tr');
        tr.className = 'exp-row';
        tr.dataset.id = exp.id;
        if (exp.id === expandedId) tr.classList.add('expanded');
        if (exp.archived) tr.classList.add('archived');

        const displayAlias = exp.alias || exp.name;
        const tagBadges = (exp.tags || []).map(t =>
            `<span class="badge badge-tag clickable-filter" data-filter-tag="${esc(t.name)}">${esc(t.name)}</span>`
        ).join('<br>') || '<span class="text-muted">—</span>';

        const cells = {
            check:   `<td class="col-check"><input type="checkbox" data-id="${exp.id}" ${checkedIds.has(exp.id) ? 'checked' : ''}></td>`,
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
                if (filter.dataset.filterStage) {
                    filters.stage = filter.dataset.filterStage;
                    filterChanged();
                } else if (filter.dataset.filterStatus) {
                    filters.status = filter.dataset.filterStatus;
                    filterChanged();
                } else if (filter.dataset.filterTag) {
                    filters.tag = filter.dataset.filterTag;
                    filterChanged();
                }
                return;
            }
            toggleDetail(exp.id);
        });

        const cb = tr.querySelector('input[type=checkbox]');
        if (cb) {
            cb.addEventListener('change', () => {
                if (cb.checked) checkedIds.add(exp.id);
                else checkedIds.delete(exp.id);
                updateCompareButton();
            });
        }

        const editBtn = tr.querySelector('.edit-btn');
        if (editBtn) editBtn.addEventListener('click', () => showEditExperimentModal(exp.id));
        const archiveBtn = tr.querySelector('.archive-btn');
        if (archiveBtn) archiveBtn.addEventListener('click', () => handleArchiveExperiment(exp));

        tbody.appendChild(tr);

        if (exp.id === expandedId) {
            loadDetailRow(exp.id, tr);
        }
    }
}

function updateCompareButton() {
    const btn = document.getElementById('compare-btn');
    btn.textContent = `Compare (${checkedIds.size})`;
    btn.disabled = checkedIds.size < 2;
    const tagBtn = document.getElementById('bulk-tag-btn');
    tagBtn.textContent = `Tags (${checkedIds.size})`;
    tagBtn.disabled = checkedIds.size < 1;
    updateStatusCounts();
}

function updateStatusCounts() {
    const el = document.getElementById('status-counts');
    let text = `total ${displayedCount} experiment${displayedCount !== 1 ? 's' : ''}, ${checkedIds.size} selected`;
    el.textContent = text;
}

// --- Expandable detail row ---

async function toggleDetail(expId) {
    const tbody = document.getElementById('experiment-tbody');
    const mainRow = tbody.querySelector(`.exp-row[data-id="${expId}"]`);
    const existingDetail = tbody.querySelector(`.detail-row[data-id="${expId}"]`);

    if (existingDetail) {
        existingDetail.remove();
        mainRow.classList.remove('expanded');
        expandedId = null;
        return;
    }

    const prevDetail = tbody.querySelector('.detail-row');
    if (prevDetail) {
        const prevId = prevDetail.dataset.id;
        prevDetail.remove();
        const prevRow = tbody.querySelector(`.exp-row[data-id="${prevId}"]`);
        if (prevRow) prevRow.classList.remove('expanded');
    }

    expandedId = expId;
    mainRow.classList.add('expanded');
    await loadDetailRow(expId, mainRow);
}

async function loadDetailRow(expId, afterRow) {
    const exp = await API.get('/api/experiments/' + expId);
    const tbody = document.getElementById('experiment-tbody');

    const old = tbody.querySelector(`.detail-row[data-id="${expId}"]`);
    if (old) old.remove();

    const mainRow = tbody.querySelector(`.exp-row[data-id="${expId}"]`);
    if (mainRow && colVisible('parent')) {
        const parentIdx = ALL_COLUMNS.filter(c => colVisible(c.key)).findIndex(c => c.key === 'parent');
        if (parentIdx >= 0 && mainRow.children[parentIdx]) {
            mainRow.children[parentIdx].innerHTML = renderParentLinks(exp.parents);
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
                <div class="tag-list">${renderTags(exp.tags, expId)}</div>
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
                await loadDetailRow(expId, mainRow);
        await loadExperiments();
    };
    addTagBtn.addEventListener('click', addTag);
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTag(); });

    td.querySelectorAll('.remove-tag-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tagId = parseInt(btn.dataset.tagId);
            await API.del(`/api/experiments/${expId}/tags/${tagId}`);
            await loadDetailRow(expId, mainRow);
            await loadExperiments();
        });
    });

    td.querySelectorAll('.remove-parent-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const parentId = parseInt(btn.dataset.parentId);
            if (!confirm('Remove this parent relationship?')) return;
            await API.del(`/api/experiments/${expId}/parents/${parentId}`);
            await loadDetailRow(expId, mainRow);
        });
    });

    td.querySelectorAll('.delete-eval-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const evalId = parseInt(btn.dataset.evalId);
            if (!confirm('Delete this eval run?')) return;
            await API.del('/api/evals/' + evalId);
            await loadDetailRow(expId, mainRow);
        });
    });
}

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

function renderTags(tags, expId) {
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

// --- Navigate to experiment ---

window.scrollToExperiment = function(expId) {
    const row = document.querySelector(`.exp-row[data-id="${expId}"]`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toggleDetail(expId);
    }
};

// --- Compare ---

async function handleCompare() {
    if (checkedIds.size < 2) return;
    try {
        const result = await API.post('/api/compare', { experiment_ids: [...checkedIds] });
        if (result.warnings.length) {
            alert(result.warnings.join('\n'));
        }
        for (const u of result.urls) {
            window.open(u.url, '_blank');
        }
    } catch (err) {
        alert(err.error || 'Compare failed');
    }
}

// --- Archive experiment ---

async function handleArchiveExperiment(exp) {
    const action = exp.archived ? 'unarchive' : 'archive';
    await API.post(`/api/experiments/${exp.id}/${action}`, {});
    if (expandedId === exp.id) expandedId = null;
    await loadExperiments();
}

// --- Modals ---

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
                await loadExperiments();
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
                await loadExperiments();
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
        await loadExperiments();
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
        await loadExperiments();
    });
}

// --- Bulk tag modal ---

function showBulkTagModal() {
    if (checkedIds.size < 1) return;
    const tagOptions = allTags.map(t =>
        `<option value="${esc(t.name)}">${esc(t.name)}</option>`
    ).join('');

    openModal('Manage Tags', `
        <p style="font-size:11px;color:var(--text-muted);margin-bottom:12px">${checkedIds.size} experiment(s) selected</p>
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
        const addBtn = document.getElementById('m-bulk-tag-add-btn');
        const removeBtn = document.getElementById('m-bulk-tag-remove-btn');

        addBtn.addEventListener('click', async () => {
            const name = document.getElementById('m-bulk-tag-add').value.trim();
            if (!name) return;
            await API.post('/api/experiments/bulk-add-tag', {
                name, experiment_ids: [...checkedIds],
            });
            allTags = await API.get('/api/tags');
                        await loadExperiments();
            document.getElementById('m-bulk-tag-add').value = '';
        });

        removeBtn.addEventListener('click', async () => {
            const name = document.getElementById('m-bulk-tag-remove').value;
            if (!name) return;
            await API.post('/api/experiments/bulk-remove-tag', {
                name, experiment_ids: [...checkedIds],
            });
            allTags = await API.get('/api/tags');
                        await loadExperiments();
        });
    }, 0);
}

// --- Utilities ---

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
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}
