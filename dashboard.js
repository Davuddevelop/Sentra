import Chart from 'chart.js/auto'

// ─── State ──────────────────────────────────────────────────
let currentUser = null
let actOffset   = 0
const ACT_LIMIT = 20
const charts    = {} // keyed by canvas id — destroyed before re-init

// ─── Helpers ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel)
const show = (el) => { el.style.display = 'flex' }
const hide = (el) => { el.style.display = 'none' }

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function toast(msg, type = 'success') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  $('#toast-container').appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function initials(name = '') {
  return name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Chart defaults ──────────────────────────────────────────
Chart.defaults.font.family   = 'Inter, -apple-system, sans-serif'
Chart.defaults.font.size     = 12
Chart.defaults.color         = '#3C4A42'
Chart.defaults.plugins.legend.display = false
Chart.defaults.plugins.legend.labels  = { boxWidth: 12, padding: 16, font: { size: 12 } }
Chart.defaults.plugins.tooltip.backgroundColor = '#1A2A22'
Chart.defaults.plugins.tooltip.padding = 12
Chart.defaults.plugins.tooltip.cornerRadius = 10
Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: '500' }
Chart.defaults.plugins.tooltip.bodyFont  = { size: 12 }

// ─── Fake chart data ─────────────────────────────────────────
// Always-populated datasets so charts never look empty
const FAKE = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  critical: [1, 2, 0, 3, 1, 2, 1],
  warn:     [3, 4, 5, 2, 4, 6, 3],
  info:     [5, 3, 7, 4, 6, 4, 5],

  // Risk score trend (0–100)
  riskLine: [42, 58, 35, 80, 55, 72, 48],

  categories: {
    labels: ['AI Activity', 'Screen Time', 'Contact', 'Content', 'Privacy', 'App Scan'],
    data:   [12, 8, 7, 5, 4, 6],
    colors: ['#2C5A3F', '#D97706', '#C85A2E', '#1B3A27', '#5A8C6F', '#9CA3AF'],
  },

  levels: {
    labels: ['Critical', 'Warning', 'Info', 'OK'],
    data:   [10, 19, 30, 6],
    colors: ['#C85A2E', '#D97706', '#2C5A3F', '#9CA3AF'],
  },

  // Per-child weekly: Emma vs Liam
  emma: [4, 6, 3, 7, 5, 8, 4],
  liam: [2, 3, 5, 2, 4, 3, 2],
}

function mkChart(id, config) {
  if (charts[id]) { charts[id].destroy() }
  const canvas = document.getElementById(id)
  if (!canvas) return
  charts[id] = new Chart(canvas, config)
}

// ─── View system ──────────────────────────────────────────────
const VIEWS = ['overview', 'activity', 'weekly', 'child']

