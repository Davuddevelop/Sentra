# Sentra — Claude Co-Working Rules & Project Reference

---

## Who I Am

I'm Davud — 14, based in Baku, studying CS independently, building real startups.
My stack: React/Vite, Next.js, Tailwind CSS, Node.js, Python, Anthropic API, Vercel.
Long-term goal: Stanford / MIT for CS or AI.

Active projects: **Sentra** (this repo), **RivalScan**, **CampusSync**, **RevenueLeak**.
When switching projects, I'll say which one we're in.

---

## How You Must Work With Me

### The Core Rule

**Do NOT just write the code and hand it to me.**
I am learning CS. My brain must stay engaged. You are my co-worker and mentor, not a code machine.

### What You Should Do Instead

1. **Ask me questions first.** Before writing any non-trivial code, ask:
   - "What approach do you have in mind?"
   - "Do you know what data structure fits here?"
   - "What do you think the time complexity of this would be?"

2. **Make me think before you solve.** Give me a hint or a question first.
   Only write the full solution if I'm genuinely stuck after trying.

3. **Explain the "why", not just the "what".** When you do write code, cover:
   - Why this pattern over another
   - What tradeoffs exist
   - What a senior engineer would think

4. **Call out my mistakes directly.** No softening. I prefer honest feedback over flattery.

5. **Quiz me occasionally.** "Quick — what does this line actually do?" Keep me sharp.

6. **Don't over-engineer.** If I ask for something simple, ask first: "Do you want this scalable now, or keep it simple?"

### When You CAN Just Write Code

- Boilerplate / scaffolding I've already understood (e.g. "set up the Vite config")
- Repetitive patterns I've already demonstrated I know
- When I explicitly say: "Just write it, I understand this part"
- Bug fixes in code I didn't write (dependencies, configs, etc.)

### Tone

- Direct. No fluff.
- Treat me like a junior engineer who wants to become a senior one fast.
- Short explanations > long lectures. Ask if I want more depth.

---

## Sentra — Product Overview

**Sentra** is a parental intelligence platform for the AI age. It monitors how children interact with AI chatbots, apps, and online platforms — detecting risk through behavioral patterns, never message content.

**Core differentiator:** First platform with a dedicated AI-safety engine for chatbot monitoring (ChatGPT, Character.AI, Replika). Privacy-first: on-device analysis, no message reading.

**Target user:** Parents of children aged 6–17 overwhelmed by the AI-driven internet but not technical.

**Business model:** Freemium SaaS — Free (1 device) → Family $12/mo (5 devices) → Family+ $18/mo (unlimited).

---

## Design System

### Color Palette
```
--cream:       #F3EDDD   — primary background (warm parchment)
--cream-deep:  #EBE2CA   — section backgrounds (dashboard)
--cream-soft:  #F8F4E8   — card/screen backgrounds
--ink:         #1A2A22   — primary text, dark buttons, phone body
--ink-soft:    #3C4A42   — secondary text, nav links
--moss:        #2C5A3F   — primary brand/accent (CTAs, active states)
--moss-deep:   #1B3A27   — dark sections (spotlight), hover states
--moss-light:  #D9E5D1   — icon backgrounds, check badges
--terra:       #C85A2E   — warning/alert/featured badge accent
--terra-soft:  #E8C8B4   — terra on dark backgrounds
--paper:       #FBF7EB   — card backgrounds, elevated surfaces
--line:        rgba(26,42,34,0.14) — borders
--line-soft:   rgba(26,42,34,0.08) — subtle dividers
```

### Typography
- **Display / Headings:** Fraunces (variable: opsz 9–144, wght 300–800, SOFT 0–100)
  - Italic + weight 300 = signature "softer" emphasis style (used in `<em>` inside titles)
  - `font-variation-settings: "SOFT" 80` on hero italic
  - Letter-spacing: very tight (−2px hero, −1.5px h2, −0.5px cards)
- **Body / UI:** Inter (300, 400, 500, 600)
- **Scale:**
  - Hero h1: `clamp(44px, 6vw, 72px)` — line-height 1.02
  - Section h2: `clamp(34px, 4.5vw, 52px)` — line-height 1.05
  - Body lead: 18–19px — line-height 1.55
  - Card body: 14px — line-height 1.55
  - Labels/eyebrows: 11–13px, uppercase, letter-spacing 2–2.5px

### Spacing Rhythm
- Section padding: 90px vertical (60px for spotlight)
- Container: max-width 1200px, padding 0 32px
- Card padding: 32–36px
- Gap system: 20px (tight), 32px (medium), 60px (wide)

### Radius System
- Pills / badges: `border-radius: 100px`
- Cards: 24px
- Step cards: 20px
- Phone: 44px outer / 34px inner screen
- Icon boxes: 14px
- Alert items: 14px

### Border / Elevation
- Most borders: `0.5px solid var(--line-soft)` — very subtle
- Problem section uses `1px solid var(--ink)` — intentionally harsh/editorial
- Shadow pattern: multi-layer with negative spread (e.g., `0 40px 80px -30px ...`)
- No heavy drop shadows — low-opacity, blurred, offset only

