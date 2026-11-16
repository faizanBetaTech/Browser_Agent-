/**
 * AI Agent Firefox Background Script
 * Maintains communication with the AI Agent server, captures tab viewports, and drives browser automation.
 */

// Production Cloud Run URL for this deployment
const DEFAULT_SERVER_URL = 'https://ais-dev-exfiywpcnb6acobye7ziaf-439861698598.asia-southeast1.run.app';

let serverUrl = DEFAULT_SERVER_URL;
let isConnected = false;
let isPolling = false;
let pollAbortController = null;

// Load stored server URL, auto-upgrading away from legacy localhost
browser.storage.local.get(['serverUrl', 'autoConnect']).then((res) => {
  if (res.serverUrl && res.serverUrl !== 'http://localhost:3000' && res.serverUrl !== 'http://localhost:8080') {
    serverUrl = res.serverUrl.replace(/\/+$/, '');
  } else {
    serverUrl = DEFAULT_SERVER_URL;
    browser.storage.local.set({ serverUrl: DEFAULT_SERVER_URL });
  }
  console.log('[Firefox Bridge] Initialized. Target server URL:', serverUrl);
  startPollingLoop();
});

// Strip X-Frame-Options and Content-Security-Policy on embedded sidebar frames
// This allows the Firefox sidebar to embed the cloud/local web app without "will not allow Firefox to display the page" errors
if (browser.webRequest && browser.webRequest.onHeadersReceived) {
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.type === 'sub_frame') {
        const blockedHeaders = [
          'x-frame-options',
          'content-security-policy',
          'x-content-security-policy',
          'frame-options',
        ];
        const responseHeaders = (details.responseHeaders || []).filter(
          (h) => !blockedHeaders.includes(h.name.toLowerCase())
        );
        return { responseHeaders };
      }
      return {};
    },
    { urls: ['<all_urls>'], types: ['sub_frame'] },
    ['blocking', 'responseHeaders']
  );
}

// Broadcast status to popup or storage
function updateStatus(connected, extra = '') {
  isConnected = connected;
  browser.storage.local.set({
    isConnected,
    lastSeen: Date.now(),
    statusText: connected ? 'Connected to AI Agent' : 'Connecting...',
    serverUrl,
  });
}

// Injects content script safely into active tab
async function ensureContentScript(tabId) {
  try {
    await browser.tabs.executeScript(tabId, { file: 'contentScript.js' });
  } catch (err) {
    console.warn('[Firefox Bridge] Content script injection notice:', err);
  }
}

// Get the active browser tab safely across windows and panels
async function getTargetTab() {
  let tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tabs || tabs.length === 0) {
    tabs = await browser.tabs.query({ active: true, currentWindow: true });
  }
  if (!tabs || tabs.length === 0) {
    tabs = await browser.tabs.query({ active: true });
  }
  if (!tabs || tabs.length === 0) {
    tabs = await browser.tabs.query({});
  }
  if (!tabs || tabs.length === 0) {
    const newTab = await browser.tabs.create({ url: 'https://www.google.com', active: true });
    return newTab;
  }
  return tabs[0];
}

async function waitForTabLoad(tabId, timeoutMs = 4500) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      browser.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        setTimeout(finish, 250);
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

// Get full browser state (Screenshot + Accessibility Tree + Tabs)
async function getFullBrowserState() {
  const activeTab = await getTargetTab();
  if (!activeTab || !activeTab.id) {
    throw new Error('No active Firefox tab found.');
  }

  // 1. Capture tab screenshot for the target window
  let screenshotBase64 = '';
  try {
    screenshotBase64 = await browser.tabs.captureVisibleTab(activeTab.windowId ?? null, {
      format: 'jpeg',
      quality: 75,
    });
  } catch (e) {
    console.warn('[Firefox Bridge] Could not capture tab screenshot:', e);
  }

  // 2. Query all open tabs in current/focused window
  let allTabs = await browser.tabs.query({ windowId: activeTab.windowId });
  if (!allTabs || allTabs.length === 0) {
    allTabs = await browser.tabs.query({});
  }
  const formattedTabs = allTabs.map((t) => ({
    id: `tab-${t.id}`,
    title: t.title || 'Untitled Tab',
    url: t.url || '',
    isLoading: t.status === 'loading',
  }));

  // 3. Inject content script and extract interactive DOM
  let pageData = {
    elementCount: 0,
    accessibilityTree: '',
    focusedElement: null,
    rawHtmlLength: 0,
  };

  try {
    await ensureContentScript(activeTab.id);
    const resp = await browser.tabs.sendMessage(activeTab.id, { action: 'getPageData' });
    if (resp && resp.success) {
      pageData = resp;
    }
  } catch (e) {
    console.warn('[Firefox Bridge] DOM extraction fallback:', e);
  }

  return {
    activeTabId: `tab-${activeTab.id}`,
    tabs: formattedTabs,
    url: activeTab.url || '',
    title: activeTab.title || 'Untitled',
    screenshotBase64,
    cleanedHtml: '',
    accessibilityTree: pageData.accessibilityTree || `Active Tab: ${activeTab.title} (${activeTab.url})`,
    elementCount: pageData.elementCount || 0,
    rawHtmlLength: pageData.rawHtmlLength || 0,
    cleanedHtmlLength: 0,
    focusedElement: pageData.focusedElement,
    isLocalBrowser: true,
    clientName: 'Firefox on antiX Linux',
  };
}