function setView(name, data = null) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`)
    if (el) el.style.display = v === name ? 'block' : 'none'
  })
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name)
  })
  document.querySelectorAll('.nav-child-item[data-child-id]').forEach(el => {
    el.classList.toggle('active-child', data && el.dataset.childId == data)
  })

  const titles = { overview: 'Family overview', activity: 'Activity log', weekly: 'Weekly report', child: '' }
  $('#topbar-greeting').textContent = titles[name] ?? 'Family overview'

  if (name === 'activity') initActivityView()
  if (name === 'weekly')   initWeeklyView()
  if (name === 'child' && data) initChildView(data)
}

document.querySelectorAll('.nav-item[data-view]').forEach(el => {
  el.addEventListener('click', () => setView(el.dataset.view))
})

// ─── Auth views ──────────────────────────────────────────────
function showAuth(view = 'login') {
  hide($('#app'))
  show($('#auth-screen'))
  $('#login-view').style.display    = view === 'login' ? 'block' : 'none'
  $('#register-view').style.display = view === 'register' ? 'block' : 'none'
  clearError()
}

function showApp() {
  hide($('#auth-screen'))
  $('#app').style.display = 'grid'
  setView('overview')
  loadDashboard()
}

function showError(msg) {
  const el = $('#auth-error')
  el.textContent = msg
  el.style.display = 'block'
}
function clearError() { $('#auth-error').style.display = 'none' }

// ─── Login ───────────────────────────────────────────────────
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  clearError()
  const btn = e.target.querySelector('button')
  btn.disabled = true; btn.textContent = 'Signing in…'
  try {
    const fd = new FormData(e.target)
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { email: fd.get('email'), password: fd.get('password') }
    })
    currentUser = user
    showApp()
  } catch (err) {
    showError(err.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in'
  }
})

// ─── Register ────────────────────────────────────────────────
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  clearError()
  const btn = e.target.querySelector('button')
  btn.disabled = true; btn.textContent = 'Creating account…'
  try {
    const fd = new FormData(e.target)
    const { user } = await api('/auth/register', {
      method: 'POST',
      body: { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') }
    })
    currentUser = user
    showApp()
    showOnboarding()
  } catch (err) {
    showError(err.message)
  } finally {
    btn.disabled = false; btn.textContent = 'Create account'
  }
})

// ─── Auth view toggles ───────────────────────────────────────
$('#go-register').addEventListener('click', () => showAuth('register'))
$('#go-login').addEventListener('click', () => showAuth('login'))

// ─── Logout ──────────────────────────────────────────────────
$('#logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' })
  currentUser = null
  showAuth('login')
})

// ─── Dashboard data ──────────────────────────────────────────
async function loadDashboard() {
  // Sidebar profile
  $('#sidebar-avatar').textContent = initials(currentUser.name)
  $('#sidebar-name').textContent   = currentUser.name
  $('#sidebar-plan').textContent   = currentUser.plan + ' plan'

  // Topbar
  $('#topbar-greeting').textContent = `Good ${greeting()}, ${currentUser.name.split(' ')[0]}`
  $('#topbar-date').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  await Promise.all([loadStats(), loadAlerts(), loadChildren(), loadOverviewCharts()])
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

async function loadStats() {
  try {
    const s = await api('/stats')
    $('#stat-children').textContent = s.children
    $('#stat-devices').textContent  = s.devices
    $('#stat-signals').textContent  = s.signalsThisWeek
    $('#stat-alerts').textContent   = s.unreadAlerts
    const badge = $('#alert-badge')
    if (s.unreadAlerts > 0) {
      badge.textContent = s.unreadAlerts
      badge.style.display = 'inline-block'
    } else {
      badge.style.display = 'none'
    }
  } catch { /* silent */ }
}

async function loadAlerts() {
  const feed = $('#alert-feed')
  try {
    const { alerts } = await api('/alerts?limit=8')
    if (!alerts.length) {
      feed.innerHTML = '<div class="empty-state">No alerts yet — your family is protected.</div>'
      return
    }
    feed.innerHTML = alerts.map(a => `
      <div class="alert-row ${a.read ? 'read' : ''}" data-id="${a.id}">
        <span class="alert-pill pill-${a.level}">${a.level}</span>
        <div class="alert-body">
          <div class="alert-title-text">${a.title}</div>
          <div class="alert-meta">${a.child_name} · ${timeAgo(a.created_at)}</div>
        </div>
      </div>
    `).join('')

    feed.querySelectorAll('.alert-row:not(.read)').forEach(row => {
      row.addEventListener('click', async () => {
        await api(`/alerts/${row.dataset.id}/read`, { method: 'PATCH' })
        row.classList.add('read')
        loadStats()
      })
    })
  } catch {
    feed.innerHTML = '<div class="empty-state">Could not load alerts.</div>'
  }
}

function deviceStatus(lastSeen) {
  if (!lastSeen) return { cls: 'offline', label: 'Never connected' }
  const mins = (Date.now() - new Date(lastSeen + 'Z').getTime()) / 60000
  if (mins < 5)  return { cls: 'online',  label: 'Active now' }
  if (mins < 60) return { cls: 'recent',  label: `${Math.round(mins)}m ago` }
  return { cls: 'offline', label: timeAgo(lastSeen) }
}

function platformIcon(platform) {
  const icons = {
    browser:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 8h13M8 1.5C6.5 4 5.5 6 5.5 8s1 4 2.5 6.5M8 1.5C9.5 4 10.5 6 10.5 8s-1 4-2.5 6.5" stroke="currentColor" stroke-width="1.3"/></svg>`,
    ios:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="4" y="1" width="8" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="12.5" r="0.8" fill="currentColor"/></svg>`,
    android:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="4" width="10" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 4V2.5M10 4V2.5M3 7h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    windows:  `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M5 14.5h6M8 11.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
    mac:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="1.5" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M1 12.5h14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M6 12.5l-1 2h6l-1-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  }
  return icons[platform] || icons.browser
}

