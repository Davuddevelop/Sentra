# Sentra: AI-Powered Family Safety

Sentra is a modern behavioral monitoring platform designed to protect children in the age of AI. Unlike traditional parental controls that rely on invasive content scanning, Sentra uses **Zero-Knowledge Behavioral Signals** to identify risks in AI chatbot interactions and app usage patterns without ever reading private messages.

![Sentra Landing Page](file:///C:/Users/User/.gemini/antigravity/brain/274a539d-ceb6-4d93-ab09-4c518b13d907/landing_page_hero_1776631554050.png)

## 🛡️ Core Value Proposition

Sentra fills the "AI Safety Gap" by monitoring how children interact with LLMs (Claude, ChatGPT, Character.AI). It detects:
*   **Romantic Roleplay Patterns:** Guarding against emotional dependency on AI.
*   **Jailbreak Attempts:** Monitoring for bypasses of safety filters.
*   **Harmful Advice:** Identifying when AI provides potentially dangerous guidance.
*   **Privacy Leaks:** Preventing children from sharing PII with chatbots.

## 📊 Parent Dashboard

The Sentra Dashboard provides a high-level overview of family activity, risk trends, and real-time alerts.

![Sentra Dashboard](file:///C:/Users/User/.gemini/antigravity/brain/274a539d-ceb6-4d93-ab09-4c518b13d907/dashboard_overview_1776631572908.png)

### Key Features
*   **Multi-Child Support:** Manage monitoring for the whole family from one interface.
*   **Activity Logs:** Review behavioral signals across 7-day or 30-day windows.
*   **Weekly Digests:** Get automated reports on screen time and risk categories.
*   **Real-time Alerts:** Critical notifications via email and push when high-risk patterns are detected.

---

## 🛠️ Technical Architecture

Sentra is built for privacy, performance, and scalability.

*   **Frontend:** Vite + Vanilla JS (Modern, High-Performance)
*   **Backend:** Node.js + Express
*   **Database:** SQLite (WAL mode) for zero-latency local storage.
*   **AI Engine:** Claude 3.5 Haiku integration for real-time behavioral analysis.
*   **Ingestion:** X-Device-Token protected REST API for browser extensions and mobile agents.

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18+)
*   Anthropic API Key (placed in `.env`)

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and add your keys.
4. Start the development server:
   ```bash
   npm run dev
   ```

### Running the Simulator
To test the dashboard with realistic data without a physical device:
```bash
node src/simulator.js
```

---

## 🔒 Privacy First

Sentra follows a **Privacy-by-Design** approach:
1. **Metadata Only:** We never store or transmit the body of children's messages.
2. **Local Analysis:** Future versions aim to move AI analysis entirely on-device.
3. **COPPA Compliant:** Built-in parental consent workflows and data purge cycles.

---
*Created by the Sentra Team*
