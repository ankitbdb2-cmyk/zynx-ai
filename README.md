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

- **GHOST (AI Chat Widget)**: A smart real estate agent assistant named Sarah that runs on the main landing page and captures leads.
- **CLOSER (Negotiation Co-Pilot)**: An internal tool at `/closer.html` for agents to analyze buyer text, generate scripts, and navigate objections.
- **ADMIN DASHBOARD**: An internal dashboard at `/admin.html` to track and manage captured leads. (Login: `admin` / `admin123`)