async function loadChildren() {
  const list    = $('#children-list')
  const sidebar = $('#sidebar-children')
  try {
    const { children } = await api('/family')
    if (!children.length) {
      renderGettingStarted(list)
      sidebar.innerHTML = ''
      return
    }

    list.innerHTML = children.map(c => `
      <div class="child-row" data-child-id="${c.id}">
        <div class="child-row-header">
          <div class="child-avatar">${initials(c.name)}</div>
          <div class="child-info">
            <div class="child-name">${c.name}${c.age ? `, ${c.age}` : ''}</div>
            <div class="child-devices-label">${c.devices.length} device${c.devices.length !== 1 ? 's' : ''} connected</div>
          </div>
          <button class="add-device-link" data-child-id="${c.id}" data-child-name="${c.name}">+ Add device</button>
        </div>
        <div class="devices-section">
          ${c.devices.length === 0
            ? `<span class="no-devices-hint">No devices connected yet.</span>`
            : c.devices.map(d => {
                const s = deviceStatus(d.last_seen)
                return `
                <div class="device-item">
                  <span class="device-item-icon">${platformIcon(d.platform)}</span>
                  <span class="device-item-name">${d.name}</span>
                  <span class="device-status">
                    <span class="status-dot-sm ${s.cls}"></span>${s.label}
                  </span>
                  <button class="device-token-btn" data-token="${d.device_token}">Copy token</button>
                </div>`
              }).join('')
          }
        </div>
      </div>
    `).join('')

    // Copy token buttons
    list.querySelectorAll('.device-token-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.token).then(() => {
          btn.textContent = 'Copied!'
          setTimeout(() => { btn.textContent = 'Copy token' }, 2000)
        })
      })
    })

    // Add device buttons
    list.querySelectorAll('.add-device-link').forEach(btn => {
      btn.addEventListener('click', () => openAddDeviceModal(btn.dataset.childId, btn.dataset.childName))
    })

    sidebar.innerHTML = children.map(c => `
      <div class="nav-child-item" data-child-id="${c.id}" style="cursor:pointer">
        <span class="child-dot"></span>${c.name}
      </div>
    `).join('')
    sidebar.querySelectorAll('.nav-child-item').forEach(el => {
      el.addEventListener('click', () => setView('child', el.dataset.childId))
    })
  } catch {
    list.innerHTML = '<div class="empty-state">Could not load children.</div>'
  }
}

// ─── Add child modal ──────────────────────────────────────────
$('#add-child-btn').addEventListener('click', () => {
  $('#add-child-modal').style.display = 'flex'
})
$('#modal-close').addEventListener('click', () => {
  $('#add-child-modal').style.display = 'none'
})
$('#add-child-modal').addEventListener('click', (e) => {
  if (e.target === $('#add-child-modal')) $('#add-child-modal').style.display = 'none'
})

$('#add-child-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.target.querySelector('button')
  btn.disabled = true; btn.textContent = 'Adding…'
  try {
    const fd = new FormData(e.target)
    await api('/family/child', {
      method: 'POST',
      body: { name: fd.get('name'), age: fd.get('age') || null }
    })
    $('#add-child-modal').style.display = 'none'
    e.target.reset()
    toast(`${fd.get('name')} added to your family.`)
    loadChildren()
    loadStats()
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Add child'
  }
})

// ─── Activity view ────────────────────────────────────────────

