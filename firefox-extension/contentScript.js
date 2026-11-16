/**
 * AI Agent Firefox Content Script
 * Extracts interactive DOM nodes, builds the accessibility tree, and handles synthetic interaction events.
 */
(() => {
  // Prevent duplicate listener registration
  if (window.__aiAgentContentScriptLoaded) return;
  window.__aiAgentContentScriptLoaded = true;

  // Global map for quick element lookup
  const elementMap = new Map();
  const linkMap = new Map();

  function scanInteractiveElements() {
    elementMap.clear();
    linkMap.clear();

    const selector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="combobox"]',
      '[role="searchbox"]',
      '[role="textbox"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[tabindex="0"]',
      'summary',
    ].join(', ');

    const allCandidates = Array.from(document.querySelectorAll(selector));
    const treeLines = [];
    let elCounter = 1;
    let linkCounter = 1;

    for (const el of allCandidates) {
      if (!(el instanceof HTMLElement)) continue;

      // Check visibility
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        el.getAttribute('aria-hidden') === 'true'
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue;

      // Don't include elements way off-screen
      if (rect.bottom < -100 || rect.top > window.innerHeight + 1200) continue;

      const agentId = `el-${elCounter++}`;
      el.setAttribute('data-agent-id', agentId);
      elementMap.set(agentId, el);

      const tagName = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tagName;
      let text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
      if (text.length > 80) text = text.substring(0, 77) + '...';

      let details = '';

      if (tagName === 'a' && el.hasAttribute('href')) {
        const href = el.href;
        const refId = `#L${linkCounter++}`;
        linkMap.set(refId, href);
        linkMap.set(agentId, href);
        details = ` [ref="${refId}"] [url="${href}"]`;
      } else if (tagName === 'input' || tagName === 'textarea') {
        const type = el.type || 'text';
        const val = el.value ? ` [value="${el.value.substring(0, 30)}"]` : '';
        const placeholder = el.placeholder ? ` [placeholder="${el.placeholder}"]` : '';
        details = ` (type="${type}"${placeholder}${val})`;
      } else if (tagName === 'select') {
        const selectedOpt = el.options[el.selectedIndex]?.text || '';
        details = ` [selected="${selectedOpt}"]`;
      }

      const isFocused = document.activeElement === el ? ' [FOCUSED]' : '';
      const pos = `at (${Math.round(rect.left + rect.width / 2)}, ${Math.round(rect.top + rect.height / 2)})`;

      treeLines.push(`[${agentId}] ${role.toUpperCase()}: "${text}"${details}${isFocused} ${pos}`);
    }

    const focusedEl = document.activeElement instanceof HTMLElement ? {
      tagName: document.activeElement.tagName.toLowerCase(),
      type: document.activeElement.type,
      placeholder: document.activeElement.placeholder,
      name: document.activeElement.name,
      value: document.activeElement.value,
      isInput: ['input', 'textarea', 'select'].includes(document.activeElement.tagName.toLowerCase()),
    } : null;

    return {
      elementCount: elementMap.size,
      accessibilityTree: treeLines.join('\n'),
      focusedElement: focusedEl,
      rawHtmlLength: document.documentElement.outerHTML.length,
    };
  }

  function findElement(target) {
    if (!target) return null;
    const clean = target.trim();

    // Check data-agent-id
    if (elementMap.has(clean)) return elementMap.get(clean);
    if (clean.startsWith('[data-agent-id=')) {
      const match = clean.match(/data-agent-id=['"]([^'"]+)['"]/);
      if (match && elementMap.has(match[1])) return elementMap.get(match[1]);
    }
    const byAttr = document.querySelector(`[data-agent-id="${clean}"]`);
    if (byAttr instanceof HTMLElement) return byAttr;

    // Check CSS selector
    try {
      const byQuery = document.querySelector(clean);
      if (byQuery instanceof HTMLElement) return byQuery;
    } catch (_) {}

    // Check text fallback
    for (const [, el] of elementMap.entries()) {
      if (el.innerText && el.innerText.trim().toLowerCase() === clean.toLowerCase()) {
        return el;
      }
    }

    return null;
  }

  // Listen for actions dispatched from extension background.js
  browser.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const { action, params } = request;

    if (action === 'getPageData') {
      const data = scanInteractiveElements();
      sendResponse({ success: true, ...data });
      return true;
    }

    if (action === 'click') {
      const el = findElement(params.target);
      if (!el) {
        sendResponse({ success: false, message: `Element not found: ${params.target}` });
        return true;
      }

      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      el.focus();

      const rect = el.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;

      const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();

      setTimeout(() => {
        sendResponse({ success: true, message: `Clicked ${params.target}` });
      }, 300);
      return true;
    }

    if (action === 'type') {
      const el = findElement(params.target);
      if (!el) {
        sendResponse({ success: false, message: `Input element not found: ${params.target}` });
        return true;
      }

      el.scrollIntoView({ behavior: 'instant', block: 'center' });
      el.focus();

      const nextVal = params.value || '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && typeof descriptor.set === 'function') {
          descriptor.set.call(el, nextVal);
        } else {
          el.value = nextVal;
        }
      } else if ('value' in el) {
        el.value = nextVal;
      } else {
        el.innerText = nextVal;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      if (params.submit) {
        const form = el.form || el.closest('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            form.submit();
          }
        } else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        }
      }

      setTimeout(() => {
        sendResponse({ success: true, message: `Typed into ${params.target}` });
      }, 300);
      return true;
    }

    if (action === 'scroll') {
      const dir = params.direction === 'up' ? -1 : 1;
      const amount = (params.amount || 400) * dir;
      window.scrollBy({ top: amount, behavior: 'instant' });
      setTimeout(() => {
        sendResponse({ success: true, message: `Scrolled ${params.direction}` });
      }, 200);
      return true;
    }

    if (action === 'press_key') {
      const key = params.key || 'Enter';
      const active = document.activeElement || document.body;
      active.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      active.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      if (key === 'Enter' && active instanceof HTMLElement) {
        const form = ('form' in active && active.form) ? active.form : active.closest('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }
      }
      setTimeout(() => {
        sendResponse({ success: true, message: `Pressed key ${key}` });
      }, 200);
      return true;
    }

    if (action === 'hover') {
      const el = findElement(params.target);
      if (el) {
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        sendResponse({ success: true, message: `Hovered ${params.target}` });
      } else {
        sendResponse({ success: false, message: `Target not found for hover` });
      }
      return true;
    }

    if (action === 'mouse_click') {
      const clientX = params.x || 0;
      const clientY = params.y || 0;
      const el = document.elementFromPoint(clientX, clientY) || document.body;
      if (el instanceof HTMLElement) {
        el.focus();
        const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.click();
      }
      setTimeout(() => {
        sendResponse({ success: true, message: `Clicked at (${clientX}, ${clientY})` });
      }, 200);
      return true;
    }

    if (action === 'keyboard_type') {
      const active = document.activeElement;
      const text = params.text || '';
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const start = active.selectionStart || active.value.length;
        const end = active.selectionEnd || active.value.length;
        const nextVal = active.value.substring(0, start) + text + active.value.substring(end);
        const proto = active instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && typeof descriptor.set === 'function') {
          descriptor.set.call(active, nextVal);
        } else {
          active.value = nextVal;
        }
        active.selectionStart = active.selectionEnd = start + text.length;
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (active && active.isContentEditable) {
        document.execCommand('insertText', false, text);
      }
      setTimeout(() => {
        sendResponse({ success: true, message: `Typed "${text}"` });
      }, 200);
      return true;
    }

    if (action === 'keyboard_press') {
      const key = params.key || 'Enter';
      const active = document.activeElement || document.body;
      active.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      active.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      if (key === 'Enter' && active instanceof HTMLElement) {
        const form = ('form' in active && active.form) ? active.form : active.closest('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        }
      }
      setTimeout(() => {
        sendResponse({ success: true, message: `Pressed key ${key}` });
      }, 200);
      return true;
    }

    if (action === 'clear_input') {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        active.value = '';
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
      }
      setTimeout(() => {
        sendResponse({ success: true, message: 'Cleared input' });
      }, 200);
      return true;
    }

    sendResponse({ success: false, message: `Unknown action: ${action}` });
    return true;
  });
})();
