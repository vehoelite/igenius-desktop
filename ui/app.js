// ── iGenius Memory Desktop — Standalone App Logic ──────
// Direct HTTP client (no VS Code bridge)

// ── Global error handler (debug) ──────────────────
window.addEventListener('error', (e) => {
  console.error('[GLOBAL ERROR]', e.message, e.filename, e.lineno);
  debugLog('ERROR: ' + e.message + ' @ line ' + e.lineno);
  const toast = document.getElementById('error-toast');
  if (toast) {
    toast.textContent = 'JS Error: ' + e.message;
    toast.style.background = '#f43f5e';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 5000);
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED PROMISE]', e.reason);
  debugLog('PROMISE: ' + (e.reason?.message || e.reason));
});

// On-screen debug log (triple-click title to toggle)
function debugLog(msg) {
  let el = document.getElementById('debug-panel');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'debug-panel';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:200px;overflow:auto;' +
      'background:#0a0a0f;color:#4ade80;font-size:11px;padding:8px;z-index:9999;display:none;border-top:2px solid #8b5cf6;';
    document.body.appendChild(el);
  }
  el.textContent += '[' + new Date().toLocaleTimeString() + '] ' + msg + '\n';
  el.scrollTop = el.scrollHeight;
}

// Toggle debug panel with F12 key
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12') {
    e.preventDefault();
    const el = document.getElementById('debug-panel');
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    debugLog('Debug panel toggled');
  }
});

// ── Config ────────────────────────────────────────
const DEFAULT_URL = 'https://igenius-memory.online/v1';
let apiUrl  = localStorage.getItem('igenius_url') || DEFAULT_URL;
let apiKey  = localStorage.getItem('igenius_key') || '';
let activeProject = localStorage.getItem('igenius_project') || '';
let llmProvider = localStorage.getItem('igenius_llm_provider') || 'lmstudio';
let llmModel = localStorage.getItem('igenius_llm_model') || '';
let llmApiKey = localStorage.getItem('igenius_llm_api_key') || '';
let llmBaseUrl = localStorage.getItem('igenius_llm_base_url') || '';
let refreshTimer = null;

// ── API Client ────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'User-Agent': 'iGenius-Desktop/0.2.0',
      ...(llmProvider && { 'X-LLM-Provider': llmProvider }),
      ...(llmModel && { 'X-LLM-Model': llmModel }),
      ...(llmApiKey && { 'X-LLM-Api-Key': llmApiKey }),
      ...(llmBaseUrl && { 'X-LLM-Base-Url': llmBaseUrl }),
    },
  };

  // Auto-inject project into POST/PATCH body
  if (activeProject && (method === 'POST' || method === 'PATCH') && body && typeof body === 'object') {
    if (!('project' in body)) {
      body = { ...body, project: activeProject };
    }
  }

  if (body) opts.body = JSON.stringify(body);

  let url = apiUrl.replace(/\/+$/, '') + path;

  // Auto-inject project as query param for GET/DELETE requests
  if (activeProject && (method === 'GET' || method === 'DELETE')) {
    const sep = url.includes('?') ? '&' : '?';
    if (!url.includes('project=')) {
      url += sep + 'project=' + encodeURIComponent(activeProject);
    }
  }

  const res = await fetch(url, opts);

  if (!res.ok) {
    let detail;
    try {
      const j = await res.json();
      detail = j.detail || j.message || res.statusText;
    } catch { detail = res.statusText; }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

// ── State ─────────────────────────────────────────
let memories = { short_term: [], long_term: [], persistent: [] };
let pinnedMemories = [];
let currentTab = 'long_term';

// ── Boot ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  debugLog('DOMContentLoaded fired, apiKey=' + (apiKey ? 'SET' : 'EMPTY'));

  // ── Bind all buttons (no inline onclick in Tauri v2) ──
  document.getElementById('btn-connect')?.addEventListener('click', () => saveSetup());
  document.getElementById('btn-get-key')?.addEventListener('click', () => {
    window.open('https://igenius-memory.store');
  });
  document.getElementById('btn-refresh')?.addEventListener('click', () => refreshAll());
  document.getElementById('btn-settings')?.addEventListener('click', () => showSettings());
  document.getElementById('btn-briefing')?.addEventListener('click', () => getBriefing());
  document.getElementById('btn-toggle-pin-form')?.addEventListener('click', () => togglePinForm());
  document.getElementById('btn-save-pin')?.addEventListener('click', () => savePin());
  document.getElementById('btn-cancel-pin')?.addEventListener('click', () => togglePinForm());
  document.getElementById('btn-close-settings')?.addEventListener('click', () => hideSettings());
  document.getElementById('btn-save-settings')?.addEventListener('click', () => updateSettings());
  document.getElementById('btn-cancel-settings')?.addEventListener('click', () => hideSettings());
  document.getElementById('project-bar')?.addEventListener('click', () => showProjectPicker());
  document.getElementById('settings-provider')?.addEventListener('change', (e) => toggleProviderFields(e.target.value));

  // ── Event delegation for dynamic content ──
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id ? parseInt(btn.dataset.id) : null;
      if (action === 'promote' && id) promoteMemory(id);
      else if (action === 'delete' && id) deleteMemory(id);
      else if (action === 'delete-pin' && id) deletePin(id);
      else if (action === 'edit-pin' && id) editPin(id);
      else if (action === 'add-memory') { ctxMenu.classList.remove('show'); addMemory(); }
      else if (action === 'refresh') { ctxMenu.classList.remove('show'); refreshAll(); }
      return;
    }

    // Pin card toggle
    const pinCard = e.target.closest('.pin-card');
    if (pinCard && !e.target.closest('.pin-actions')) {
      pinCard.classList.toggle('expanded');
      return;
    }

    // Close context menu on any click
    ctxMenu.classList.remove('show');
  });

  if (!apiKey) {
    showSetup();
  } else {
    showMain();
  }
});