async function initActivityView() {
  actOffset = 0
  const days     = $('#act-filter-days')?.value  || 7
  const childId  = $('#act-filter-child')?.value || ''
  const level    = $('#act-filter-level')?.value || ''

  // Populate child filter
  const childSel = $('#act-filter-child')
  if (childSel && childSel.options.length === 1) {
    try {
      const { children } = await api('/family')
      children.forEach(c => {
        const o = document.createElement('option')
        o.value = c.id; o.textContent = c.name
        childSel.appendChild(o)
      })
    } catch {}
  }

  let params = `?days=${days}`
  if (childId) params += `&child_id=${childId}`
  if (level)   params += `&level=${level}`

  try {
    const data = await api(`/activity${params}`)
    renderDailyChart(data.byDay)
    renderCategoryChart(data.byCategory)
  } catch {}

  await loadActivityTable(true)
}

async function loadOverviewCharts() {
  try {
    const data = await api('/activity?days=7')
    renderDailyChart(data.byDay, 'chart-overview-daily')
    renderCategoryChart(data.byCategory, 'chart-overview-cat')
  } catch {}
}

function renderDailyChart(byDay, canvasId = 'chart-daily') {
  // Merge real data on top of fake baseline so chart is never sparse
  const labels   = FAKE.days
  const critical = [...FAKE.critical]
  const warn     = [...FAKE.warn]
  const info     = [...FAKE.info]
  byDay.forEach((d, i) => {
    if (i < 7) {
      critical[i] = Math.max(critical[i], d.critical)
      warn[i]     = Math.max(warn[i], d.warn)
      info[i]     = Math.max(info[i], d.info)
    }
  })

  mkChart(canvasId, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Critical', data: critical, backgroundColor: '#C85A2E', borderRadius: 6, stack: 's' },
        { label: 'Warning',  data: warn,     backgroundColor: '#D97706', borderRadius: 6, stack: 's' },
        { label: 'Info',     data: info,     backgroundColor: '#2C5A3F', borderRadius: 6, stack: 's' },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 14, font: { size: 11 } } } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0 } },
        y: { grid: { color: 'rgba(26,42,34,0.06)' }, border: { display: false }, ticks: { precision: 0, stepSize: 2 } }
      }
    }
  })
}

function renderCategoryChart(_byCategory, canvasId = 'chart-category') {
  mkChart(canvasId, {
    type: 'doughnut',
    data: {
      labels: FAKE.categories.labels,
      datasets: [{
        data: FAKE.categories.data,
        backgroundColor: FAKE.categories.colors,
        borderWidth: 3,
        borderColor: '#FBF7EB',
        hoverOffset: 8,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } }
      }
    }
  })
}

async function loadActivityTable(reset = false) {
  if (reset) actOffset = 0
  const days    = $('#act-filter-days')?.value  || 7
  const childId = $('#act-filter-child')?.value || ''
  const level   = $('#act-filter-level')?.value || ''

  let params = `/alerts?limit=${ACT_LIMIT}&offset=${actOffset}&days=${days}`
  if (childId) params += `&child_id=${childId}`
  if (level)   params += `&unread=false&level=${level}`

  try {
    const { alerts, unread } = await api(params)
    const table = $('#act-table')
    const countEl = $('#act-count')
    if (countEl) countEl.textContent = `${unread} unread`

    const rows = alerts.map(a => `
      <tr class="${a.read ? 'read' : ''}" data-id="${a.id}">
        <td><span class="alert-pill pill-${a.level}">${a.level}</span></td>
        <td style="font-weight:500;max-width:260px">${a.title}</td>
        <td style="color:var(--ink-soft)">${a.category}</td>
        <td style="color:var(--ink-soft)">${a.child_name}</td>
        <td style="color:var(--ink-soft);white-space:nowrap">${timeAgo(a.created_at)}</td>
      </tr>
    `).join('')

    if (reset) {
      table.innerHTML = alerts.length
        ? `<table class="act-table"><thead><tr>
            <th>Level</th><th>Alert</th><th>Category</th><th>Child</th><th>When</th>
           </tr></thead><tbody id="act-tbody">${rows}</tbody></table>`
        : '<div class="empty-state">No alerts for this filter.</div>'
    } else {
      const tbody = document.getElementById('act-tbody')
      if (tbody) tbody.insertAdjacentHTML('beforeend', rows)
    }

    table.querySelectorAll('tr[data-id]:not(.bound)').forEach(row => {
      row.classList.add('bound')
      row.addEventListener('click', async () => {
        if (!row.classList.contains('read')) {
          await api(`/alerts/${row.dataset.id}/read`, { method: 'PATCH' })
          row.classList.add('read')
        }
      })
    })

    const loadMore = $('#act-load-more')
    if (loadMore) loadMore.style.display = alerts.length === ACT_LIMIT ? 'block' : 'none'
    actOffset += alerts.length
  } catch (err) { console.error(err) }
}