### Motion / Animation
- Hover transforms: `translateY(-1px)` on primary button, `translateY(-3px)` on feature cards
- Transitions: 0.2–0.3s, `ease`
- Pulse animation on hero eyebrow dot: 2s infinite opacity pulse
- FAQ accordion: CSS `display: none/block` toggle (no animation currently)
- Nav: `backdrop-filter: blur(12px)` frosted glass

---

## Page Sections (in order)

1. **Nav** — sticky, frosted glass, logo + links + CTA pill
2. **Hero** — 2-col grid: copy left, phone mockup right; floating badge cards; eyebrow pill with pulse dot
3. **Problem** — paper bg, 4-col stat grid with editorial top-border rule
4. **Features** — auto-fit grid, first card `span 2` dark featured card
5. **AI Spotlight** — full dark rounded card, 2-col, numbered list
6. **How It Works** — 4-col step cards with large italic Fraunces numbers
7. **Dashboard Preview** — cream-deep bg, browser chrome mockup with sidebar + stats
8. **Pricing** — 3-col, center card dark featured with terra badge
9. **Trust** — moss-deep bg, 6-cell grid separated by 1px rgba lines
10. **FAQ** — accordion, max-width 780px, Fraunces question text
11. **Final CTA** — centered, large headline, same CTAs as hero
12. **Footer** — ink bg, 4-col grid (brand + 3 link columns)

---

## Component Inventory

| Component | Class(es) | Notes |
|---|---|---|
| Eyebrow label | `.section-eyebrow` | 12px uppercase, moss color |
| Section title | `h2.section-title` | Fraunces, clamp, tight tracking |
| Section lead | `.section-lead` | 18px, ink-soft, max-w 620px |
| Primary button | `.btn-primary` | Ink bg, pill, hover moss-deep |
| Secondary button | `.btn-secondary` | Ghost, pill, hover paper |
| Nav CTA | `.nav-cta` | Moss bg, pill, smaller |
| Feature card | `.feature-card` | Paper bg, 24px radius, hover lift |
| Feature card (featured) | `.feature-card.featured` | Moss-deep bg, span-2 |
| Price card | `.price-card` | Paper bg |
| Price card (featured) | `.price-card.featured` | Ink bg, terra badge |
| Trust item | `.trust-item` | Moss-deep bg, 1px rgba grid lines |
| FAQ item | `.faq-item` | Accordion toggle via `.open` class |
| Dashboard mockup | `.dashboard-mockup` | Browser chrome + sidebar + main |
| Phone mockup | `.phone` | CSS-only, ink frame, cream screen |
| Float badge | `.hero-badge-float` | Paper bg, absolute position, hidden mobile |
| Alert pill | `.dash-activity-pill` | `.pill-warn` / `.pill-info` / `.pill-ok` |
| Step card | `.step-card` | Paper bg, large italic number |

---

## Current Tech Stack

- **Pure HTML/CSS/JS** — single `index.html`, no build system
- **Fonts:** Google Fonts (Fraunces variable + Inter)
- **Icons:** Inline SVG only (no icon library)
- **JS:** Minimal inline — only FAQ accordion (`classList.toggle`) and alert buttons
- **No framework, no bundler, no animations library**

### Development Tooling (installed)

- **Vite** — dev server with HMR, build output
- **GSAP** — professional-grade scroll animations and micro-interactions
- **Lenis** — smooth scroll (pairs with GSAP ScrollTrigger)
- **stylelint** — CSS linting with standard config

---

## Design Language Notes

- **Calm technology** — no bright reds, no urgency patterns outside terra accents on actual alerts.
- **Editorial feel** — problem stat grid uses harsh `var(--ink)` top border, like a magazine pull-stat.
- **Softness via typography** — Fraunces SOFT axis + italic weight 300 on `<em>` creates warmth. Never use Fraunces bold + italic together.
- **Hierarchy signal:** eyebrow → title → lead → content. Used on every section.
- **Ink-on-cream** preferred over pure black-on-white — every color has warmth.
- **Buttons always pill-shaped** (`border-radius: 100px`) — no square corners anywhere.
- **0.5px borders everywhere** — feels premium on high-DPI screens.
- **Dark sections** use ink `#1A2A22` or moss-deep `#1B3A27`, never pure black.

---

## Breakpoints

| Breakpoint | Behavior |
|---|---|
| `max-width: 900px` | Hero collapses to 1 col; float badges hidden |
| `max-width: 760px` | Nav links hidden (CTA only); footer 2-col; spotlight 1-col; featured card loses span-2; dashboard sidebar stacks |
| `max-width: 480px` | How-it-works steps go 1-col |

---

## What's Missing / Next Steps

- **Animations** — scroll-triggered reveals (GSAP + ScrollTrigger)
- **Smooth scroll** — Lenis to replace native `scroll-behavior: smooth`
- **Mobile nav** — hamburger menu for sub-760px
- **FAQ animation** — slide-down transition instead of snap show/hide
- **Video modal** — "Watch 90-second demo" button has no target
- **Form / waitlist** — CTAs currently use `alert()` placeholders
- **Micro-interactions** — phone mockup could animate alerts, badge floats could animate in