function showSetup() {
  document.getElementById('no-key').style.display = '';
  document.getElementById('main').style.display = 'none';
  stopRefresh();
}

function showMain() {
  document.getElementById('no-key').style.display = 'none';
  document.getElementById('main').style.display = '';
  updateProjectBar();
  refreshAll();
  startRefresh();
}

function updateProjectBar() {
  const nameEl = document.getElementById('project-name');
  const barEl = document.getElementById('project-bar');
  if (activeProject) {
    nameEl.textContent = activeProject;
    barEl.classList.remove('global');
    barEl.classList.add('scoped');
  } else {
    nameEl.textContent = 'Global (no project)';
    barEl.classList.add('global');
    barEl.classList.remove('scoped');
  }
}

function showProjectPicker() {
  const current = activeProject || '';
  const input = prompt('Enter project name for memory isolation (leave empty for global scope):', current);
  if (input === null) return; // cancelled
  activeProject = input.trim();
  localStorage.setItem('igenius_project', activeProject);
  updateProjectBar();
  showToast(activeProject ? '📁 Project: ' + activeProject : '🌐 Global scope', false);
  refreshAll();
}

async function saveSetup() {
  debugLog('saveSetup() called');
  let url = document.getElementById('setup-url').value.trim() || DEFAULT_URL;
  let key = document.getElementById('setup-key').value.trim();
  let project = document.getElementById('setup-project').value.trim();

  // Auto-detect swapped fields: key in URL field, URL in key field
  if (url.startsWith('ig_') && !key.startsWith('ig_')) {
    debugLog('Detected swapped fields — auto-correcting');
    const tmp = url;
    url = key || DEFAULT_URL;
    key = tmp;
    showToast('Fields were swapped — auto-corrected ✓', false);
  }

  // Validate key format
  if (!key) { showError('API key is required'); return; }
  if (!key.startsWith('ig_')) {
    showError('API key must start with ig_');
    return;
  }

  // Validate URL format
  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    showError('API URL must start with https://');
    return;
  }

  debugLog('url=' + url + ' key=' + key.substring(0, 10) + '...');

  // Test connection before saving
  const connectBtn = document.getElementById('btn-connect');
  const origText = connectBtn.textContent;
  connectBtn.textContent = 'Connecting…';
  connectBtn.disabled = true;

  try {
    const testRes = await fetch(url.replace(/\/+$/, '') + '/memories/stats', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': key,
        'User-Agent': 'iGenius-Desktop/0.1.0',
      },
    });

    if (testRes.status === 403) {
      showError('Invalid API key — check your key and try again');
      debugLog('Connection test failed: 403 Forbidden');
      return;
    }
    if (testRes.status === 401) {
      showError('API key not recognized — get a key at igenius-memory.store');
      debugLog('Connection test failed: 401 Unauthorized');
      return;
    }
    if (!testRes.ok) {
      showError('Connection failed: HTTP ' + testRes.status);
      debugLog('Connection test failed: HTTP ' + testRes.status);
      return;
    }

    debugLog('Connection test passed ✓');
  } catch (err) {
    showError('Cannot reach server — check URL and network');
    debugLog('Connection test error: ' + err.message);
    return;
  } finally {
    connectBtn.textContent = origText;
    connectBtn.disabled = false;
  }

  apiUrl = url;
  apiKey = key;
  activeProject = project;
  localStorage.setItem('igenius_url', apiUrl);
  localStorage.setItem('igenius_key', apiKey);
  localStorage.setItem('igenius_project', activeProject);
  debugLog('Saved to localStorage, calling showMain()');
  showToast('Connected ✓', false);
  showMain();
}

