import Lenis from '@studio-freight/lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// ─── Smooth Scroll ─────────────────────────────────────────────────────────────
const lenis = new Lenis({
  lerp: 0.1,
  smoothWheel: true,
  wheelMultiplier: 1,
  touchMultiplier: 2,
})

lenis.on('scroll', ScrollTrigger.update)

gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)

// ─── Hero Entrance ─────────────────────────────────────────────────────────────
const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' }, delay: 0.1 })
heroTl
  .from('.hero-eyebrow',         { y: 20, opacity: 0, duration: 0.6 })
  .from('.hero-title',           { y: 36, opacity: 0, duration: 0.85 }, '-=0.35')
  .from('.hero-sub',             { y: 22, opacity: 0, duration: 0.65 }, '-=0.55')
  .from('.hero-ctas',            { y: 18, opacity: 0, duration: 0.5  }, '-=0.45')
  .from('.hero-trust',           { y: 14, opacity: 0, duration: 0.5  }, '-=0.35')
  .from('.phone',                { y: 50, opacity: 0, scale: 0.94, duration: 1, ease: 'power4.out' }, 0.25)
  .from('.hero-badge-float.one', { x: -28, opacity: 0, duration: 0.6 }, 0.9)
  .from('.hero-badge-float.two', { x: 28, opacity: 0, duration: 0.6  }, 1.05)

// ─── Scroll Reveals ─────────────────────────────────────────────────────────────
function reveal(selector, extras = {}) {
  const els = document.querySelectorAll(selector)
  if (!els.length) return
  gsap.from(els, {
    scrollTrigger: { trigger: els[0], start: 'top 86%', once: true },
    y: 36, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.1,
    ...extras
  })
}

// Section headers — individual triggers so each fires at its own position
document.querySelectorAll('.section-eyebrow, h2.section-title, .section-lead').forEach(el => {
  gsap.from(el, {
    scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    y: 24, opacity: 0, duration: 0.65, ease: 'power3.out'
  })
})

reveal('.problem-item', { stagger: 0.13 })
reveal('.feature-card', { stagger: 0.08, y: 28 })
reveal('.spotlight-grid > div', { stagger: 0.15 })
reveal('.step-card', { stagger: 0.1 })
reveal('.dashboard-mockup', { y: 40, duration: 0.9 })
reveal('.dash-stat', { stagger: 0.09, y: 20 })
reveal('.price-card', { stagger: 0.11 })
reveal('.trust-item', { stagger: 0.07 })
reveal('.faq-item', { stagger: 0.06, y: 18 })

// Final CTA
gsap.from('.final-cta h2, .final-cta p, .final-cta .hero-ctas', {
  scrollTrigger: { trigger: '.final-cta', start: 'top 80%', once: true },
  y: 30, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.12
})

// ─── Mobile Nav ─────────────────────────────────────────────────────────────────
const mobileNavBtn     = document.getElementById('mobile-nav-btn')
const mobileNavOverlay = document.getElementById('mobile-nav-overlay')
const mobileNavClose   = document.getElementById('mobile-nav-close')

let navOpen = false

function openNav() {
  navOpen = true
  mobileNavOverlay.style.display = 'flex'
  document.body.style.overflow = 'hidden'
  mobileNavBtn.setAttribute('aria-expanded', 'true')
  gsap.fromTo(mobileNavOverlay, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' })
  gsap.fromTo('.mobile-nav-inner',
    { y: -16, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.32, ease: 'power3.out' }
  )
  gsap.from('.mobile-nav-link', {
    y: 14, opacity: 0, stagger: 0.055, delay: 0.1, duration: 0.35, ease: 'power3.out'
  })
}

function closeNav() {
  navOpen = false
  document.body.style.overflow = ''
  mobileNavBtn.setAttribute('aria-expanded', 'false')
  gsap.to(mobileNavOverlay, {
    opacity: 0, duration: 0.2, ease: 'power2.in',
    onComplete: () => { mobileNavOverlay.style.display = 'none' }
  })
}

mobileNavBtn?.addEventListener('click', () => navOpen ? closeNav() : openNav())
mobileNavClose?.addEventListener('click', closeNav)
mobileNavOverlay?.addEventListener('click', (e) => { if (e.target === mobileNavOverlay) closeNav() })
document.querySelectorAll('.mobile-nav-link[href]').forEach(l => l.addEventListener('click', closeNav))

// ─── Modal System ───────────────────────────────────────────────────────────────
function openModal(id) {
  const modal = document.getElementById(id)
  if (!modal) return
  modal.style.display = 'flex'
  document.body.style.overflow = 'hidden'
  gsap.fromTo(modal, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' })
  gsap.fromTo(modal.querySelector('.modal-box'),
    { scale: 0.95, y: 22, opacity: 0 },
    { scale: 1, y: 0, opacity: 1, duration: 0.38, ease: 'power3.out' }
  )
}

function closeModal(id) {
  const modal = document.getElementById(id)
  if (!modal) return
  gsap.to(modal, {
    opacity: 0, duration: 0.2, ease: 'power2.in',
    onComplete: () => { modal.style.display = 'none'; document.body.style.overflow = '' }
  })
}

// ── Auth tab switching ───────────────────────────────────────────────────────
function switchAuthTab(tab) {
  const tabReg = document.getElementById('tab-register')
  const tabLog = document.getElementById('tab-login')
  const panelReg = document.getElementById('auth-register')
  const panelLog = document.getElementById('auth-login')
  if (!tabReg) return
  if (tab === 'login') {
    tabReg.classList.remove('active'); tabLog.classList.add('active')
    panelReg.style.display = 'none'; panelLog.style.display = 'block'
  } else {
    tabLog.classList.remove('active'); tabReg.classList.add('active')
    panelLog.style.display = 'none'; panelReg.style.display = 'block'
  }
}
document.getElementById('tab-register')?.addEventListener('click', () => switchAuthTab('register'))
document.getElementById('tab-login')?.addEventListener('click', () => switchAuthTab('login'))
document.getElementById('switch-to-register')?.addEventListener('click', () => switchAuthTab('register'))

// Open from [data-modal] buttons
document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    const modalId = btn.dataset.modal
    if (modalId === 'auth-modal') {
      switchAuthTab(btn.dataset.tab === 'login' ? 'login' : 'register')
      if (btn.dataset.plan) {
        const sel = document.querySelector('#register-form [name="plan"]')
        if (sel) sel.value = btn.dataset.plan
      }
    }
    openModal(modalId)
  })
})

