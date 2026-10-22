# Egan Hoops 🏀

A mobile-first pickup basketball web application for the weekly group at **Egan Junior High School** in Los Altos, CA.

Replaces chaotic weekly group text chains with an instant, zero-friction shared source of truth for gym schedule availability, real-time player attendance, and guest (+1) tracking.

---

## 🏀 Features

- **Zero-Friction Access**: Shared group link with no passwords or account creation needed. Players pick or enter their name and tap **IN** or **OUT**.
- **Live Apple iCloud Calendar Sync**: Directly synchronized with the group's public iCloud calendar feed (`webcal://p106-caldav.icloud.com/...`). Automatically calculates weekly Thursday 6:30 PM – 8:15 PM gym slots and accounts for `(Gym Closed)` dates.
- **Next Game Focus**: RSVPs focus strictly on the immediate upcoming session, with a list preview of future scheduled gym dates.
- **Headcount Progress & Soft Targets**: Target indicator (8 minimum for "Game On", 10–12 ideal for full court 5v5).
- **Guest (+1) & Note Tracking**: Record guest counts (+1, +2, etc.), guest names, and short status notes (e.g., "arriving 10m late", "bringing 2 basketballs").
- **1-Click Group Chat Summary**: Copy formatted text summary (with player headcount and names) ready to paste into iMessage, WhatsApp, or SMS, with native mobile Share sheet support.
- **1-Tap Directions**: Quick buttons to open Egan Junior High School directly in Apple Maps or Google Maps.
- **Device Memory & Autocomplete**: Remembers the player on their phone for 1-tap updates next week, and autocompletes past player names to prevent duplicates.
- **Organizer Admin Mode**: Passcode-protected (`2026`) modal to remove accidental RSVPs and pin announcement banners.
- **Retro Varsity / Vintage Court Aesthetic**: Warm gym cream, collegiate navy, basketball leather orange, and varsity green.

---

## 🚀 Local Preview

Run a local HTTP server right from this directory:

```bash
# Using Python
python3 -m http.server 3000
```

Then open [http://localhost:3000](http://localhost:3000) on your browser or mobile device on the same Wi-Fi.

The site works immediately out-of-the-box in **Local / Demo Mode** with pre-seeded pickup players, local storage persistence, and full functionality.

---

## ☁️ Deployment to Cloudflare Pages

This repository is ready to deploy directly to **Cloudflare Pages**:

### Option 1: Via Git Repository (Recommended)
1. Push this folder to a GitHub repository (e.g. `seemoris/Egan-Hoops`).
2. In the **Cloudflare Dashboard** -> **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
3. Select your repository:
   - **Framework preset**: None (Static HTML)
   - **Build command**: (leave empty)
   - **Build output directory**: `.` (or `./`)
4. Click **Save and Deploy**.

### Option 2: Via Wrangler CLI
```bash
npx wrangler pages deploy . --project-name=egan-hoops
```

---

## ⚡ Connecting Supabase (Optional Real-Time Sync)

To have RSVPs update instantly in real-time across all player devices without refreshing:

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** in your Supabase dashboard, paste the contents of `schema.sql`, and click **Run**.
3. Open Egan Hoops on your device, tap **🔒 Admin** in the header, enter passcode `2026`, and paste your **Supabase URL** and **Anon Key** in the configuration box.