// ── Settings modal ────────────────────────────────
function showSettings() {
  document.getElementById('settings-url').value = apiUrl;
  document.getElementById('settings-key').value = apiKey;
  document.getElementById('settings-project').value = activeProject;

  // LLM provider
  document.getElementById('settings-provider').value = llmProvider;
  document.getElementById('settings-lmstudio-url').value = llmBaseUrl || 'http://localhost:1234/v1';
  document.getElementById('settings-lmstudio-model').value = llmProvider === 'lmstudio' ? (llmModel || '') : '';
  document.getElementById('settings-openai-key').value = llmProvider === 'openai' ? llmApiKey : '';
  document.getElementById('settings-openai-model').value = llmProvider === 'openai' ? (llmModel || 'gpt-4o') : 'gpt-4o';
  document.getElementById('settings-anthropic-key').value = llmProvider === 'anthropic' ? llmApiKey : '';
  document.getElementById('settings-anthropic-model').value = llmProvider === 'anthropic' ? (llmModel || 'claude-sonnet-4-20250514') : 'claude-sonnet-4-20250514';
  document.getElementById('settings-google-key').value = llmProvider === 'google' ? llmApiKey : '';
  document.getElementById('settings-google-model').value = llmProvider === 'google' ? (llmModel || 'gemini-2.0-flash') : 'gemini-2.0-flash';
  toggleProviderFields(llmProvider);

  document.getElementById('settings-modal').style.display = '';
}

function toggleProviderFields(provider) {
  const providers = ['lmstudio', 'openai', 'anthropic', 'google'];
  providers.forEach(p => {
    const el = document.getElementById('provider-' + p + '-fields');
    if (el) el.style.display = p === provider ? '' : 'none';
  });
}

function hideSettings() {
  document.getElementById('settings-modal').style.display = 'none';
}

async function updateSettings() {
  let url = document.getElementById('settings-url').value.trim() || DEFAULT_URL;
  let key = document.getElementById('settings-key').value.trim();

  // Auto-detect swapped fields
  if (url.startsWith('ig_') && !key.startsWith('ig_')) {
    const tmp = url;
    url = key || DEFAULT_URL;
    key = tmp;
    document.getElementById('settings-url').value = url;
    document.getElementById('settings-key').value = key;
    showToast('Fields were swapped — auto-corrected ✓', false);
  }

  if (!key) { showError('API key is required'); return; }
  if (!key.startsWith('ig_')) { showError('API key must start with ig_'); return; }
  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    showError('API URL must start with https://');
    return;
  }

  // Test connection
  const saveBtn = document.getElementById('btn-save-settings');
  const origText = saveBtn.textContent;
  saveBtn.textContent = 'Testing…';
  saveBtn.disabled = true;

  try {
    const testRes = await fetch(url.replace(/\/+$/, '') + '/memories/stats', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    });
    if (testRes.status === 403 || testRes.status === 401) {
      showError('Invalid API key');
      return;
    }
    if (!testRes.ok) {
      showError('Connection failed: HTTP ' + testRes.status);
      return;
    }
  } catch (err) {
    showError('Cannot reach server — check URL');
    return;
  } finally {
    saveBtn.textContent = origText;
    saveBtn.disabled = false;
  }

  apiUrl = url;
  apiKey = key;
  activeProject = document.getElementById('settings-project').value.trim();

  // Save LLM provider settings
  llmProvider = document.getElementById('settings-provider').value;
  if (llmProvider === 'lmstudio') {
    llmBaseUrl = document.getElementById('settings-lmstudio-url').value.trim() || 'http://localhost:1234/v1';
    llmModel = document.getElementById('settings-lmstudio-model').value.trim();
    llmApiKey = '';
  } else if (llmProvider === 'openai') {
    llmApiKey = document.getElementById('settings-openai-key').value.trim();
    llmModel = document.getElementById('settings-openai-model').value;
    llmBaseUrl = '';
  } else if (llmProvider === 'anthropic') {
    llmApiKey = document.getElementById('settings-anthropic-key').value.trim();
    llmModel = document.getElementById('settings-anthropic-model').value;
    llmBaseUrl = '';
  } else if (llmProvider === 'google') {
    llmApiKey = document.getElementById('settings-google-key').value.trim();
    llmModel = document.getElementById('settings-google-model').value;
    llmBaseUrl = '';
  }

  localStorage.setItem('igenius_url', apiUrl);
  localStorage.setItem('igenius_key', apiKey);
  localStorage.setItem('igenius_project', activeProject);
  localStorage.setItem('igenius_llm_provider', llmProvider);
  localStorage.setItem('igenius_llm_model', llmModel);
  localStorage.setItem('igenius_llm_api_key', llmApiKey);
  localStorage.setItem('igenius_llm_base_url', llmBaseUrl);
  hideSettings();
  updateProjectBar();
  showToast('Settings saved ✓', false);
  refreshAll();
}