// Close from [data-close-modal] buttons and overlay click
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal))
})
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay.id) })
})

// Escape key
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  document.querySelectorAll('.modal-overlay').forEach(m => {
    if (m.style.display === 'flex') closeModal(m.id)
  })
  if (navOpen) closeNav()
})

// ─── FAQ Accordion ──────────────────────────────────────────────────────────────
document.querySelectorAll('.faq-item').forEach(item => {
  const answer = item.querySelector('.faq-a')
  // Override the CSS display:none; take control via height
  answer.style.cssText = 'display:block; overflow:hidden; height:0; opacity:0; margin-top:0;'

  item.addEventListener('click', () => {
    const isOpen = item.classList.contains('open')

    // Close currently open item (if different)
    document.querySelectorAll('.faq-item.open').forEach(openItem => {
      if (openItem === item) return
      openItem.classList.remove('open')
      const a = openItem.querySelector('.faq-a')
      gsap.to(a, { height: 0, opacity: 0, marginTop: 0, duration: 0.35, ease: 'power3.inOut' })
    })

    if (isOpen) {
      item.classList.remove('open')
      gsap.to(answer, { height: 0, opacity: 0, marginTop: 0, duration: 0.35, ease: 'power3.inOut' })
    } else {
      item.classList.add('open')
      // Measure natural height
      gsap.set(answer, { height: 'auto', opacity: 1, marginTop: 16 })
      const h = answer.offsetHeight
      gsap.fromTo(answer,
        { height: 0, opacity: 0, marginTop: 0 },
        { height: h, opacity: 1, marginTop: 16, duration: 0.45, ease: 'power3.out',
          onComplete: () => gsap.set(answer, { height: 'auto' }) }
      )
    }
  })
})

// ─── Toast ──────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  document.getElementById('toast-container').appendChild(toast)
  gsap.fromTo(toast, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' })
  setTimeout(() => {
    gsap.to(toast, {
      y: -8, opacity: 0, duration: 0.28,
      onComplete: () => toast.remove()
    })
  }, 4200)
}

// ─── Register ───────────────────────────────────────────────────────────────────
document.getElementById('register-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.currentTarget
  const btn  = document.getElementById('register-btn')
  const err  = document.getElementById('register-err')
  const name     = form.querySelector('[name="name"]').value.trim()
  const email    = form.querySelector('[name="email"]').value.trim()
  const password = form.querySelector('[name="password"]').value
  const plan     = form.querySelector('[name="plan"]').value

  btn.disabled = true; btn.textContent = 'Creating account...'
  err.style.display = 'none'

  try {
    const res  = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, plan }),
      credentials: 'include',
    })
    const data = await res.json()
    if (res.ok) {
      window.location.href = '/dashboard.html'
    } else {
      err.textContent = data.error || 'Registration failed. Please try again.'
      err.style.display = 'block'
    }
  } catch {
    err.textContent = 'Could not connect. Please try again.'
    err.style.display = 'block'
  } finally {
    btn.disabled = false; btn.textContent = 'Create account'
  }
})

// ─── Login ───────────────────────────────────────────────────────────────────────
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.currentTarget
  const btn  = document.getElementById('login-btn')
  const err  = document.getElementById('login-err')
  const email    = form.querySelector('[name="email"]').value.trim()
  const password = form.querySelector('[name="password"]').value

  btn.disabled = true; btn.textContent = 'Logging in...'
  err.style.display = 'none'

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    })
    const data = await res.json()
    if (res.ok) {
      window.location.href = '/dashboard.html'
    } else {
      err.textContent = data.error || 'Invalid email or password.'
      err.style.display = 'block'
    }
  } catch {
    err.textContent = 'Could not connect. Please try again.'
    err.style.display = 'block'
  } finally {
    btn.disabled = false; btn.textContent = 'Log in'
  }
})
