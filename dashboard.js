// ─── State ──────────────────────────────────────────────────
let currentUser = null

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
    toast('Welcome to Sentra! Add your first child to get started.')
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

  await Promise.all([loadStats(), loadAlerts(), loadChildren()])
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

async function loadChildren() {
  const list   = $('#children-list')
  const sidebar = $('#sidebar-children')
  try {
    const { children } = await api('/family')
    if (!children.length) {
      list.innerHTML = '<div class="empty-state">No children added yet.<br>Click below to add your first child.</div>'
      sidebar.innerHTML = ''
      return
    }
    list.innerHTML = children.map(c => `
      <div class="child-row">
        <div class="child-avatar">${initials(c.name)}</div>
        <div class="child-info">
          <div class="child-name">${c.name}${c.age ? `, ${c.age}` : ''}</div>
          <div class="child-devices">${c.devices.length} device${c.devices.length !== 1 ? 's' : ''} connected</div>
        </div>
        <div class="child-score">—</div>
      </div>
    `).join('')

    sidebar.innerHTML = children.map(c => `
      <div class="nav-child-item">
        <span class="child-dot"></span>${c.name}
      </div>
    `).join('')
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

// ─── Mark all read ────────────────────────────────────────────
$('#mark-all-read').addEventListener('click', async () => {
  const unread = document.querySelectorAll('.alert-row:not(.read)')
  await Promise.all([...unread].map(row =>
    api(`/alerts/${row.dataset.id}/read`, { method: 'PATCH' })
  ))
  unread.forEach(row => row.classList.add('read'))
  loadStats()
})

// ─── Boot: check session ──────────────────────────────────────
;(async () => {
  try {
    const { user } = await api('/auth/me')
    currentUser = user
    showApp()
  } catch {
    showAuth('login')
  }
})()