// ── Auto-refresh ──────────────────────────────────
function startRefresh() {
  stopRefresh();
  refreshTimer = setInterval(refreshAll, 30000);
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

// ── Data loading ──────────────────────────────────
async function refreshAll() {
  setLoading(true);
  try {
    await Promise.all([
      loadLayer('long_term'),
      loadLayer('short_term'),
      loadPins(),
      loadStats(),
    ]);
  } catch (err) {
    debugLog('refreshAll error: ' + err.message);
    if (err.message.includes('403') || err.message.includes('401')) {
      showError('Invalid API key — check Settings ⚙');
      // Kick back to setup if the key is totally wrong
      apiKey = '';
      localStorage.removeItem('igenius_key');
      showSetup();
    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      showError('Cannot reach server — check your connection');
    } else {
      showError('Load failed: ' + err.message);
    }
  } finally {
    setLoading(false);
  }
}

async function loadLayer(layer) {
  const res = await api('GET', `/memories/layer/${layer}`);
  memories[layer] = res.memories || [];
  renderCards(layer, layer === 'long_term' ? 'lt-list' : 'st-list');
}

async function loadPins() {
  const res = await api('GET', '/memories/layer/pinned');
  pinnedMemories = res.memories || [];
  renderPins();
}

async function loadStats() {
  const res = await api('GET', '/memories/stats');
  document.getElementById('stat-total').textContent     = 'Total: ' + (res.total_count ?? 0);
  document.getElementById('stat-persistent').textContent = 'P: '    + (res.persistent_count ?? 0);
  document.getElementById('stat-long').textContent       = 'LT: '   + (res.long_term_count ?? 0);
  document.getElementById('stat-short').textContent      = 'ST: '   + (res.short_term_count ?? 0);
  document.getElementById('count-lt').textContent        = res.long_term_count  ?? 0;
  document.getElementById('count-st').textContent        = res.short_term_count ?? 0;
}

async function getBriefing() {
  setLoading(true);
  try {
    const res = await api('GET', '/briefing');
    document.getElementById('briefing-text').innerHTML =
      '<div style="white-space:pre-wrap;line-height:1.7;">'
      + esc(res.briefing || 'No briefing available.') + '</div>';
  } catch (err) {
    showError('Briefing failed: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Tab switching ─────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const id = tab.dataset.tab;
    currentTab = id;
    document.getElementById('panel-' + id)?.classList.add('active');
  });
});

// ── Search ────────────────────────────────────────
let searchTimeout;
document.getElementById('search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length >= 2) {
    searchTimeout = setTimeout(() => doSearch(q), 300);
  }
});

