# Browser Agent

An autonomous AI browser agent that drives a real web browser just like a human would. It perceives the live page visually via screenshots and structurally through the DOM Accessibility Tree, then performs real mouse clicks, keyboard typing, scrolling, URL navigation, and multi-tab switching in an autonomous loop until a task is finished.

It supports two execution targets inside one workspace:

- **Cloud / Local Chromium (`chromiumManager.ts`)**: Runs a real Chromium browser powered by Patchright/Playwright with anti-detection stealth measures and optional HTTP/SOCKS5 proxy routing.
- **Local Firefox Extension Bridge (`firefox-extension/` + `extensionManager.ts`)**: Connects to your desktop Firefox browser via a docked sidebar extension so the agent can act inside your existing browser session and logins.

---

## Requirements & Model Support

> **Gemini Only:** This application is built exclusively on the `@google/genai` SDK and **only accepts a Google Gemini API key (`GEMINI_API_KEY`)**. Other model providers (OpenAI, Anthropic, local Ollama, etc.) are not supported.

Models currently used:

- **Decision Model (System 1)**: `gemini-decision-1` (`v1beta` Decisions API)
- **Reasoning / Planner LLM (System 2)**: `gemini-3.1-flash-lite`

---

## Getting Started

### Option A: Run with Docker (Recommended)

Avoid host Node/Chromium dependency conflicts by running everything inside Docker (Node 22 + Patchright Chromium + all Linux browser libraries included):

1. Set your Gemini API key (either in `.env` or exported in your shell):

```bash
cp .env.example .env
# Edit .env and set GEMINI_API_KEY="your_gemini_api_key_here"
```

2. Build and start the container:

```bash
docker compose up --build
```

3. Open `http://localhost:3000` in your browser.

---

### Option B: Run Manually with Node.js

#### 1. Install Dependencies