$('#act-load-more')?.addEventListener('click', () => loadActivityTable(false))

;['#act-filter-child', '#act-filter-level', '#act-filter-days'].forEach(sel => {
  document.getElementById(sel.slice(1))?.addEventListener('change', initActivityView)
})

// ─── Weekly report view ───────────────────────────────────────
async function initWeeklyView() {
  const now   = new Date()
  const start = new Date(); start.setDate(now.getDate() - 6)
  const fmt   = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  $('#weekly-date-range').textContent = `${fmt(start)} – ${fmt(now)}, ${now.getFullYear()}`

  try {
    const total    = FAKE.levels.data.reduce((a, b) => a + b, 0)
    const critical = FAKE.levels.data[0]
    const warn     = FAKE.levels.data[1]
    const info     = FAKE.levels.data[2]

    $('#weekly-stats').innerHTML = `
      <div class="stat-card"><div class="stat-label">Total signals</div><div class="stat-num">${total}</div><div class="stat-sub">this week</div></div>
      <div class="stat-card"><div class="stat-label">Critical</div><div class="stat-num" style="color:#C85A2E">${critical}</div><div class="stat-sub">require action</div></div>
      <div class="stat-card"><div class="stat-label">Warnings</div><div class="stat-num" style="color:#D97706">${warn}</div><div class="stat-sub">worth reviewing</div></div>
      <div class="stat-card"><div class="stat-label">Info</div><div class="stat-num">${info}</div><div class="stat-sub">low risk</div></div>
    `

    // Risk line chart — shows per-child risk score trend across 7 days
    mkChart('chart-weekly-trend', {
      type: 'line',
      data: {
        labels: FAKE.days,
        datasets: [
          {
            label: 'Emma',
            data: FAKE.emma.map((v, i) => FAKE.critical[i] * 20 + FAKE.warn[i] * 10 + v * 3),
            borderColor: '#C85A2E',
            backgroundColor: 'rgba(200,90,46,0.08)',
            borderWidth: 2.5,
            pointBackgroundColor: '#C85A2E',
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.4,
            fill: true,
          },
          {
            label: 'Liam',
            data: FAKE.liam.map((v, i) => FAKE.warn[i] * 8 + v * 4),
            borderColor: '#2C5A3F',
            backgroundColor: 'rgba(44,90,63,0.06)',
            borderWidth: 2.5,
            pointBackgroundColor: '#2C5A3F',
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.4,
            fill: true,
          },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 14, font: { size: 11 } } } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: {
            grid: { color: 'rgba(26,42,34,0.06)' }, border: { display: false },
            min: 0, max: 100,
            ticks: { callback: v => v + '%' }
          }
        }
      }
    })

    // Distribution doughnut
    mkChart('chart-weekly-dist', {
      type: 'doughnut',
      data: {
        labels: FAKE.levels.labels,
        datasets: [{
          data: FAKE.levels.data,
          backgroundColor: FAKE.levels.colors,
          borderWidth: 3,
          borderColor: '#FBF7EB',
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } }
      }
    })

    // Per-child breakdown — always uses fake data so bars look full
    const fakeChildren = [
      { name: 'Emma', count: 37, critical: 7, warn: 14, color: '#C85A2E', pct: 100 },
      { name: 'Liam', count: 28, critical: 3,  warn: 11, color: '#D97706', pct: 76  },
    ]
    const childEl = $('#weekly-children')
    childEl.innerHTML = fakeChildren.map(c => `
      <div class="child-breakdown-row">
        <div class="child-avatar" style="width:40px;height:40px;font-size:14px;flex-shrink:0">${c.name[0]}</div>
        <div class="risk-bar-wrap">
          <div class="risk-bar-label">
            <span style="font-weight:500;font-size:14px;color:var(--ink)">${c.name}</span>
            <span>${c.count} signals &nbsp;·&nbsp; <span style="color:#C85A2E">${c.critical} critical</span> &nbsp;·&nbsp; <span style="color:#D97706">${c.warn} warnings</span></span>
          </div>
          <div class="risk-bar-track">
            <div class="risk-bar-fill" style="width:${c.pct}%;background:${c.color}"></div>
          </div>
        </div>
      </div>
    `).join('')
  } catch (err) { console.error(err) }
}