async function doSearch(query) {
  setLoading(true);
  try {
    const encoded = encodeURIComponent(query);
    const res = await api('GET', `/memories/search?q=${encoded}`);
    renderSearchResults({ memories: res.results || [], query, count: res.count || 0 });
  } catch (err) {
    showError('Search failed: ' + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Actions ───────────────────────────────────────
async function promoteMemory(id) {
  try {
    await api('POST', `/memories/${id}/promote`, {});
    showToast('Memory #' + id + ' promoted to long-term ✓', false);
    refreshAll();
  } catch (err) {
    showError('Promote failed: ' + err.message);
  }
}

async function deleteMemory(id) {
  try {
    await api('DELETE', `/memories/${id}`);
    showToast('Memory #' + id + ' deleted ✓', false);
    refreshAll();
  } catch (err) {
    showError('Delete failed: ' + err.message);
  }
}

async function deletePin(id) {
  try {
    await api('DELETE', `/memories/${id}`);
    showToast('Pin deleted ✓', false);
    loadPins();
  } catch (err) {
    showError('Delete failed: ' + err.message);
  }
}

// ── Add memory (from context menu) ────────────────
async function addMemory() {
  const content = prompt('Memory content:');
  if (!content) return;
  const title = prompt('Title (optional):') || '';
  try {
    await api('POST', '/memories', {
      content,
      layer: 'long_term',
      title: title || 'Manual entry',
      category: 'note',
      importance: 50,
    });
    showToast('Memory saved ✓', false);
    refreshAll();
  } catch (err) {
    showError('Save failed: ' + err.message);
  }
}

// ── Render memory cards ───────────────────────────
function renderCards(layer, container) {
  const list = memories[layer] || [];
  const el = document.getElementById(container);
  const emptyEl = document.getElementById(layer === 'long_term' ? 'lt-empty' : 'st-empty');

  if (!list.length) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  el.innerHTML = list.map(m => cardHtml(m, layer)).join('');
  el.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions')) return;
      card.classList.toggle('expanded');
    });
  });
}

function cardHtml(m, layer) {
  const imp = m.importance >= 80 ? 'high' : m.importance >= 50 ? 'med' : 'low';
  const date = new Date(m.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const facts = (m.key_facts || [])
    .map(f => '<li>' + esc(f) + '</li>').join('');

  const actions = [];
  if (layer === 'short_term') {
    actions.push('<button class="promote-btn" data-action="promote" data-id="' + m.id + '">⬆ Promote</button>');
  }
  actions.push('<button class="delete-btn" data-action="delete" data-id="' + m.id + '">✕ Delete</button>');

  return '<div class="memory-card" data-id="' + m.id + '">'
    + '<div class="card-header">'
    + '<div class="card-importance imp-' + imp + '"></div>'
    + '<div class="card-body">'
    + '<div class="card-title">' + esc(m.title || 'Untitled') + '</div>'
    + '<div class="card-meta">'
    + '<span class="layer-badge layer-' + m.layer + '">' + m.layer.replace('_', '-') + '</span>'
    + '<span>' + esc(m.category || '') + '</span>'
    + '<span>imp:' + m.importance + '</span>'
    + '<span>' + date + '</span>'
    + '</div></div></div>'
    + '<div class="card-expand">'
    + '<div class="content-text">' + esc(m.content || m.summary || '') + '</div>'
    + (facts ? '<ul class="facts-list">' + facts + '</ul>' : '')
    + '<div class="card-actions">' + actions.join('') + '</div>'
    + '</div></div>';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Search results ────────────────────────────────
function renderSearchResults(data) {
  const el = document.getElementById('search-results');
  const emptyEl = document.getElementById('search-empty');
  const list = data.memories || [];
  if (!list.length) {
    el.innerHTML = '';
    emptyEl.style.display = '';
    emptyEl.querySelector('.emoji').textContent = '🔍';
    emptyEl.querySelector('div:last-child').textContent = 'No results for "' + (data.query || '') + '"';
    return;
  }
  emptyEl.style.display = 'none';
  el.innerHTML = list.map(m => cardHtml(m, m.layer)).join('');
  el.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-actions')) return;
      card.classList.toggle('expanded');
    });
  });
}

// ── Pin form + rendering ──────────────────────────
function togglePinForm() {
  const f = document.getElementById('pin-form');
  const arrow = document.getElementById('pin-form-arrow');
  if (f.style.display === 'none') {
    f.style.display = '';
    arrow.textContent = '▾';
  } else {
    f.style.display = 'none';
    arrow.textContent = '▸';
    clearPinForm();
  }
}

function clearPinForm() {
  document.getElementById('pin-title').value = '';
  document.getElementById('pin-content').value = '';
  document.getElementById('pin-category').value = 'note';
  document.getElementById('pin-project').value = '';
  delete document.getElementById('pin-form').dataset.editId;
  document.querySelector('.pin-save-btn').textContent = '📌 Pin It';
}

