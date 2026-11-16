# AI Agent Firefox Bridge & Docked Sidebar (antiX Linux)

This extension connects your local Firefox browser to the AI Browser Agent with a **native docked side panel**. The agent browses, searches, and clicks using your real browser, your residential IP, and your logged-in Google, Amazon, GitHub, or any other accounts with **zero bot blocks**.

---

### How to Open the Side Panel in Firefox

1. **Toolbar Click**:
   - Click the orange 🦊 Fox icon in Firefox's top toolbar. It immediately toggles the **AI Agent Sidebar** open or closed.
2. **Keyboard Shortcut**:
   - Press **`Ctrl + Shift + Y`** anywhere in Firefox to instantly toggle the sidebar.
3. **Native Firefox Menu**:
   - Go to **View → Sidebar → AI Agent Assistant** (or click Firefox's built-in Sidebar button).
4. **Auto-Opens on Load**:
   - Built with `"open_at_install": true`, so when you first load it, the sidebar opens automatically on the left side of your browser.

---

### What's Inside the Sidebar

- **💬 Agent Chat**: Talk to the autonomous agent right beside your active tab. Watch it think, plan, and execute real actions (`click`, `type`, `navigate`, `scroll`) in the tab beside you.
- **🖥️ Web Studio**: Embeds the full visual Studio application directly in the sidebar so you don't even need a separate tab.
- **🔍 Tab Inspector**: Live screenshot thumbnail of what the agent sees, detected interactive DOM elements, and quick URL navigation.

---

### How to Install in 3 Steps

1. **Open Firefox Debugging**:
   - In Firefox address bar, enter:
     ```
     about:debugging#/runtime/this-firefox
     ```

2. **Load Temporary Add-on**:
   - Click **"Load Temporary Add-on..."**
   - Select `manifest.json` inside the extracted folder (or select `firefox-agent-bridge.zip` directly).

3. **Start Automating**:
   - The sidebar pops open on the left!
   - Verify the status badge says **antiX Linked**.
   - Browse any site in your main tab (like Google, Gmail, etc.) while giving commands in the sidebar!
