document.addEventListener('DOMContentLoaded', () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const saveBtn = document.getElementById('saveBtn');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const activeTabInfo = document.getElementById('activeTabInfo');
  const btnOpenSidebar = document.getElementById('btnOpenSidebar');
  const btnOpenWeb = document.getElementById('btnOpenWeb');
  const btnReloadExt = document.getElementById('btnReloadExt');
  const pingBtn = document.getElementById('pingBtn');
  const feedbackMsg = document.getElementById('feedbackMsg');

  const CLOUD_APP_URL = 'https://ais-dev-exfiywpcnb6acobye7ziaf-439861698598.asia-southeast1.run.app';
  let currentServerUrl = CLOUD_APP_URL;

  // Query local active tab
  if (typeof browser !== 'undefined' && browser.tabs) {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs && tabs[0]) {
        activeTabInfo.textContent = `Tab: ${tabs[0].title || 'Untitled'} (${tabs[0].url ? new URL(tabs[0].url).hostname : 'about:blank'})`;
      }
    }).catch(() => {});
  }

  // Load current settings from background runtime or storage
  if (typeof browser !== 'undefined' && browser.runtime) {
    browser.runtime.sendMessage({ type: 'GET_STATUS' }).then((res) => {
      if (res) {
        if (res.serverUrl && res.serverUrl !== 'http://localhost:3000' && res.serverUrl !== 'http://localhost:8080') {
          currentServerUrl = res.serverUrl;
        } else {
          currentServerUrl = CLOUD_APP_URL;
        }
        serverUrlInput.value = currentServerUrl;
        updateStatusUI(res.isConnected);
      }
    }).catch(() => {});

    browser.storage.local.get(['isConnected', 'serverUrl']).then((res) => {
      if (res.serverUrl && res.serverUrl !== 'http://localhost:3000' && res.serverUrl !== 'http://localhost:8080') {
        currentServerUrl = res.serverUrl;
        serverUrlInput.value = res.serverUrl;
      } else {
        currentServerUrl = CLOUD_APP_URL;
        serverUrlInput.value = CLOUD_APP_URL;
      }
      if (res.isConnected !== undefined) {
        updateStatusUI(res.isConnected);
      }
    }).catch(() => {});
  }

  function updateStatusUI(connected) {
    if (connected) {
      statusDot.className = 'dot connected';
      statusText.textContent = 'Connected';
      statusText.style.color = '#f4f4f5';
    } else {
      statusDot.className = 'dot disconnected';
      statusText.textContent = 'Standby';
      statusText.style.color = '#a1a1aa';
    }
  }

  // Ping server check
  async function performPing() {
    pingBtn.textContent = 'Pinging...';
    const start = Date.now();
    try {
      const res = await fetch(`${serverUrlInput.value.trim().replace(/\/+$/, '')}/api/extension/status`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const elapsed = Date.now() - start;
      if (data && data.connected !== undefined) {
        updateStatusUI(data.connected);
        pingBtn.textContent = `${elapsed}ms`;
      } else {
        pingBtn.textContent = 'OK';
      }
    } catch (e) {
      statusDot.className = 'dot disconnected';
      statusText.textContent = 'Unreachable';
      statusText.style.color = '#ef4444';
      pingBtn.textContent = 'Failed';
    }
    setTimeout(() => {
      pingBtn.textContent = 'Ping';
    }, 2500);
  }

  pingBtn.addEventListener('click', performPing);

  // Save server URL
  saveBtn.addEventListener('click', () => {
    const url = serverUrlInput.value.trim().replace(/\/+$/, '');
    if (!url) return;

    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.sendMessage({ type: 'SET_SERVER_URL', url }).then(() => {
        currentServerUrl = url;
        feedbackMsg.style.display = 'block';
        saveBtn.textContent = 'Saved';
        saveBtn.disabled = false;
        performPing();
        setTimeout(() => {
          feedbackMsg.style.display = 'none';
          saveBtn.textContent = 'Save';
        }, 2000);
      }).catch(() => {
        saveBtn.textContent = 'Error';
        saveBtn.disabled = false;
      });
    }
  });

  // Open Sidebar button
  btnOpenSidebar.addEventListener('click', () => {
    if (typeof browser !== 'undefined' && browser.sidebarAction) {
      browser.sidebarAction.open().catch(() => {
        // Fallback: toggle if open fails
        if (browser.sidebarAction.toggle) {
          browser.sidebarAction.toggle();
        }
      });
      window.close();
    }
  });

  // Open web dashboard in a real Firefox tab
  btnOpenWeb.addEventListener('click', () => {
    const targetUrl = serverUrlInput.value.trim() || currentServerUrl;
    if (typeof browser !== 'undefined' && browser.tabs) {
      browser.tabs.create({ url: targetUrl });
      window.close();
    }
  });

  // Reload extension
  btnReloadExt.addEventListener('click', () => {
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.reload) {
      browser.runtime.reload();
      window.close();
    }
  });
});
