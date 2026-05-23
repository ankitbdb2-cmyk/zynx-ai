# PropMind

The complete real estate AI SaaS system.

## Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Environment Variables:
   Add your Anthropic API Key to the `.env` file in the root directory:
   ```
   ANTHROPIC_API_KEY=your_key_here
   PORT=8080
   ```

3. Run the system:
   ```bash
   node server.js
   ```

## Features

- **GHOST (AI Chat Widget)**: Sarah qualifies leads on the homepage and scores them 1–10.
- **Auto Viewing Scheduler**: When a lead scores 8+, Sarah offers 3 viewing slots from your availability calendar. Leads reply 1/2/3 to confirm; both parties get confirmation.
- **Weekly Analytics**: Admin dashboard with charts — leads captured, conversion rate, hot lead follow-up, and commission attribution.
- **CLOSER (Negotiation Co-Pilot)**: Internal tool at `/closer.html` for objection handling.
- **ADMIN DASHBOARD**: `/admin.html` — analytics, scheduler, leads, properties. (Login: `admin` / `admin123`)

## Smart Listing Paste

In Admin → Properties, paste raw Property Finder / Bayut text. Claude extracts all listings; preview and confirm before saving.

## Data Persistence (Render)

Production database path: `/opt/render/project/data/propmind.db` on the persistent disk. Data survives redeploys and spin-downs. Seed runs only when the properties table is completely empty.

Check persistence: `GET /health` returns `persistence` object with live counts.

## Local Test

```bash
npm install
node server.js
powershell -File scripts/test-local.ps1
```

## Deploy (Render)

Trigger deploy via Render API (requires fresh `RENDER_API_KEY`):

```powershell
$env:RENDER_API_KEY = "rnd_YOUR_KEY"
Invoke-RestMethod -Uri "https://api.render.com/v1/services/srv-d817m10g4nts739928s0/deploys" -Method POST -Headers @{Authorization="Bearer $env:RENDER_API_KEY"; Accept="application/json"; "Content-Type"="application/json"} -Body '{}'
```

Live URL: `https://zynx-ai.onrender.com`
