# 🥖 Bakery Kitchen Manager — Multi-Branch SaaS Edition

A complete baking kitchen management system with a marketing landing page, login, role-based permissions, multi-branch support, and a 14-day free trial → paid subscription flow. Built on Node.js + SQLite (pure JS, no native database dependency). Installable as a PWA.

---

## What's in this version

- 🏠 **Landing page** — marketing homepage with feature highlights and pricing, shown before login
- 🔐 **Login + password change** — every user, including the platform super admin, can change their own password from "My Account"
- 📱 **Fixed mobile navigation** — sidebar now slides in/out correctly on phones; all menu items are reachable
- 🏢 **Multi-branch support** — one kitchen admin can register several branches, each with fully separate stock, production, and sales (like independent sub-kitchens), all under one login
- ⏳ **14-day free trial** — countdown shown in the sidebar; once it expires, operational pages lock until payment is confirmed
- 💳 **M-Pesa-style billing flow** — kitchen submits a payment reference for their chosen plan; platform super admin reviews and confirms it, which activates the subscription for 30 days
- 📋 **4 pricing tiers** — Starter (999), Advanced (1999), Pro (2999), and a custom Enterprise tier, each with different branch/user limits and feature sets
- ✏️ **Editable records** — admins can edit past sales and production batches; stock is automatically recalculated to stay accurate
- 👥 **Team management** — kitchen admins create staff/manager accounts, assign them to a specific branch, and set granular per-page permissions

---

## Pricing tiers

| Tier | Price/month | Branches | Users | Notes |
|---|---|---|---|---|
| **Starter** | KES 999 | 1 | 1 | Dashboard, procurement, stock, production, sales, settings — no analytics |
| **Advanced** | KES 1999 | 2 | 2 | Everything in Starter + full analytics & P&L |
| **Pro** | KES 2999 | 5 | 10 | Everything in Advanced + consolidated multi-branch reports + data export |
| **Enterprise** | Custom | Custom | Custom | Everything in Pro + priority support — kitchen submits interest, platform owner follows up |

Every new kitchen starts on a **14-day free trial** with Starter-level branch/user limits but full feature access, so they can try everything before choosing a plan.

---

## First-time login (platform owner)

On first run, the server prints a seeded super-admin account to the console:

```
username: superadmin
password: admin123
```

**Log in immediately and go to "My Account" in the sidebar to change this password.** The password-change screen is available to every user, including the super admin — this was the main gap in the previous version and is now fixed.

The super admin's view (`/platform`) lists every kitchen on the platform, their plan, trial/subscription status, and any pending M-Pesa payment references — with one-click **Confirm** / **Reject** buttons.

---

## How the trial → paid flow works

1. A kitchen registers and gets a 14-day trial automatically (no card required)
2. The sidebar shows a countdown banner ("X days left in free trial")
3. At any point, the admin can go to **Billing & Plan** and choose Starter, Advanced, or Pro
4. They submit their M-Pesa (or other) payment reference number
5. The super admin reviews it on the **Platform** page and clicks **Confirm**
6. The kitchen's plan activates for 30 days, branch/user limits update immediately, and the trial banner disappears
7. If the trial expires *before* a plan is confirmed, all **operational pages** (dashboard data, procurement, stock, production, sales, analytics) return a friendly lock message — but **Billing, Settings, Branches, Users, and My Account stay accessible** so the kitchen can always find their way to pay and unlock.

---

## Branches — how they work

- Every kitchen starts with one **default branch** ("Main Branch") created automatically at signup
- Admins can add more branches from the **Branches** page, up to their plan's limit
- Each branch has **completely separate** raw materials, products, stock levels, purchases, production batches, and sales — exactly like running independent sub-kitchens under one login
- Admins see a **branch switcher** in the top bar to jump between branches
- Staff/manager accounts are assigned to one specific branch and only see that branch's data
- Deleting a branch removes all its data; the default branch can't be deleted

---

## Roles & permissions