async function savePin() {
  const title   = document.getElementById('pin-title').value.trim();
  const content = document.getElementById('pin-content').value.trim();
  const category = document.getElementById('pin-category').value;
  const project  = document.getElementById('pin-project').value.trim() || null;
  const editId   = document.getElementById('pin-form').dataset.editId;

  if (!title) { showError('Title is required'); return; }
  if (!content) { showError('Content/value is required'); return; }

  try {
    if (editId) {
      await api('PATCH', `/memories/${editId}`, { title, content });
      showToast('💾 Pin updated ✓', false);
    } else {
      await api('POST', '/memories', {
        content,
        layer: 'pinned',
        title,
        category,
        importance: 100,
        ...(project ? { project } : {}),
      });
      showToast('📌 Pinned ✓', false);
    }
    togglePinForm();
    loadPins();
  } catch (err) {
    showError('Pin failed: ' + err.message);
  }
}

function editPin(id) {
  const mem = pinnedMemories.find(m => m.id === id);
  if (!mem) return;

  const f = document.getElementById('pin-form');
  f.style.display = '';
  f.dataset.editId = '' + id;
  document.getElementById('pin-form-arrow').textContent = '▾';
  document.getElementById('pin-title').value   = mem.title || '';
  document.getElementById('pin-content').value  = mem.content || '';
  document.getElementById('pin-category').value = mem.category || 'note';
  document.getElementById('pin-project').value  = mem.project || '';
  document.querySelector('.pin-save-btn').textContent = '💾 Update';
  document.getElementById('pin-title').focus();
}

const categoryIcons = {
  credential: '🔑', server: '🖥️', api_key: '🔐',
  config: '⚙️', identity: '👤', url: '🔗', note: '📝'
};

function renderPins() {
  const list = pinnedMemories;
  const el = document.getElementById('pin-list');
  const emptyEl = document.getElementById('pin-empty');
  document.getElementById('count-pin').textContent = list.length;

  if (!list.length) {
    el.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  el.innerHTML = list.map(m => {
    const icon = categoryIcons[m.category] || '📌';
    const date = new Date(m.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    });
    const proj = m.project ? '<span>📁 ' + esc(m.project) + '</span>' : '';

    return '<div class="pin-card" data-id="' + m.id + '">'
      + '<div style="display:flex;align-items:flex-start;gap:8px;">'
      + '<span class="pin-icon">' + icon + '</span>'
      + '<div class="pin-body">'
      + '<div class="pin-title">' + esc(m.title || 'Untitled') + '</div>'
      + '<div class="pin-value">' + esc((m.content || '').substring(0, 80)) + '</div>'
      + '<div class="pin-meta">'
      + '<span class="cat-badge">' + esc(m.category || 'note') + '</span>'
      + proj
      + '<span>' + date + '</span>'
      + '</div></div></div>'
      + '<div class="pin-expand">'
      + '<div class="full-content">' + esc(m.content || '') + '</div>'
      + '<div class="pin-actions">'
      + '<button data-action=\"edit-pin\" data-id=\"' + m.id + '\">✏️ Edit</button>'
      + '<button class=\"pin-delete-btn\" data-action=\"delete-pin\" data-id=\"' + m.id + '\">✕ Delete</button>'
      + '</div></div></div>';
  }).join('');
}

function togglePinCard(card) {
  card.classList.toggle('expanded');
}

// ── Context menu (right-click on Long-term) ───────
const ctxMenu = document.getElementById('ctx-menu');

document.querySelectorAll('.tab').forEach(tab => {
  if (tab.dataset.tab === 'long_term') {
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ctxMenu.style.left = e.pageX + 'px';
      ctxMenu.style.top = e.pageY + 'px';
      ctxMenu.classList.add('show');
    });
  }
});

document.getElementById('panel-long_term')?.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.memory-card')) return;
  e.preventDefault();
  ctxMenu.style.left = e.pageX + 'px';
  ctxMenu.style.top = e.pageY + 'px';
  ctxMenu.classList.add('show');
});

document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.tab[data-tab="long_term"]') && !e.target.closest('#panel-long_term')) {
    ctxMenu.classList.remove('show');
  }
});

// ── UI helpers ────────────────────────────────────
function setLoading(on) {
  document.getElementById('loading')?.classList.toggle('active', on);
}

function showError(text) {
  const el = document.getElementById('error-toast');
  el.textContent = text;
  el.style.background = '#f43f5e';
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); el.style.background = ''; }, 4000);
}

function showToast(text, isError) {
  const el = document.getElementById('error-toast');
  el.textContent = text;
  el.style.background = isError ? '#f43f5e' : '#10b981';
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); el.style.background = ''; }, 3000);
}