// Execute commands received from the AI Agent server
async function executeCommand(cmd) {
  const { action, params = {} } = cmd;

  if (action === 'getState') {
    return await getFullBrowserState();
  }

  const activeTab = await getTargetTab();
  if (!activeTab || !activeTab.id) {
    throw new Error('No active tab available for action');
  }

  if (action === 'navigate') {
    let targetUrl = params.url || 'https://www.google.com';
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
        targetUrl = `https://${targetUrl}`;
      } else {
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
      }
    }
    const loadPromise = waitForTabLoad(activeTab.id, 4500);
    await browser.tabs.update(activeTab.id, { url: targetUrl });
    await loadPromise;
    return await getFullBrowserState();
  }

  if (action === 'open_tab') {
    let url = params.url || 'https://www.google.com';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    const createdTab = await browser.tabs.create({ url, active: true });
    if (createdTab && createdTab.id) {
      await waitForTabLoad(createdTab.id, 4500);
    } else {
      await new Promise((r) => setTimeout(r, 1000));
    }
    return await getFullBrowserState();
  }

  if (action === 'switch_tab') {
    const rawId = parseInt(String(params.tab_id || '').replace('tab-', ''), 10);
    if (!isNaN(rawId)) {
      await browser.tabs.update(rawId, { active: true });
      await new Promise((r) => setTimeout(r, 400));
    }
    return await getFullBrowserState();
  }

  if (action === 'close_tab') {
    const rawId = parseInt(String(params.tab_id || '').replace('tab-', ''), 10);
    if (!isNaN(rawId)) {
      await browser.tabs.remove(rawId);
      await new Promise((r) => setTimeout(r, 400));
    }
    return await getFullBrowserState();
  }

  // Interactive page actions dispatched to content script
  await ensureContentScript(activeTab.id);
  const actionRes = await browser.tabs.sendMessage(activeTab.id, { action, params });

  // Brief pause for DOM update before taking new state
  await new Promise((r) => setTimeout(r, 400));
  const freshState = await getFullBrowserState();

  return {
    success: actionRes ? actionRes.success : true,
    message: actionRes?.message || `Executed ${action}`,
    state: freshState,
  };
}

// Long-polling loop with AI Agent server
async function startPollingLoop() {
  if (isPolling) return;
  isPolling = true;

  while (isPolling) {
    try {
      // 1. Send poll request
      pollAbortController = new AbortController();
      const res = await fetch(`${serverUrl}/api/extension/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          browserName: 'Firefox',
          browserVersion: navigator.userAgent,
          os: 'antiX Linux',
        }),
        signal: pollAbortController.signal,
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        updateStatus(false);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      updateStatus(true);
      const data = await res.json();

      if (data && data.command) {
        const cmd = data.command;
        console.log('[Firefox Bridge] Executing command:', cmd.action, cmd.id);

        try {
          const result = await executeCommand(cmd);
          await fetch(`${serverUrl}/api/extension/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              commandId: cmd.id,
              result,
            }),
          });
        } catch (err) {
          console.error('[Firefox Bridge] Command execution error:', err);
          await fetch(`${serverUrl}/api/extension/respond`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              commandId: cmd.id,
              error: err.message,
            }),
          });
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        updateStatus(false);
        // Wait before reconnecting
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}

// Periodic Heartbeat to maintain active connection with server
setInterval(async () => {
  try {
    const activeTab = await getTargetTab().catch(() => null);
    const res = await fetch(`${serverUrl}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        browserName: 'Firefox',
        browserVersion: 'Desktop',
        os: 'antiX Linux',
        activeTabTitle: activeTab?.title || 'Firefox Active Tab',
        activeTabUrl: activeTab?.url || '',
      }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      updateStatus(true);
    } else {
      updateStatus(false);
    }
  } catch (err) {
    console.warn('[Firefox Bridge] Heartbeat notice: Could not reach', serverUrl);
  }
}, 12000);

// Toggle sidebar when extension toolbar icon is clicked
if (browser.browserAction && browser.browserAction.onClicked) {
  browser.browserAction.onClicked.addListener(async () => {
    try {
      if (browser.sidebarAction && typeof browser.sidebarAction.toggle === 'function') {
        await browser.sidebarAction.toggle();
      } else if (browser.sidebarAction && typeof browser.sidebarAction.open === 'function') {
        await browser.sidebarAction.open();
      }
    } catch (err) {
      console.warn('[Firefox Bridge] Could not toggle sidebar:', err);
    }
  });
}

// Messages from extension sidebar or popup
browser.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.type === 'SET_SERVER_URL') {
    serverUrl = req.url.replace(/\/+$/, '');
    browser.storage.local.set({ serverUrl });
    if (pollAbortController) {
      try { pollAbortController.abort(); } catch (_) {}
    }
    isPolling = false;
    setTimeout(() => startPollingLoop(), 100);
    sendResponse({ success: true, serverUrl });
    return true;
  }

  if (req.type === 'GET_STATUS') {
    sendResponse({
      isConnected,
      serverUrl,
    });
    return true;
  }

  if (req.type === 'OPEN_SIDEBAR') {
    if (browser.sidebarAction && typeof browser.sidebarAction.open === 'function') {
      browser.sidebarAction.open().then(() => sendResponse({ success: true }));
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  if (req.type === 'GET_BROWSER_STATE') {
    getFullBrowserState()
      .then((state) => sendResponse({ success: true, state }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (req.type === 'EXECUTE_BROWSER_COMMAND') {
    executeCommand(req.command)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