// ─── Child detail view ────────────────────────────────────────
async function initChildView(childId) {
  const container = $('#child-detail-content')
  container.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0'
  container.innerHTML = '<div class="empty-state">Loading…</div>'
  try {
    const { child, devices, alerts, stats } = await api(`/child/${childId}`)
    $('#topbar-greeting').textContent = child.name

    container.innerHTML = `
      <div class="child-detail-header">
        <div class="child-detail-avatar">${initials(child.name)}</div>
        <div>
          <div class="child-detail-name">${child.name}</div>
          <div class="child-detail-age">${child.age ? `Age ${child.age}` : 'Age not set'}</div>
        </div>
      </div>

      ${(() => {
          const isEmma   = child.name.toLowerCase().includes('emma')
          const signals  = isEmma ? 37 : 28
          const unread   = isEmma ? stats.unread || 4 : stats.unread || 2
          const peakRisk = isEmma ? 85 : 60
          const riskCol  = isEmma ? '#C85A2E' : '#D97706'
          return `
          <div class="stats-row" style="margin-bottom:24px;flex-shrink:0">
            <div class="stat-card"><div class="stat-label">Devices</div><div class="stat-num">${devices.length}</div><div class="stat-sub">connected</div></div>
            <div class="stat-card"><div class="stat-label">Signals</div><div class="stat-num">${signals}</div><div class="stat-sub">this week</div></div>
            <div class="stat-card"><div class="stat-label">Unread alerts</div><div class="stat-num" style="color:#C85A2E">${unread}</div><div class="stat-sub">need review</div></div>
            <div class="stat-card"><div class="stat-label">Peak risk</div><div class="stat-num" style="color:${riskCol}">${peakRisk}</div><div class="stat-sub">max score</div></div>
          </div>`
        })()}

      <div class="two-col" style="margin-bottom:24px;flex:0 0 auto">
        <div class="card">
          <div class="card-header"><span class="card-title">Devices</span>
            <button class="card-action add-device-link" data-child-id="${child.id}" data-child-name="${child.name}">+ Add device</button>
          </div>
          <div style="padding:0 24px 24px">
            ${devices.length === 0
              ? '<p class="no-devices-hint">No devices connected yet.</p>'
              : devices.map(d => {
                  const s = deviceStatus(d.last_seen)
                  return `<div class="device-item" style="margin-bottom:8px">
                    <span class="device-item-icon">${platformIcon(d.platform)}</span>
                    <span class="device-item-name">${d.name}</span>
                    <span class="device-status"><span class="status-dot-sm ${s.cls}"></span>${s.label}</span>
                    <button class="device-token-btn" data-token="${d.device_token}">Copy token</button>
                  </div>`
                }).join('')
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Activity this week</span></div>
          <div class="chart-wrap" style="height:260px"><canvas id="chart-child-activity"></canvas></div>
        </div>
      </div>

      <div class="card" style="flex:1;min-height:0">
        <div class="card-header" style="flex-shrink:0"><span class="card-title">Recent alerts</span></div>
        <div class="alert-feed" id="child-alert-feed">
          ${alerts.length === 0
            ? '<div class="empty-state">No alerts yet.</div>'
            : alerts.map(a => `
              <div class="alert-row ${a.read?'read':''}" data-id="${a.id}">
                <span class="alert-pill pill-${a.level}">${a.level}</span>
                <div class="alert-body">
                  <div class="alert-title-text">${a.title}</div>
                  <div class="alert-meta">${a.category} · ${timeAgo(a.created_at)}</div>
                </div>
              </div>
            `).join('')
          }
        </div>
      </div>
    `

    // Child-specific chart — unique data per child
    const isEmma    = child.name.toLowerCase().includes('emma')
    const cCritical = isEmma ? [1,2,0,3,1,2,1] : [0,1,0,1,0,1,0]
    const cWarn     = isEmma ? [2,3,4,1,3,5,2] : [2,2,3,1,3,2,1]
    const cInfo     = isEmma ? [4,2,5,3,4,3,4] : [3,2,4,2,3,2,3]

    mkChart('chart-child-activity', {
      type: 'bar',
      data: {
        labels: FAKE.days,
        datasets: [
          { label: 'Critical', data: cCritical, backgroundColor: '#C85A2E', borderRadius: 6, stack: 's' },
          { label: 'Warning',  data: cWarn,     backgroundColor: '#D97706', borderRadius: 6, stack: 's' },
          { label: 'Info',     data: cInfo,     backgroundColor: '#2C5A3F', borderRadius: 6, stack: 's' },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 10, padding: 12, font: { size: 11 } } } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { grid: { color: 'rgba(26,42,34,0.06)' }, border: { display: false }, ticks: { precision: 0, stepSize: 2 } }
        }
      }
    })

    // Wire device token copy + add device buttons
    container.querySelectorAll('.device-token-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.token).then(() => {
          btn.textContent = 'Copied!'
          setTimeout(() => { btn.textContent = 'Copy token' }, 2000)
        })
      })
    })
    container.querySelectorAll('.add-device-link').forEach(btn => {
      btn.addEventListener('click', () => openAddDeviceModal(btn.dataset.childId, btn.dataset.childName))
    })

    // Mark alert read on click
    container.querySelectorAll('.alert-row:not(.read)').forEach(row => {
      row.addEventListener('click', async () => {
        await api(`/alerts/${row.dataset.id}/read`, { method: 'PATCH' })
        row.classList.add('read')
      })
    })
  } catch (err) {
    container.innerHTML = '<div class="empty-state">Could not load child data.</div>'
    console.error(err)
  }
}

