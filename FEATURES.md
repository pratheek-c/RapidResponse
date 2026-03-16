# RapidResponse.ai — Core Features Guide

This guide outlines the critical features, architecture capabilities, and Unique Selling Propositions (USPs) of the RapidResponse.ai platform. It is designed to act as a reference for project understanding, team onboarding, and hackathon presentation.

---

## 🌟 1. Real-Time AI Emergency Triage (The Core Loop)

RapidResponse isn't just a transcription service; it is a fully autonomous, bidirectional voice agent that answers emergency calls in real time.

- **AWS Bedrock Nova Sonic 2:** Acts as the primary Voice Agent. It interacts with callers iteratively, utilizing conversational AI instead of fixed decision trees.
- **Protocol-Driven (RAG):** The AI Agent accesses municipal emergency protocols dynamically via **LanceDB** vector search, retrieving relevant standard operating procedures to guide its questioning structure.
- **Dynamic Classification:** The AI uses real-time context to extract severity (Priority 1-5), incident type (Medical, Fire, Police, Hazmat), and caller location without requiring dispatcher intervention.

## 🤫 2. Covert Distress Detection (Flagship USP)

RapidResponse possesses the ability to detect when a caller **cannot speak freely** and adapts its strategy accordingly—a capability lacking in standard 911 systems.

**Detection Triggers:**
- **Fake Orders:** Callers ordering "pizza," "Chinese food," or a "taxi" to disguise the call.
- **Silent/Open Lines:** No speech, but background noise (arguing, hitting, breaking items).
- **Whispering / Short Answers:** Callers speaking softly or providing constrained "Yes/No" answers out of fear.
- **Coercion Signals:** Tone mismatch or sudden backtracking (e.g., "Oh, wrong number").

**Agent Adaptation Flow:**
1. **Never Break Cover:** The agent avoids saying "911," "emergency," or "police" aloud.
2. **Yes/No Mode:** Automatically switches to yes/no questioning ("I'm going to ask you some questions. Tap once for yes, twice for no.").
3. **Dispatch Flags:** The dashboard highlights the incident with a **"🤫 COVERT"** badge and outputs **"SILENT APPROACH — NO SIRENS"** instructions to the responding units.

## 💻 3. Live Dispatcher Dashboard

A modernized, high-performance UI tailored to the high-stakes environment of emergency response.

- **Continuous Ticker:** Features a "stock terminal" style marquee scrolling through live incidents within a 10km radius for instant situational awareness without clutter.
- **Interactive Command Map:** Powered by ArcGIS, highlighting incident pins, responding units, and the dispatcher center. Live calculated routes (polylines) actively map the distance and ETA to ongoing crises.
- **Event-Driven UI:** Changes in incident status or transcript additions are instantly pushed via SSE (Server-Sent Events) to the dashboard.
- **Modal Modularity:** Detailed summaries, transcript reviews, and dispatch decisions are isolated in non-obtrusive modals using React Portals.

## 🧠 4. Multi-Agent Ecosystem

The system delegates specialized tasks to specialized AI instances:
1. **Voice Agent (Nova Sonic 2):** Ingests raw audio (LPCM format), handles the human conversation, and decides when to trigger system tools.
2. **Report / Extraction Agent (Nova Lite):** Periodically reviews transcript logs to summarize events and extract structured entities (number of suspects, presence of weapons).
3. **Dispatch Bridge Agent:** Bridges the gap between what the caller is saying and what the human dispatcher needs to know, acting as the intelligent relay.

## 🏗️ 5. Next-Gen Tech Stack

- **Runtime:** Built natively on **Bun** utilizing Bun Workspaces. No Node.js overhead, resulting in blistering fast package management and concurrent startup.
- **Database Partitioning by Intent:**
  - **libSQL:** Handles structured, mission-critical relational data (incidents, units, statuses).
  - **LanceDB:** Embedded vector database optimized for Titan Embeddings, powering the protocol RAG retrieval.
  - **AWS S3:** Houses massive raw recording buffers and final JSON transcripts.
- **Strict Typing:** End-to-end true TypeScript enforcement ensures stability across API boundaries.

---

## 🚀 Hackathon Demo Highlights

If walking through the project, ensure observers see:
1. **The Pizza Pattern:** Dial in and order a pizza. Watch the AI seamlessly transition into "Yes/No" covert questioning.
2. **The Dashboard Response:** See the UI react instantly via SSE to show a "🤫 COVERT" incident with "No Sirens" instructions.
3. **The Map Engine:** Highlight the customized ESRI dark basemap and distance calculations rendering live routing connections from the precinct to emergencies.
