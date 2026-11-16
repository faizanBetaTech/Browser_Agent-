/**
 * Browser Agent Firefox Sidebar Controller
 */
(() => {
  const CLOUD_APP_URL = 'https://ais-dev-exfiywpcnb6acobye7ziaf-439861698598.asia-southeast1.run.app';

  let serverUrl = CLOUD_APP_URL;
  let isProcessing = false;
  let cancelRequested = false;
  let taskStatus = 'stop'; // 'stop' | 'processing' | 'pause'
  let activeTask = null;
  let agentMemory = null;
  let messages = [];
  let isApproachOpen = false;
  let expandedNotes = {};
  let activeAbortController = null;
  let autoStepTimeout = null;

  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const latencyBadge = document.getElementById('latencyBadge');
  const btnSettings = document.getElementById('btnSettings');
  const settingsDrawer = document.getElementById('settingsDrawer');
  const serverInput = document.getElementById('serverInput');
  const btnSaveServer = document.getElementById('btnSaveServer');
  const btnCloudPreset = document.getElementById('btnCloudPreset');

  const btnPause = document.getElementById('btnPause');
  const btnResume = document.getElementById('btnResume');
  const btnCancel = document.getElementById('btnCancel');
  const btnBannerResume = document.getElementById('btnBannerResume');

  const taskCard = document.getElementById('taskCard');
  const taskTitle = document.getElementById('taskTitle');
  const taskSteps = document.getElementById('taskSteps');
  const approachToggle = document.getElementById('approachToggle');
  const approachText = document.getElementById('approachText');
  const pauseBanner = document.getElementById('pauseBanner');

  const feed = document.getElementById('feed');
  const emptyState = document.getElementById('emptyState');
  const processingBox = document.getElementById('processingBox');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const btnSubmit = document.getElementById('btnSubmit');

  // Load configured server URL
  browser.storage.local.get(['serverUrl']).then((res) => {
    if (
      res &&
      res.serverUrl &&
      res.serverUrl !== 'http://localhost:3000' &&
      res.serverUrl !== 'http://localhost:8080'
    ) {
      serverUrl = res.serverUrl.replace(/\/+$/, '');
    } else {
      serverUrl = CLOUD_APP_URL;
      browser.storage.local.set({ serverUrl: CLOUD_APP_URL });
    }
    serverInput.value = serverUrl;
    checkConnection();
  }).catch(() => {
    serverInput.value = serverUrl;
    checkConnection();
  });

  // Settings Drawer
  btnSettings.addEventListener('click', () => {
    settingsDrawer.classList.toggle('open');
  });

  btnSaveServer.addEventListener('click', async () => {
    const val = serverInput.value.trim().replace(/\/+$/, '');
    if (!val) return;
    serverUrl = val;
    await browser.storage.local.set({ serverUrl });
    browser.runtime.sendMessage({ type: 'SET_SERVER_URL', url: serverUrl }).catch(() => {});
    settingsDrawer.classList.remove('open');
    checkConnection();
  });

  btnCloudPreset.addEventListener('click', async () => {
    serverUrl = CLOUD_APP_URL;
    serverInput.value = CLOUD_APP_URL;
    await browser.storage.local.set({ serverUrl: CLOUD_APP_URL });
    browser.runtime.sendMessage({ type: 'SET_SERVER_URL', url: CLOUD_APP_URL }).catch(() => {});
    settingsDrawer.classList.remove('open');
    checkConnection();
  });

  // Plan Accordion
  approachToggle.addEventListener('click', () => {
    isApproachOpen = !isApproachOpen;
    approachText.classList.toggle('open', isApproachOpen);
  });

  // Composer Handling (rock-solid across Enter, Send button, and form submit)
  function syncSendButtonState() {
    btnSubmit.disabled = !chatInput.value.trim();
  }

  function submitUserInput() {
    const prompt = chatInput.value.trim();
    if (!prompt) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    syncSendButtonState();

    runAgentTurn(prompt, false);
  }

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 96) + 'px';
    syncSendButtonState();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitUserInput();
    }
  });

  btnSubmit.addEventListener('click', (e) => {
    e.preventDefault();
    submitUserInput();
  });

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitUserInput();
  });

  // Quick Prompts
  document.querySelectorAll('.quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt');
      if (prompt) {
        runAgentTurn(prompt, false);
      }
    });
  });

  // Task Controls
  function pauseTask() {
    cancelRequested = true;
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
    }
    if (autoStepTimeout) {
      clearTimeout(autoStepTimeout);
      autoStepTimeout = null;
    }
    isProcessing = false;
    taskStatus = 'pause';
    updateUIState();
  }

  function resumeTask() {
    cancelRequested = false;
    taskStatus = 'processing';
    updateUIState();
    runAgentTurn('Resume current task from current page state', false);
  }

  function stopTask() {
    cancelRequested = true;
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      activeAbortController = null;
    }
    if (autoStepTimeout) {
      clearTimeout(autoStepTimeout);
      autoStepTimeout = null;
    }
    taskStatus = 'stop';
    activeTask = null;
    isProcessing = false;
    updateUIState();
  }

  btnPause.addEventListener('click', pauseTask);
  btnResume.addEventListener('click', resumeTask);
  btnBannerResume.addEventListener('click', resumeTask);
  btnCancel.addEventListener('click', stopTask);

  // Connection Prober
  async function checkConnection() {
    const start = Date.now();
    try {
      const res = await fetch(`${serverUrl}/api/extension/status`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const elapsed = Date.now() - start;
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data && data.connected) {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Connected';
      } else {
        statusDot.className = 'status-dot offline';
        statusText.textContent = 'Connecting bridge';
      }
      latencyBadge.textContent = `${elapsed}ms`;
    } catch (_) {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Unreachable';
      latencyBadge.textContent = 'Offline';
    }
  }

  setInterval(checkConnection, 6000);

  function updateUIState() {
    if (isProcessing) {
      statusDot.className = 'status-dot working';
      statusText.textContent = 'Working';
      processingBox.classList.add('active');
    } else if (taskStatus === 'pause') {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'Paused';
      processingBox.classList.remove('active');
    } else {
      processingBox.classList.remove('active');
      if (statusText.textContent === 'Working' || statusText.textContent === 'Paused') {
        statusDot.className = 'status-dot online';
        statusText.textContent = 'Connected';
      }
    }

    if (taskStatus === 'processing' || isProcessing) {
      btnPause.style.display = 'inline-flex';
      btnResume.style.display = 'none';
      btnCancel.style.display = 'inline-flex';
    } else if (taskStatus === 'pause') {
      btnPause.style.display = 'none';
      btnResume.style.display = 'inline-flex';
      btnCancel.style.display = 'inline-flex';
    } else {
      btnPause.style.display = 'none';
      btnResume.style.display = 'none';
      btnCancel.style.display = 'none';
    }

    pauseBanner.classList.toggle('open', taskStatus === 'pause');

    if (activeTask && activeTask.title && taskStatus === 'processing') {
      taskCard.style.display = 'block';
      taskTitle.textContent = activeTask.title;
      if (Array.isArray(activeTask.plan_steps) && activeTask.plan_steps.length > 0) {
        const cur = Math.min(activeTask.current_step_index || 0, activeTask.plan_steps.length);
        taskSteps.textContent = `${cur}/${activeTask.plan_steps.length}`;
      } else {
        taskSteps.textContent = '';
      }
      approachText.textContent = activeTask.approach || '';
      approachToggle.style.display = activeTask.approach ? 'inline-flex' : 'none';
    } else {
      taskCard.style.display = 'none';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[m]);
  }

  function renderMessages() {
    if (messages.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }
    emptyState.style.display = 'none';

    Array.from(feed.children).forEach((child) => {
      if (child.id !== 'emptyState') feed.removeChild(child);
    });

    messages.forEach((msg) => {
      if (msg.sender === 'user') {
        const wrap = document.createElement('div');
        wrap.className = 'msg-user-wrap';
        const bubble = document.createElement('div');
        bubble.className = 'msg-user-bubble';
        bubble.textContent = msg.text;
        wrap.appendChild(bubble);
        feed.appendChild(wrap);
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'msg-agent-wrap';

      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      let metaHtml = `<span class="msg-meta-author">Agent</span><span>·</span><span>${timeStr}</span>`;
      if (msg.decisionGate && typeof msg.decisionGate.latencyMs === 'number') {
        const label = msg.decisionGate.fastExecuted ? 'Fast' : 'Brain';
        metaHtml += `<span>·</span><span>${label} ${msg.decisionGate.latencyMs}ms</span>`;
      }
      meta.innerHTML = metaHtml;

      const hasNotes = Boolean(msg.thought || msg.visual_summary);
      let notesEl = null;

      if (hasNotes) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'notes-toggle';
        const isOpen = Boolean(expandedNotes[msg.id]);
        toggleBtn.textContent = isOpen ? 'Hide notes' : 'Notes';
        toggleBtn.addEventListener('click', () => {
          expandedNotes[msg.id] = !expandedNotes[msg.id];
          if (notesEl) {
            notesEl.classList.toggle('open', expandedNotes[msg.id]);
          }
          toggleBtn.textContent = expandedNotes[msg.id] ? 'Hide notes' : 'Notes';
        });
        meta.appendChild(toggleBtn);
      }

      wrap.appendChild(meta);

      if (msg.text) {
        const textEl = document.createElement('div');
        textEl.className = 'msg-agent-text';
        textEl.textContent = msg.text;
        wrap.appendChild(textEl);
      }

      if (msg.action && msg.action.type) {
        const actionRow = document.createElement('div');
        actionRow.className = 'action-row';
        const summary = msg.action.summary || msg.action.value || msg.action.url || '';
        actionRow.innerHTML = `
          <span class="action-type">${escapeHtml(msg.action.type)}</span>
          ${msg.action.target ? `<span class="action-target">${escapeHtml(msg.action.target)}</span>` : ''}
          ${summary ? `<span class="action-summary">${escapeHtml(summary)}</span>` : ''}
        `;
        wrap.appendChild(actionRow);
      }

      if (hasNotes) {
        notesEl = document.createElement('div');
        notesEl.className = `notes-box${expandedNotes[msg.id] ? ' open' : ''}`;
        let notesHtml = '';
        if (msg.thought) {
          notesHtml += `<div><div class="notes-label">Reasoning</div><div>${escapeHtml(msg.thought)}</div></div>`;
        }
        if (msg.visual_summary) {
          notesHtml += `<div><div class="notes-label">Page observation</div><div>${escapeHtml(msg.visual_summary)}</div></div>`;
        }
        notesEl.innerHTML = notesHtml;
        wrap.appendChild(notesEl);
      }

      feed.appendChild(wrap);
    });

    feed.scrollTop = feed.scrollHeight;
  }

  // Agent Step Execution
  async function runAgentTurn(userPrompt = '', myself = false) {
    if (autoStepTimeout) {
      clearTimeout(autoStepTimeout);
      autoStepTimeout = null;
    }

    if (!myself && userPrompt) {
      if (activeAbortController) {
        try { activeAbortController.abort(); } catch (_) {}
        activeAbortController = null;
      }
      cancelRequested = false;

      const lower = userPrompt.toLowerCase();
      if (
        activeTask &&
        (lower.includes('stop') ||
          lower.includes('cancel') ||
          lower.includes('forget') ||
          lower.includes('instead') ||
          lower.includes('new task'))
      ) {
        activeTask = null;
      }
    } else {
      if (isProcessing) return;
      if (cancelRequested) {
        cancelRequested = false;
        return;
      }
    }

    const timestamp = new Date().toISOString();

    if (userPrompt && !myself) {
      messages.push({
        id: `user-${Date.now()}`,
        sender: 'user',
        text: userPrompt,
        timestamp,
      });
      renderMessages();
    }

    isProcessing = true;
    taskStatus = 'processing';
    updateUIState();

    const abortController = new AbortController();
    activeAbortController = abortController;

    try {
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.sender,
        text: m.text,
        agent_text: m.text,
        thought: m.thought,
        visual_summary: m.visual_summary,
        action: m.action,
        task_status: m.task_status,
        should_call_myself: m.myself,
        timestamp: m.timestamp,
      }));

      const res = await fetch(`${serverUrl}/api/agent/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: abortController.signal,
        body: JSON.stringify({
          user_prompt: userPrompt,
          myself,
          target: 'extension',
          timestamp,
          history: historyPayload,
          active_task: activeTask,
          agent_memory: agentMemory,
          execute_action: true,
        }),
      });

      const rawText = await res.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch (_) {
        data = null;
      }

      if (!res.ok) {
        const errMsg =
          (data && (data.error || data.agent_text)) ||
          (rawText && !rawText.trim().startsWith('<') ? rawText.slice(0, 200) : '') ||
          `Server returned status ${res.status}`;
        throw new Error(errMsg);
      }

      if (!data || typeof data !== 'object') {
        const looksLikeHtml = rawText.trim().startsWith('<');
        throw new Error(
          looksLikeHtml
            ? 'Server returned HTML instead of JSON. Open the Dashboard URL in Firefox once to authenticate, or verify Server URL in Settings.'
            : 'Server returned an empty or invalid JSON response.'
        );
      }

      const decision = (data.decision && typeof data.decision === 'object') ? data.decision : data;
      if (decision.task) activeTask = decision.task;
      if (decision.agent_memory) agentMemory = decision.agent_memory;

      let responseText = decision.agent_text || '';
      if (!responseText && decision.action) {
        responseText = decision.action.summary || `Executing ${decision.action.type}...`;
      }
      if (!responseText && decision.thought) {
        responseText = decision.thought;
      }

      messages.push({
        id: `agent-${Date.now()}`,
        sender: 'agent',
        text: responseText,
        thought: decision.thought || '',
        visual_summary: decision.visual_summary || '',
        action: decision.action || null,
        decisionGate: decision.decisionGate || null,
        myself,
        should_bother_user: decision.should_bother_user,
        task_status: decision.task_status,
        timestamp: decision.timestamp || new Date().toISOString(),
      });

      renderMessages();

      taskStatus = decision.task_status || 'stop';
      isProcessing = false;
      updateUIState();

      const shouldContinue =
        !cancelRequested &&
        decision.action?.type !== 'finish' &&
        taskStatus !== 'pause' &&
        taskStatus !== 'stop' &&
        (decision.should_call_myself || taskStatus === 'processing');

      if (shouldContinue) {
        autoStepTimeout = setTimeout(() => {
          runAgentTurn('', true);
        }, 1200);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;

      messages.push({
        id: `err-${Date.now()}`,
        sender: 'agent',
        text: `Error: ${err?.message || 'Request failed'}`,
        timestamp: new Date().toISOString(),
      });
      renderMessages();

      taskStatus = 'stop';
      isProcessing = false;
      updateUIState();
    } finally {
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
    }
  }

  updateUIState();
  renderMessages();
})();