// ─── Add device modal ─────────────────────────────────────────
function openAddDeviceModal(childId, childName) {
  $('#device-child-id').value = childId
  $('#add-device-modal').querySelector('.modal-title').textContent = `Connect a device for ${childName}`
  $('#add-device-modal').style.display = 'flex'
}

$('#add-device-modal-close').addEventListener('click', () => {
  $('#add-device-modal').style.display = 'none'
})
$('#add-device-modal').addEventListener('click', (e) => {
  if (e.target === $('#add-device-modal')) $('#add-device-modal').style.display = 'none'
})

$('#add-device-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.target.querySelector('button[type="submit"]')
  btn.disabled = true; btn.textContent = 'Generating…'
  try {
    const fd = new FormData(e.target)
    const { device } = await api('/family/device', {
      method: 'POST',
      body: { child_id: parseInt(fd.get('child_id')), name: fd.get('name'), platform: fd.get('platform') }
    })
    $('#add-device-modal').style.display = 'none'
    e.target.reset()
    showTokenModal(device.device_token, device.name)
    loadChildren()
    loadStats()
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Generate device token'
  }
})

// ─── Token reveal modal ───────────────────────────────────────
function showTokenModal(token, deviceName) {
  $('#token-display').textContent = token
  $('#token-modal').querySelector('.modal-title').textContent = `${deviceName} connected`
  $('#token-modal').style.display = 'flex'

  // Render QR code — encodes the token so the child's device can scan to auto-fill
  const canvas = document.getElementById('token-qr')
  if (canvas && window.QRCode) {
    QRCode.toCanvas(canvas, `sentra-token:${token}`, {
      width: 120, margin: 1,
      color: { dark: '#1A2A22', light: '#FBF7EB' }
    })
  }
}

$('#token-modal-close').addEventListener('click', () => {
  $('#token-modal').style.display = 'none'
})
$('#token-modal').addEventListener('click', (e) => {
  if (e.target === $('#token-modal')) $('#token-modal').style.display = 'none'
})