| Role | Default access |
|---|---|
| **Admin** | Everything — all pages, can edit/delete any record, manage branches, manage team, manage billing |
| **Manager** | Dashboard, procurement, stock, production, sales, analytics (no settings, team, billing) |
| **Staff** | Dashboard, stock, sales only |

Defaults can be overridden per-user — admins tick/untick individual pages when creating or editing a team member, and assign them to a specific branch.

Only admins (and the super admin) can edit existing sales and production records — staff and managers can create new records but not modify history.

---

## Local setup

```bash
npm install
npm start
# Open http://localhost:3000
```

The database is a single SQLite file auto-created at `data/bakery.db` — no external database needed.

---

## Deploy to Render (free tier)

1. Push this project to a GitHub repository
2. [render.com](https://render.com) → **New → Web Service** → connect your repo
3. Render reads `render.yaml` automatically — click **Deploy**
4. Live at `https://your-app-name.onrender.com`

> Free tier sleeps after 15 min idle; first request after sleep takes ~30s to wake up.

---

## Deploy to Railway (free tier)

1. Push to GitHub
2. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
3. Add a **Volume** mounted at `/app/data` so the database persists across deploys
4. Deploy

---

## Deploy to Glitch (always free, simplest)

1. [glitch.com](https://glitch.com) → **New Project → Import from GitHub**
2. Paste your repo URL — Glitch builds and runs it automatically

---

## Install to homescreen (PWA)

**Android (Chrome):** open the app → tap ⋮ menu → *Add to Home screen* (or tap the **Install app** button in the top bar)

**iPhone (Safari):** open the app → tap Share → *Add to Home Screen* → *Add*

---

## Project structure

```
bakery-app/
├── server/
│   ├── index.js     # All API routes (auth, branches, billing, tenant data, platform admin)
│   ├── auth.js       # Sessions, password handling, permission + subscription-lock middleware
│   └── db.js         # SQLite schema, plan definitions, seed data, query helpers
├── public/
│   ├── index.html    # Landing page + login/register screen + app shell
│   ├── js/app.js      # Full frontend: landing, auth, branches, billing, RBAC nav, all pages
│   ├── css/app.css    # Styles incl. fixed mobile nav, landing page, pricing cards
│   ├── manifest.json  # PWA manifest
│   ├── sw.js           # Service worker
│   └── icons/          # PWA icons
├── render.yaml
├── railway.toml
└── package.json
```

---

## What changed since the last version (fixes you reported)

| Issue reported | Fix |
|---|---|
| No way to change password after login | Added "My Account" page accessible to every user, including super admin |
| No landing page before login | Added a full marketing homepage with features and pricing, shown before the login screen |
| Mobile menus not visible / navigation locked to dashboard only | Rebuilt sidebar CSS — it's `position: fixed` only inside the mobile breakpoint with a proper slide-in transform and a visible close button; toggling now works correctly on phones |
| No multi-branch support | Added full branch system — separate stock/production/sales per branch, branch switcher for admins, per-branch user assignment |
| No trial/billing system | Added 14-day trial, 4-tier pricing, M-Pesa-style payment reference submission, super-admin confirmation, automatic lockout enforcement (with billing/settings always reachable) |
| Sales & production not editable | Added edit buttons (admin-only) for both, with correct stock recalculation on edit |

---

## Security notes for going live

- Change the seeded `superadmin` password immediately — now possible directly via the UI
- Sessions are httpOnly cookies — not accessible to JavaScript
- Passwords are hashed with bcrypt (10 rounds)
- All tenant and branch data queries are scoped at the database layer (`kitchen_id` + `branch_id`), not just filtered in the UI
- Consider rate-limiting login attempts and adding HTTPS (most free hosts provide this automatically) before accepting real customer data

---

## Tech stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express |
| Database | SQLite via `sql.js` (pure JavaScript, no native compilation) |
| Auth | bcryptjs password hashing + httpOnly cookie sessions |
| Frontend | Vanilla JS + HTML + CSS (no framework, no build step) |
| PWA | Web App Manifest + Service Worker |
