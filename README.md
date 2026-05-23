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

## Deploy (Render)

Push to `main` on GitHub — Render auto-deploys from `https://github.com/ankitbdb2-cmyk/zynx-ai`. Live URL: `https://zynx-ai.onrender.com`

Set env vars on Render: `ANTHROPIC_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optional `AGENT_EMAIL` / `EMAIL_PASSWORD` for notifications.