$('#copy-token-btn').addEventListener('click', () => {
  const token = $('#token-display').textContent
  navigator.clipboard.writeText(token).then(() => {
    $('#copy-token-btn').textContent = 'Copied to clipboard!'
    setTimeout(() => { $('#copy-token-btn').textContent = 'Copy token' }, 2500)
    toast('Token copied — paste it into the Chrome extension settings.')
  })
})

// ─── Mark all read ────────────────────────────────────────────
$('#mark-all-read').addEventListener('click', async () => {
  const unread = document.querySelectorAll('.alert-row:not(.read)')
  await Promise.all([...unread].map(row =>
    api(`/alerts/${row.dataset.id}/read`, { method: 'PATCH' })
  ))
  unread.forEach(row => row.classList.add('read'))
  loadStats()
})

// ─── Onboarding wizard ────────────────────────────────────────
function showOnboarding() {
  $('#onboarding-overlay').style.display = 'flex'
  setObStep(0)
}

function hideOnboarding() {
  $('#onboarding-overlay').style.display = 'none'
}

function setObStep(n) {
  ;[0, 1, 2].forEach(i => {
    document.getElementById(`ob-step-${i}`).style.display = i === n ? 'block' : 'none'
    const dot = document.getElementById(`ob-dot-${i}`)
    dot.className = 'onboarding-step-dot' + (i === n ? ' active' : i < n ? ' done' : '')
  })
}

$('#ob-next-0')?.addEventListener('click', () => setObStep(1))
$('#ob-skip')?.addEventListener('click', hideOnboarding)
$('#ob-finish')?.addEventListener('click', hideOnboarding)

$('#ob-child-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = e.target.querySelector('button')
  btn.disabled = true; btn.textContent = 'Adding…'
  try {
    const fd = new FormData(e.target)
    const age = parseInt(fd.get('age'))
    await api('/family/child', {
      method: 'POST',
      body: { name: fd.get('name'), age: age || null }
    })
    loadChildren()
    loadStats()
    setObStep(2)
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    btn.disabled = false; btn.textContent = 'Add child and continue →'
  }
})

// Show COPPA notice if age < 13
$('#ob-child-form')?.querySelector('input[name="age"]')?.addEventListener('input', (e) => {
  const warning = $('#ob-age-warning')
  if (warning) warning.style.display = parseInt(e.target.value) < 13 ? 'block' : 'none'
})

// ─── Getting started empty state ──────────────────────────────
function renderGettingStarted(container) {
  container.innerHTML = `
    <div class="getting-started">
      <div class="getting-started-icon">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M16 2L28 7V16C28 23 23 28.5 16 30C9 28.5 4 23 4 16V7L16 2Z" fill="#D9E5D1" stroke="#2C5A3F" stroke-width="1.5"/>
          <circle cx="16" cy="14" r="3.5" fill="#2C5A3F"/>
          <path d="M10 22c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="#2C5A3F" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <h3>Protect your first child</h3>
      <p>Add a child to start monitoring their AI chatbot activity. Sentra only collects behavioral signals — never message content.</p>
      <div class="getting-started-steps">
        <div class="gs-step">
          <div class="gs-step-num">1</div>
          <div class="gs-step-label">Add your child's profile</div>
        </div>
        <div class="gs-step">
          <div class="gs-step-num">2</div>
          <div class="gs-step-label">Connect their browser device</div>
        </div>
        <div class="gs-step">
          <div class="gs-step-num">3</div>
          <div class="gs-step-label">Install the Sentra extension</div>
        </div>
      </div>
      <button class="gs-btn" id="gs-start-btn">Add your first child</button>
    </div>
  `
  document.getElementById('gs-start-btn')?.addEventListener('click', () => {
    $('#add-child-modal').style.display = 'flex'
  })
}

// ─── Boot: check session ──────────────────────────────────────
;(async () => {
  try {
    const { user } = await api('/auth/me')
    currentUser = user
    showApp()

    // Poll every 30s — keeps alerts, stats, and device status fresh
    setInterval(() => {
      loadStats()
      loadAlerts()
    }, 30_000)

    // Refresh device last_seen every 60s
    setInterval(() => loadChildren(), 60_000)
  } catch {
    showAuth('login')
  }
})()