Make sure you have **Node.js 20+** and **npm** installed, then install packages (this also installs Patchright's Chromium binary via the `postinstall` script):

```bash
npm install
```

*(On Linux, you may also need OS Chromium libraries: `npx patchright install-deps chromium`.)*

#### 2. Insert Your Gemini API Key

Copy `.env.example` to `.env` in the project root and add your Gemini API key:

```env
GEMINI_API_KEY="your_gemini_api_key_here"
```

*(In AI Studio hosted environments, set `GEMINI_API_KEY` in the **Secrets** panel instead of committing `.env`.)*

#### 3. Run the Application

Start the development server (Express API + Vite frontend on port `3000`):

```bash
npm run dev
```

Or build for production and start:

```bash
npm run build
npm run start
```

Open `http://localhost:3000` in your browser. Type any task into the right-hand chat panel (for example, comparing product prices or researching a topic on Wikipedia), or click directly inside the browser viewport at any time to take manual control.

### Optional: Residential Proxy on antiX / Linux (`gost` + `Pinggy` / `bore`)

To route Cloud Chromium through your local machine's residential IP:

1. Start an authenticated HTTP proxy with `gost` (keep `http://`, as Chromium does not support username/password auth on `socks5://`):
   ```bash
   gost -L "http://myuser:mypass@127.0.0.1:8080"
   ```
2. Expose port `8080` over HTTPS port `443` using built-in `ssh` + Pinggy (avoids ISP/relay timeouts on port `7835`):
   ```bash
   ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 0:127.0.0.1:8080 tcp@a.pinggy.io
   ```
   *(Or use `bore local 8080 --to bore.pub` if port `7835` is open on your network.)*
3. Copy the assigned host/port (replacing `tcp://` with `http://`, e.g. `http://xxxxx.a.pinggy.link:12345`), open **Proxy** in the top bar, enter your server URL + username/password, toggle **Enable Proxy** ON, and click **Check IP**.

### Optional: Connecting Your Local Firefox Browser

1. Click **Extension** in the top bar and download `firefox-agent-bridge.zip`.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on...** and select the downloaded `.zip` (or its extracted `manifest.json`).
4. Open the sidebar from the extension icon, verify the **Server URL** in Settings matches your running app URL, and send a prompt directly from the sidebar.

---

## Architecture

```text
+-----------------------+        POST /api/agent/step        +-----------------------------+
|  React UI (src/)      | ---------------------------------> |  Express Server (server.ts) |
|  - Browser Viewport   |                                    |                             |
|  - Agent Chat Panel   | <--------------------------------- |  1. Fetch live state:       |
|  - Payload Inspector  |     Updated state + action log     |     - Screenshot (JPEG)     |
+-----------------------+                                    |     - Accessibility Tree    |
                                                             |     - Open tabs & URL       |
+-----------------------+    long-poll /api/extension/poll   +--------------+--------------+
| Firefox Extension     | <-------------------------------->                |
| (firefox-extension/)  |                                                   v
+-----------------------+                                    +-----------------------------+
                                                             |  decisionGate.ts (System 1) |
                                                             |  Model: gemini-decision-1   |
                                                             +------+---------------+------+
                                                                    |               |
                              Simple click/type/scroll/auth pause   |               | Needs planning, text gen,
                              (0 LLM tokens)                        |               | summary, or recovery
                                                                    v               v
                                                      Execute directly      +-----------------------------+
                                                      on active browser     |  Brain LLM (System 2)       |
                                                      (Chromium / Firefox)  |  gemini-3.1-flash-lite      |
                                                                            +-----------------------------+
```

### Core Modules

- **`server.ts`**: Express server hosting `/api/agent/step`, direct browser control endpoints (`/api/firefox/state`, `/api/firefox/action`), proxy management (`/api/proxy/*`), and the Firefox extension bridge (`/api/extension/*`).
- **`chromiumManager.ts`**: Launches and drives stealth Chromium via Patchright, builds a compact numbered Accessibility Tree (`[el-1]`, `[el-2]`, ...) overlaid on live screenshots, and executes hardware-level mouse/keyboard actions.
- **`extensionManager.ts` & `firefox-extension/`**: Long-polling command queue and content-script bridge allowing the same agent loop to inspect and automate tabs in desktop Firefox.
- **`decisionGate.ts`**: Experimental System-1 decision gatekeeper powered by `gemini-decision-1`.
- **`src/`**: Minimalist monochrome web workspace with a live interactive browser canvas, chat task controller, and collapsible Model Payload Inspector.

---

## Anti-Bot Checks, Proxy Routing & Fingerprinting

Strict login and anti-bot systems (such as Google BotGuard) look far beyond IP addresses—they cross-check HTTP headers, JavaScript APIs, WebGL/GPU rendering, native function prototypes, and IP-to-timezone consistency. Here is how this project handles all three layers in `chromiumManager.ts`:

### 1. Native Patchright Stealth & Full Chromium (`channel: 'chromium'`)
- **No brittle JS `addInitScript` spoofs:** Patchright patches C++/CDP automation leaks (`navigator.webdriver = false`, `Runtime.enable` isolation) directly inside the engine. Removing legacy Puppeteer-style `addInitScript` overrides prevents `[native code]` prototype integrity failures (`Function.prototype.toString()` checks).
- **Full Chromium binary instead of `chrome-headless-shell`:** Launching with `channel: 'chromium'` ensures `window.chrome` exists natively and removes `"HeadlessChrome"` from `Sec-CH-UA` client-hint headers.
- **OS, Version & GPU Consistency:** Rather than faking Windows / Chrome 130 / NVIDIA RTX 3080 Direct3D11 on a Linux container (which contradicts `navigator.platform`, real `Sec-CH-UA` headers, and SwiftShader), `User-Agent` is dynamically derived from `process.platform` and `browser.version()`, site isolation (`IsolateOrigins`, `site-per-process`) stays intact, and Linux SwiftShader WebGL reports consistently with the host OS.

### 2. Dynamic Egress-IP Timezone Syncing
- Hardcoded timezones (like `America/New_York`) immediately fail geo-consistency checks when traffic exits from another region.
- `chromiumManager.ts` queries the active egress IP's timezone (`ip-api.com`) on startup and automatically whenever proxy settings are applied or toggled, caching per proxy and recreating the browser context so `Intl.DateTimeFormat().resolvedOptions().timeZone` always matches the active exit IP.

### 3. Toggleable Residential Proxy Tunneling (`gost` + Pinggy / `bore`)
- Cloud Run / datacenter IPs are frequently flagged even with a clean fingerprint. Built-in proxy controls (`/api/proxy/*`, disabled by default) let you toggle residential egress routing on demand.
- Because Chromium only supports proxy username/password authentication over `http://` (not `socks5://`), local egress runs through `gost -L "http://user:pass@127.0.0.1:8080"` and tunnels cleanly out over SSH port `443` via Pinggy (avoiding per-connection port-`7835` timeouts seen with `bore.pub`)—or runs directly on your machine with no tunnel via `docker compose up --build`.

---

## Experimenting with the Decision Model (`gemini-decision-1`)

A key experiment in this codebase is pairing a fast multimodal **Decision Model** (`gemini-decision-1`) in front of the traditional **Brain LLM** (`gemini-3.1-flash-lite`) instead of calling a full generative LLM on every single browser step:

1. **Multimodal Inspection on Every Turn**: Every turn first sends the current viewport screenshot, URL/task context, and dynamic choice options (generated from interactive `[el-X]` elements in the live Accessibility Tree, plus scroll/key/navigation controls) to `gemini-decision-1` via `ai.decisions.create`.
2. **Structured Binary (`noul`) & `choice` Routing**:
   - The gate checks deterministic conditions (`if / else` guardrails + `noul` binary questions): whether the turn needs planning/text generation/summarization, whether human login/CAPTCHA verification is blocking the page, or whether previous actions stalled/failed.
   - If the Brain is **not** needed, `gemini-decision-1` directly selects the next UI target (`click:el-X`, `type_pending`, `ACTION_SCROLL_DOWN`, `PAUSE_HUMAN_GATE`, etc.) and executes it without invoking `gemini-3.1-flash-lite`.
3. **Delegated Planning (`pending_inputs` & `plan_steps`)**: When `gemini-3.1-flash-lite` runs for planning, it can attach upcoming search/form text values into `task.pending_inputs` and optional deterministic steps into `task.plan_steps`. On following page loads, `gemini-decision-1` matches those pending inputs to live input boxes and clicks links/buttons autonomously until summarization or error recovery requires the Brain again.
4. **Trade-offs Being Evaluated**: This dual-model loop reduces generative output tokens on repetitive click/scroll/type sequences, though reasoning-heavy browsing often still benefits from calling a fast Brain LLM directly when multi-page synthesis or subtle visual judgment is required. Every turn's routing decision and latency can be inspected live in the bottom **Inspector** bar.
