import { chromium } from 'patchright';
import type { Browser, BrowserContext, Page } from 'patchright';
import { execSync } from 'child_process';

export interface RealTabInfo {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
}

export interface FocusedElementInfo {
  tagName: string;
  type?: string;
  placeholder?: string;
  name?: string;
  value?: string;
  isInput: boolean;
}

export interface ProxyTunnelConfig {
  enabled: boolean;
  server: string;
  username?: string;
  password?: string;
}

export interface RealBrowserState {
  activeTabId: string;
  tabs: RealTabInfo[];
  url: string;
  title: string;
  screenshotBase64: string;
  cleanedHtml?: string;
  accessibilityTree: string;
  elementCount: number;
  rawHtmlLength?: number;
  cleanedHtmlLength?: number;
  focusedElement?: FocusedElementInfo | null;
}

interface AxTargetEntry {
  backendDOMNodeId: number;
  role: string;
  name: string;
  value?: string;
  url?: string;
}

class ChromiumManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<string, Page> = new Map();
  private activePageId: string = 'tab-1';
  private isInitializing: boolean = false;
  private tabCounter: number = 0;
  // Link map: maps indexed refs like #L1, #L2 to real target URLs
  private linkMap: Map<string, string> = new Map();
  // Native CDP AX element map: maps el-1, el-2 -> backendDOMNodeId
  private axTargetMap: Map<string, AxTargetEntry> = new Map();
  private cdpSessions: WeakMap<Page, any> = new WeakMap();
  private proxyConfig: ProxyTunnelConfig = {
    enabled: false,
    server: '',
    username: '',
    password: '',
  };
  private activeTimezoneId: string = '';
  private resolvedTimezoneCache: Map<string, string> = new Map();

  public async init(): Promise<void> {
    if (this.browser && this.context) return;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 200));
      }
      return;
    }

    this.isInitializing = true;
    try {
      console.log('[Patchright Engine] Launching native Patchright Chromium engine...');
      const launchOptions: any = {
        channel: 'chromium',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--window-size=1280,800',
          '--disable-infobars',
          '--lang=en-US,en',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      };

      try {
        this.browser = (await chromium.launch(launchOptions)) as unknown as Browser;
      } catch (launchErr: any) {
        const errMsg = String(launchErr?.message || '');
        if (errMsg.includes("doesn't exist") || errMsg.includes('Executable') || errMsg.includes('chromium')) {
          console.warn('[Patchright Engine] Missing browser executable detected! Auto-downloading Patchright Chromium now...');
          try {
            execSync('npx patchright install chromium', { stdio: 'inherit' });
            console.log('[Patchright Engine] Patchright Chromium installed successfully. Retrying launch...');
            this.browser = (await chromium.launch(launchOptions)) as unknown as Browser;
          } catch (installErr) {
            console.error('[Patchright Engine] Failed to auto-install Patchright Chromium:', installErr);
            throw launchErr;
          }
        } else {
          throw launchErr;
        }
      }

      const proxyKey = this.proxyConfig.enabled && this.proxyConfig.server.trim()
        ? this.proxyConfig.server.trim()
        : 'direct';

      let resolvedTimezone = this.resolvedTimezoneCache.get(proxyKey);
      if (!resolvedTimezone && proxyKey === 'direct') {
        try {
          const geoRes = await fetch('http://ip-api.com/json?fields=status,timezone', {
            signal: AbortSignal.timeout(1800),
          });
          if (geoRes.ok) {
            const geo: any = await geoRes.json();
            const tz = typeof geo?.timezone === 'string' ? geo.timezone.trim() : '';
            if (geo?.status === 'success' && tz) {
              resolvedTimezone = tz;
              this.resolvedTimezoneCache.set('direct', tz);
            }
          }
        } catch {}
      }

      const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      this.activeTimezoneId = resolvedTimezone || fallbackTimezone;

      const majorVersion = (this.browser?.version() || '136.0.0.0').split('.')[0];
      const osPlatformToken =
        process.platform === 'darwin'
          ? 'Macintosh; Intel Mac OS X 10_15_7'
          : process.platform === 'win32'
            ? 'Windows NT 10.0; Win64; x64'
            : 'X11; Linux x86_64';

      // Match real host OS, real Chromium major version, native Sec-CH-UA headers, and native GPU cleanly
      const contextOptions: any = {
        viewport: { width: 1280, height: 800 },
        userAgent: `Mozilla/5.0 (${osPlatformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion}.0.0.0 Safari/537.36`,
        locale: 'en-US',
        timezoneId: this.activeTimezoneId,
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      };

      if (this.proxyConfig.enabled && this.proxyConfig.server.trim()) {
        const cleanServer = this.proxyConfig.server.trim();
        try {
          if (cleanServer.includes('@')) {
            const parsed = new URL(cleanServer.includes('://') ? cleanServer : `http://${cleanServer}`);
            contextOptions.proxy = {
              server: `${parsed.protocol}//${parsed.host}`,
              username: decodeURIComponent(parsed.username) || this.proxyConfig.username || undefined,
              password: decodeURIComponent(parsed.password) || this.proxyConfig.password || undefined,
            };
          } else {
            contextOptions.proxy = {
              server: cleanServer.includes('://') ? cleanServer : `http://${cleanServer}`,
              username: this.proxyConfig.username?.trim() || undefined,
              password: this.proxyConfig.password?.trim() || undefined,
            };
          }
          console.log(`[Patchright Engine] Routing all browser traffic through Stealth Tunnel: ${contextOptions.proxy.server}`);
        } catch (e: any) {
          console.warn('[Patchright Engine] Invalid proxy URL, falling back to direct:', e.message);
        }
      }

      this.context = await this.browser.newContext(contextOptions);
      console.log(`[Patchright Engine] Context created cleanly (timezone: ${this.activeTimezoneId}, native UA/GPU/headers).`);

      // Automatically detect any popups or new tabs (e.g. window.open)
      this.context.on('page', (newPage: Page) => {
        const id = this.registerPage(newPage);
        this.activePageId = id;
      });

      const initialPage = await this.context.newPage();
      this.activePageId = this.registerPage(initialPage);

      await initialPage.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      console.log(`[Chromium] Stealth Chromium initialized and active on ${this.activePageId}.`);
    } catch (err) {
      console.error('[Chromium] Failed to launch Chromium:', err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  private registerPage(page: Page): string {
    for (const [id, p] of this.pages.entries()) {
      if (p === page) return id;
    }
    const newId = `tab-${++this.tabCounter}`;
    this.pages.set(newId, page);
    this.setupPageListeners(page, newId);
    return newId;
  }

  private setupPageListeners(page: Page, id: string): void {
    if ((page as any).__listenersAttached) return;
    (page as any).__listenersAttached = true;

    page.on('close', () => {
      this.pages.delete(id);
      if (this.activePageId === id) {
        const remaining = Array.from(this.pages.keys());
        this.activePageId = remaining[remaining.length - 1] || 'tab-1';
      }
    });

    page.on('crash', () => {
      console.warn(`[Chromium] Tab crashed: ${id}`);
      this.pages.delete(id);
    });
  }

  // Synchronize internal page map with actual live context pages
  private async syncPages(): Promise<void> {
    if (!this.context) return;
    const contextPages = this.context.pages();

    // Remove any pages that are closed or no longer exist in context
    for (const [id, p] of Array.from(this.pages.entries())) {
      if (p.isClosed() || !contextPages.includes(p)) {
        this.pages.delete(id);
      }
    }

    // Register any context page that wasn't tracked yet
    for (const cp of contextPages) {
      if (!cp.isClosed()) {
        this.registerPage(cp);
      }
    }

    if (!this.pages.has(this.activePageId) || this.pages.get(this.activePageId)?.isClosed()) {
      const remaining = Array.from(this.pages.keys());
      if (remaining.length > 0) {
        this.activePageId = remaining[remaining.length - 1];
      }
    }
  }

  public async getActivePage(): Promise<Page> {
    await this.init();
    await this.syncPages();

    let page = this.pages.get(this.activePageId);
    if (!page || page.isClosed()) {
      const remaining = Array.from(this.pages.entries()).filter(([_, p]) => !p.isClosed());
      if (remaining.length > 0) {
        this.activePageId = remaining[remaining.length - 1][0];
        page = remaining[remaining.length - 1][1];
      }
    }

    // Only create a new page if NO pages exist at all in context
    if ((!page || page.isClosed()) && this.pages.size === 0) {
      if (!this.context) throw new Error('Context not initialized');
      page = await this.context.newPage();
      this.activePageId = this.registerPage(page);
      await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    return page!;
  }

  public async getTabs(): Promise<RealTabInfo[]> {
    await this.syncPages();
    const tabList: RealTabInfo[] = [];
    for (const [id, page] of this.pages.entries()) {
      if (page.isClosed()) continue;
      let title = 'Chrome Tab';
      let url = 'about:blank';
      try {
        title = await page.title();
        url = page.url();
      } catch {}
      tabList.push({
        id,
        title: title || url || 'Chrome Tab',
        url: url || 'about:blank',
        isLoading: false,
      });
    }
    return tabList;
  }

  public getRealUrlForLink(linkId: string): string | undefined {
    return this.linkMap.get(linkId);
  }

  private async getCDPSession(page: Page, forceNew: boolean = false): Promise<any> {
    if (!this.context) throw new Error('Context not initialized');
    if (!forceNew && this.cdpSessions.has(page)) {
      return this.cdpSessions.get(page);
    }
    const cdp = await this.context.newCDPSession(page);
    await cdp.send('DOM.enable').catch(() => {});
    await cdp.send('Accessibility.enable').catch(() => {});
    await cdp.send('Page.enable').catch(() => {});
    this.cdpSessions.set(page, cdp);
    return cdp;
  }

  private normalizeTargetId(raw: string): string {
    return raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  }

  private quadToBox(quad: number[]): { x: number; y: number; width: number; height: number } | null {
    if (!Array.isArray(quad) || quad.length < 8) return null;
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }

  private async resolveCdpTarget(
    page: Page,
    backendDOMNodeId: number
  ): Promise<{ cdp: any; box: { x: number; y: number; width: number; height: number } | null; objectId: string | null }> {
    let cdp = await this.getCDPSession(page);
    try {
      await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: backendDOMNodeId }).catch(() => {});
    } catch {
      cdp = await this.getCDPSession(page, true);
      await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: backendDOMNodeId }).catch(() => {});
    }

    let box: { x: number; y: number; width: number; height: number } | null = null;
    try {
      const quadsRes = await cdp.send('DOM.getContentQuads', { backendNodeId: backendDOMNodeId });
      if (Array.isArray(quadsRes?.quads) && quadsRes.quads.length > 0) {
        const candidate = this.quadToBox(quadsRes.quads[0]);
        if (candidate && candidate.width > 0 && candidate.height > 0) {
          box = candidate;
        }
      }
    } catch {}

    if (!box) {
      try {
        const boxRes = await cdp.send('DOM.getBoxModel', { backendNodeId: backendDOMNodeId });
        const candidate = this.quadToBox(boxRes?.model?.border || boxRes?.model?.content);
        if (candidate && candidate.width > 0 && candidate.height > 0) {
          box = candidate;
        }
      } catch {}
    }

    let objectId: string | null = null;
    try {
      const resolved = await cdp.send('DOM.resolveNode', { backendNodeId: backendDOMNodeId });
      objectId = resolved?.object?.objectId || null;
    } catch {}

    if (!box && objectId) {
      try {
        const rectRes = await cdp.send('Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: `function() {
            const el = this.nodeType === 3 ? this.parentElement : this;
            if (!el || typeof el.getBoundingClientRect !== 'function') return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.left, y: r.top, width: r.width, height: r.height };
          }`,
          returnByValue: true,
        });
        const v = rectRes?.result?.value;
        if (v && v.width > 0 && v.height > 0) {
          box = v;
        }
      } catch {}
    }

    return { cdp, box, objectId };
  }

  private async extractNativeAccessibilityTree(
    page: Page
  ): Promise<{ accessibilityTree: string; elementCount: number }> {
    this.axTargetMap.clear();
    this.linkMap.clear();

    let cdp: any;
    let mainAxRes: any;
    try {
      cdp = await this.getCDPSession(page);
      mainAxRes = await cdp.send('Accessibility.getFullAXTree');
    } catch {
      try {
        cdp = await this.getCDPSession(page, true);
        mainAxRes = await cdp.send('Accessibility.getFullAXTree');
      } catch (err: any) {
        console.error('[Chromium AX] Failed to retrieve native CDP accessibility tree:', err?.message || err);
        return { accessibilityTree: '', elementCount: 0 };
      }
    }

    const childFrameTrees = new Map<string, any[]>();
    try {
      const frameTreeRes = await cdp.send('Page.getFrameTree');
      const collectChildFrameIds = (node: any): string[] => {
        const ids: string[] = [];
        if (Array.isArray(node?.childFrames)) {
          for (const cf of node.childFrames) {
            if (cf?.frame?.id) ids.push(cf.frame.id);
            ids.push(...collectChildFrameIds(cf));
          }
        }
        return ids;
      };
      const childFrameIds = collectChildFrameIds(frameTreeRes?.frameTree).slice(0, 8);
      await Promise.all(
        childFrameIds.map(async (frameId) => {
          try {
            const res = await cdp.send('Accessibility.getFullAXTree', { frameId });
            if (Array.isArray(res?.nodes) && res.nodes.length > 0) {
              childFrameTrees.set(frameId, res.nodes);
            }
          } catch {}
        })
      );
    } catch {}

    const IGNORED_SUBTREE_REASONS = new Set([
      'notRendered',
      'ariaHiddenSubtree',
      'ariaHiddenElement',
      'inertSubtree',
      'hiddenElement',
      'notVisible',
    ]);

    const INTERACTIVE_ROLES = new Set([
      'button',
      'link',
      'textbox',
      'searchbox',
      'combobox',
      'listbox',
      'option',
      'checkbox',
      'radio',
      'switch',
      'tab',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'treeitem',
      'slider',
      'spinbutton',
      'disclosuretriangle',
    ]);

    const MODAL_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox']);
    const LANDMARK_ROLES = new Set(['navigation', 'main', 'form', 'alert', 'status']);

    const getProp = (node: any, name: string): any => {
      if (!Array.isArray(node?.properties)) return undefined;
      const p = node.properties.find((prop: any) => prop?.name === name);
      return p?.value?.value;
    };

    const sanitizeText = (raw: any, maxLen: number): string => {
      if (raw === undefined || raw === null) return '';
      return String(raw)
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/"/g, "'")
        .trim()
        .slice(0, maxLen);
    };

    const isHiddenIgnored = (node: any): boolean => {
      if (getProp(node, 'hidden') === true) return true;
      if (!node?.ignored) return false;
      if (Array.isArray(node?.ignoredReasons)) {
        return node.ignoredReasons.some((r: any) => IGNORED_SUBTREE_REASONS.has(r?.name));
      }
      return false;
    };

    const lines: string[] = [];
    let interactiveCounter = 0;
    let totalChars = 0;
    const MAX_INTERACTIVE = 220;
    const MAX_LINES = 360;
    const MAX_CHARS = 16000;
    const usedChildFrames = new Set<string>();

    const pushLine = (line: string): boolean => {
      if (lines.length >= MAX_LINES || totalChars + line.length + 1 > MAX_CHARS) {
        return false;
      }
      lines.push(line);
      totalChars += line.length + 1;
      return true;
    };

    const walkAxNodes = async (
      nodes: any[],
      depth: number,
      insideModal: boolean,
      suppressedText: string
    ): Promise<void> => {
      if (!Array.isArray(nodes) || nodes.length === 0) return;
      if (lines.length >= MAX_LINES || totalChars >= MAX_CHARS) return;

      const nodeById = new Map<string, any>();
      for (const n of nodes) {
        if (n?.nodeId) nodeById.set(n.nodeId, n);
      }

      const root = nodes[0];
      const visited = new Set<string>();

      const hasInteractiveChild = (node: any, limitDepth = 3): boolean => {
        if (!node || limitDepth <= 0 || !Array.isArray(node.childIds)) return false;
        for (const cid of node.childIds) {
          const child = nodeById.get(cid);
          if (!child || isHiddenIgnored(child)) continue;
          const r = String(child?.role?.value || '').toLowerCase();
          if (INTERACTIVE_ROLES.has(r) || getProp(child, 'editable')) return true;
          if (hasInteractiveChild(child, limitDepth - 1)) return true;
        }
        return false;
      };

      const visit = async (
        nodeId: string,
        indentLevel: number,
        inModal: boolean,
        suppressed: string
      ): Promise<void> => {
        if (!nodeId || visited.has(nodeId)) return;
        if (lines.length >= MAX_LINES || totalChars >= MAX_CHARS) return;
        visited.add(nodeId);

        const node = nodeById.get(nodeId);
        if (!node) return;
        if (isHiddenIgnored(node)) return;

        const rawRole = String(node?.role?.value || '').trim();
        const roleLower = rawRole.toLowerCase();

        // Always skip low-level InlineTextBox noise
        if (roleLower === 'inlinetextbox' || roleLower === 'linebreak') return;

        // Handle embedded iframes recursively via child frame AX trees
        if ((roleLower === 'iframe' || roleLower === 'iframepresentational') && node.backendDOMNodeId) {
          let matchedFrameId: string | null = null;
          if (childFrameTrees.size > 0) {
            try {
              const desc = await cdp.send('DOM.describeNode', { backendNodeId: node.backendDOMNodeId });
              const fId = desc?.node?.frameId;
              if (fId && childFrameTrees.has(fId)) {
                matchedFrameId = fId;
              }
            } catch {}
          }
          if (matchedFrameId && !usedChildFrames.has(matchedFrameId)) {
            usedChildFrames.add(matchedFrameId);
            const indent = '  '.repeat(Math.min(indentLevel, 4));
            const frameLabel = sanitizeText(node?.name?.value, 70);
            pushLine(`${indent}iframe${frameLabel ? ` "${frameLabel}"` : ''}`);
            await walkAxNodes(childFrameTrees.get(matchedFrameId)!, indentLevel + 1, inModal, suppressed);
            return;
          }
        }

        // Transparently unwrap ignored structural nodes (e.g. generic div wrappers)
        if (node.ignored) {
          if (Array.isArray(node.childIds)) {
            for (const cid of node.childIds) {
              await visit(cid, indentLevel, inModal, suppressed);
            }
          }
          return;
        }

        const editableProp = getProp(node, 'editable');
        const focusableProp = getProp(node, 'focusable') === true;
        const modalProp = getProp(node, 'modal') === true;
        const isModalContainer = inModal || MODAL_ROLES.has(roleLower) || modalProp;

        const safeName = sanitizeText(node?.name?.value, 100);
        const safeValue = sanitizeText(node?.value?.value, 90);
        const indent = '  '.repeat(Math.min(indentLevel, 4));

        // Normalize effective role cleanly for decisionGate.ts & Brain LLM
        let effectiveRole = roleLower;
        if (editableProp && !INTERACTIVE_ROLES.has(roleLower)) {
          effectiveRole = 'textbox';
        } else if (roleLower === 'disclosuretriangle') {
          effectiveRole = 'button';
        }

        const isAlwaysInputRole =
          effectiveRole === 'textbox' ||
          effectiveRole === 'searchbox' ||
          effectiveRole === 'combobox' ||
          effectiveRole === 'checkbox' ||
          effectiveRole === 'radio' ||
          effectiveRole === 'switch' ||
          effectiveRole === 'slider' ||
          effectiveRole === 'spinbutton';

        const isInteractiveCandidate =
          Boolean(node.backendDOMNodeId) &&
          interactiveCounter < MAX_INTERACTIVE &&
          (INTERACTIVE_ROLES.has(effectiveRole) ||
            (effectiveRole === 'gridcell' && safeName.length > 0 && safeName.length <= 60 && !hasInteractiveChild(node, 2)) ||
            (focusableProp &&
              (effectiveRole === 'generic' || effectiveRole === 'cell' || effectiveRole === 'listitem' || effectiveRole === 'row') &&
              safeName.length > 0 &&
              safeName.length <= 80 &&
              !hasInteractiveChild(node, 2))) &&
          (safeName.length > 0 || safeValue.length > 0 || isAlwaysInputRole);

        let nextIndent = indentLevel;
        let nextSuppressed = suppressed;

        if (isInteractiveCandidate) {
          const id = `el-${++interactiveCounter}`;
          const linkUrl = getProp(node, 'url');
          this.axTargetMap.set(id, {
            backendDOMNodeId: node.backendDOMNodeId,
            role: effectiveRole,
            name: safeName,
            value: safeValue || undefined,
            url: typeof linkUrl === 'string' ? linkUrl : undefined,
          });
          if (typeof linkUrl === 'string' && linkUrl.startsWith('http')) {
            this.linkMap.set(id, linkUrl);
          }

          const extras: string[] = [];
          const expanded = getProp(node, 'expanded');
          const selected = getProp(node, 'selected');
          const checked = getProp(node, 'checked');
          const focused = getProp(node, 'focused');
          const disabled = getProp(node, 'disabled');

          if (expanded !== undefined) extras.push(`expanded: ${expanded}`);
          if (selected === true) extras.push('selected: true');
          if (checked !== undefined && checked !== 'false' && checked !== false) extras.push(`checked: ${checked}`);
          if (disabled === true) extras.push('disabled: true');
          if (focused === true) extras.push('focused: true');
          if (inModal || modalProp) extras.push('in_modal: true');

          let line = `${indent}- [${id}] ${effectiveRole} "${safeName}"`;
          if (safeValue && safeValue !== safeName) {
            line += ` (value: "${safeValue}")`;
          }
          if (extras.length > 0) {
            line += ` [${extras.join(', ')}]`;
          }

          pushLine(line);
          if (safeName) {
            nextSuppressed = safeName.toLowerCase();
          }
          // For listbox/combobox/menu, allow children to indent underneath; for leaf controls, suppress redundant child text
          if (MODAL_ROLES.has(effectiveRole) || effectiveRole === 'combobox') {
            nextIndent = indentLevel + 1;
          }
        } else if (MODAL_ROLES.has(roleLower) || modalProp) {
          pushLine(`${indent}${roleLower}${safeName ? ` "${safeName}"` : ''} [modal]`);
          nextIndent = indentLevel + 1;
        } else if (roleLower === 'heading' && safeName) {
          const level = getProp(node, 'level');
          if (!hasInteractiveChild(node, 2)) {
            pushLine(`${indent}heading${level ? ` [${level}]` : ''} "${safeName}"`);
            nextSuppressed = safeName.toLowerCase();
          } else {
            nextIndent = indentLevel;
          }
        } else if (LANDMARK_ROLES.has(roleLower) && (safeName || roleLower === 'alert' || roleLower === 'status')) {
          pushLine(`${indent}${roleLower}${safeName ? ` "${safeName}"` : ''}`);
          nextIndent = indentLevel + 1;
          if (safeName) nextSuppressed = safeName.toLowerCase();
        } else if (roleLower === 'statictext') {
          const cleanText = sanitizeText(node?.name?.value, 180);
          const norm = cleanText.toLowerCase();
          const isTrivialPunctuation = /^[\s|/\-•·›»<>:;,.()\[\]{}—–]+$/.test(cleanText);
          const isDuplicate = Boolean(suppressed && (suppressed === norm || suppressed.includes(norm)));
          if (cleanText.length > 0 && !isTrivialPunctuation && !isDuplicate) {
            pushLine(`${indent}text "${cleanText}"`);
          }
          return;
        }

        if (Array.isArray(node.childIds)) {
          for (const cid of node.childIds) {
            await visit(cid, nextIndent, isModalContainer, nextSuppressed);
          }
        }
      };

      if (root?.nodeId) {
        await visit(root.nodeId, depth, insideModal, suppressedText);
      }
    };

    if (Array.isArray(mainAxRes?.nodes)) {
      await walkAxNodes(mainAxRes.nodes, 0, false, '');
    }

    // Include any child frame AX trees that were not matched inline via an Iframe node
    for (const [frameId, frameNodes] of childFrameTrees.entries()) {
      if (usedChildFrames.has(frameId)) continue;
      if (lines.length >= MAX_LINES || totalChars >= MAX_CHARS) break;
      pushLine('iframe "Embedded Frame"');
      await walkAxNodes(frameNodes, 1, false, '');
    }

    return {
      accessibilityTree: lines.join('\n'),
      elementCount: interactiveCounter,
    };
  }

  public async getState(): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    const tabs = await this.getTabs();
    const url = page.url();
    const title = await page.title().catch(() => 'Chromium');

    // Capture real viewport screenshot
    let screenshotBase64 = '';
    try {
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 75 });
      screenshotBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
    } catch (e) {
      console.warn('Screenshot capture notice:', e);
    }

    // Extract native Chromium CDP Accessibility Tree (pierces Shadow DOM + child iframes)
    const { accessibilityTree, elementCount } = await this.extractNativeAccessibilityTree(page);

    // Capture currently focused element on page (including Shadow DOM activeElement)
    let focusedElement: FocusedElementInfo | null = null;
    try {
      focusedElement = await page.evaluate(() => {
        let el: Element | null = document.activeElement;
        while (el && (el as HTMLElement).shadowRoot && (el as HTMLElement).shadowRoot!.activeElement) {
          el = (el as HTMLElement).shadowRoot!.activeElement;
        }
        if (!el || el === document.body || el === document.documentElement) return null;
        const tag = el.tagName.toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea' || el.getAttribute('contenteditable') === 'true';
        return {
          tagName: tag,
          type: (el as HTMLInputElement).type || '',
          placeholder: (el as HTMLInputElement).placeholder || '',
          name: (el as HTMLInputElement).name || '',
          value: isInput ? ((el as HTMLInputElement).value || (el as HTMLElement).innerText || '') : '',
          isInput,
        };
      });
    } catch {}

    return {
      activeTabId: this.activePageId,
      tabs,
      url,
      title,
      screenshotBase64,
      accessibilityTree,
      elementCount,
      focusedElement,
    };
  }

  public async navigate(url: string): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    let formatted = url.trim();

    const resolvedFromMap = this.resolveUrlFromRef(formatted);
    if (resolvedFromMap) {
      formatted = resolvedFromMap;
    }

    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      if (formatted.includes('.') && !formatted.includes(' ')) {
        formatted = `https://${formatted}`;
      } else {
        formatted = `https://duckduckgo.com/?q=${encodeURIComponent(formatted)}`;
      }
    }

    try {
      await page.goto(formatted, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch (err: any) {
      console.warn('Navigation notice:', err.message);
    }

    await page.waitForTimeout(600).catch(() => {});
    return this.getState();
  }

  public async openTab(url: string = 'https://www.google.com'): Promise<RealBrowserState> {
    await this.init();
    if (!this.context) throw new Error('Context not initialized');

    const newPage = await this.context.newPage();
    const assignedId = this.registerPage(newPage);
    this.activePageId = assignedId;
    await newPage.bringToFront().catch(() => {});

    let formatted = (url || 'https://www.google.com').trim();
    const resolvedFromMap = this.resolveUrlFromRef(formatted);
    if (resolvedFromMap) {
      formatted = resolvedFromMap;
    }

    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = `https://${formatted}`;
    }

    await newPage.goto(formatted, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    return this.getState();
  }

  public async switchTab(tabId: string): Promise<RealBrowserState> {
    await this.syncPages();
    if (this.pages.has(tabId)) {
      this.activePageId = tabId;
      const page = this.pages.get(tabId)!;
      await page.bringToFront().catch(() => {});
    }
    return this.getState();
  }

  public async closeTab(tabId: string): Promise<RealBrowserState> {
    await this.init();
    await this.syncPages();
    if (this.pages.has(tabId) && this.pages.size > 1) {
      const page = this.pages.get(tabId)!;
      this.pages.delete(tabId);
      if (this.activePageId === tabId) {
        const remaining = Array.from(this.pages.keys());
        this.activePageId = remaining[remaining.length - 1];
        const activeP = this.pages.get(this.activePageId);
        if (activeP && !activeP.isClosed()) {
          await activeP.bringToFront().catch(() => {});
        }
      }
      await page.close().catch(() => {});
    }
    return this.getState();
  }

  private resolveUrlFromRef(ref: string): string | null {
    if (!ref) return null;
    const cleanRef = ref.replace(/^[#\[]/, '').replace(/[\]]$/, '').trim();
    if (this.linkMap.has(cleanRef)) return this.linkMap.get(cleanRef)!;
    if (this.linkMap.has(`#${cleanRef}`)) return this.linkMap.get(`#${cleanRef}`)!;
    if (this.linkMap.has(`L${cleanRef}`)) return this.linkMap.get(`L${cleanRef}`)!;
    return null;
  }

  public async click(target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    await this.init();
    const page = await this.getActivePage();

    try {
      let selector = target.trim();

      // Check if reference points to a mapped link
      if (selector.startsWith('#L') || selector.startsWith('L') || (selector.startsWith('[') && selector.includes('L'))) {
        const cleanRef = selector.replace(/^[#\[]/, '').replace(/[\]]$/, '');
        const realUrl = this.linkMap.get(cleanRef) || this.linkMap.get(`#${cleanRef}`) || this.linkMap.get(`L${cleanRef}`);
        if (realUrl) {
          await page.goto(realUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          const state = await this.getState();
          return { success: true, message: `Navigated to ${realUrl}`, state };
        }
      }

      const initialPagesCount = this.context?.pages().length || 1;
      const axId = this.normalizeTargetId(selector);
      const axEntry = this.axTargetMap.get(axId);
      let clicked = false;

      if (axEntry) {
        const { cdp, box, objectId } = await this.resolveCdpTarget(page, axEntry.backendDOMNodeId);
        if (box) {
          const clickX = box.x + box.width / 2 + (Math.random() * 4 - 2);
          const clickY = box.y + box.height / 2 + (Math.random() * 4 - 2);
          await page.mouse.move(clickX, clickY, { steps: 8 }).catch(() => {});
          await page.mouse.down().catch(() => {});
          await new Promise((r) => setTimeout(r, 45 + Math.random() * 30));
          await page.mouse.up().catch(() => {});
          clicked = true;
        } else if (objectId) {
          await cdp
            .send('Runtime.callFunctionOn', {
              objectId,
              functionDeclaration:
                'function() { const t = this.nodeType === 3 ? this.parentElement : this; if (t && typeof t.click === "function") t.click(); }',
            })
            .catch(() => {});
          clicked = true;
        }
      } else {
        let el = await page.$(selector);
        if (!el && !selector.startsWith('[') && !selector.startsWith('.') && !selector.startsWith('#')) {
          el = await page.$(`button:has-text("${selector}"), a:has-text("${selector}")`);
        }

        if (el) {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          const box = await el.boundingBox();
          if (box) {
            const clickX = box.x + box.width / 2 + (Math.random() * 4 - 2);
            const clickY = box.y + box.height / 2 + (Math.random() * 4 - 2);
            await page.mouse.move(clickX, clickY, { steps: 8 }).catch(() => {});
            await page.mouse.down().catch(() => {});
            await new Promise((r) => setTimeout(r, 45 + Math.random() * 30));
            await page.mouse.up().catch(() => {});
          } else {
            await el.click({ timeout: 3000 }).catch(async () => {
              await el!.click({ force: true, timeout: 2000 }).catch(async () => {
                await el!.evaluate((e: any) => e.click()).catch(() => {});
              });
            });
          }
          clicked = true;
        }
      }

      if (clicked) {
        await page.waitForTimeout(400).catch(() => {});

        const currentPages = this.context?.pages() || [];
        if (currentPages.length > initialPagesCount) {
          const newestPage = currentPages[currentPages.length - 1];
          let foundId = Array.from(this.pages.entries()).find(([_, p]) => p === newestPage)?.[0];
          if (!foundId) {
            foundId = `tab-${++this.tabCounter}`;
            this.pages.set(foundId, newestPage);
            this.setupPageListeners(newestPage, foundId);
          }
          this.activePageId = foundId;
          await newestPage.bringToFront().catch(() => {});
          await newestPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          const state = await this.getState();
          return { success: true, message: `Clicked ${selector} and switched to new tab ${foundId}`, state };
        }

        const state = await this.getState();
        return { success: true, message: `Clicked element ${selector}`, state };
      }

      const state = await this.getState();
      return { success: false, message: `Element not found: ${selector}`, state };
    } catch (err: any) {
      const state = await this.getState();
      return { success: false, message: `Click error: ${err.message}`, state };
    }
  }

  // Realistic human mouse click for user canvas interactions (solves bot check clicks & focuses input fields)
  public async mouseClickCoordinates(targetX: number, targetY: number): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    try {
      // Direct fast and reliable mouse approach to coordinates
      await page.mouse.move(targetX, targetY, { steps: 5 }).catch(() => {});
      await page.mouse.down().catch(() => {});
      await new Promise((r) => setTimeout(r, 60));
      await page.mouse.up().catch(() => {});

      // Explicitly focus any input element or button located at (targetX, targetY)
      await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        if (el) {
          if (typeof el.focus === 'function') {
            try { el.focus(); } catch (_) {}
          }
          const input = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el : el.querySelector('input, textarea');
          if (input && typeof (input as HTMLElement).focus === 'function') {
            try { (input as HTMLElement).focus(); } catch (_) {}
          }
        }
      }, { x: targetX, y: targetY }).catch(() => {});

      // Wait briefly for DOM or focus update
      await page.waitForTimeout(250).catch(() => {});
    } catch (e) {
      console.warn('Mouse click error:', e);
    }
    return this.getState();
  }

  // Direct keystroke typing into currently focused element in Chromium
  public async keyboardType(text: string): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    try {
      await page.keyboard.type(text, { delay: 15 });
      await page.waitForTimeout(200).catch(() => {});
    } catch (e) {
      console.warn('Keyboard type error:', e);
    }
    return this.getState();
  }

  // Direct special key press (Enter, Tab, Backspace, Escape, Arrow keys, etc.)
  public async keyboardPress(key: string): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    try {
      await page.keyboard.press(key);
      await page.waitForTimeout(250).catch(() => {});
    } catch (e) {
      console.warn('Keyboard press error:', e);
    }
    return this.getState();
  }

  // Clear currently focused input field completely
  public async clearFocusedInput(): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    try {
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(150).catch(() => {});
    } catch (e) {
      console.warn('Clear focused input error:', e);
    }
    return this.getState();
  }

  public async rightClick(target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    await this.init();
    const page = await this.getActivePage();

    try {
      const selector = target.trim();
      const axId = this.normalizeTargetId(selector);
      const axEntry = this.axTargetMap.get(axId);

      if (axEntry) {
        const { box } = await this.resolveCdpTarget(page, axEntry.backendDOMNodeId);
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          await page.waitForTimeout(400).catch(() => {});
          const state = await this.getState();
          return { success: true, message: `Right-clicked ${selector}`, state };
        }
      } else {
        const el = await page.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          const box = await el.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
          } else {
            await el.click({ button: 'right', timeout: 3000 });
          }
          await page.waitForTimeout(400).catch(() => {});
          const state = await this.getState();
          return { success: true, message: `Right-clicked ${selector}`, state };
        }
      }

      const state = await this.getState();
      return { success: false, message: `Element not found: ${selector}`, state };
    } catch (err: any) {
      const state = await this.getState();
      return { success: false, message: `Right-click error: ${err.message}`, state };
    }
  }

  public async hover(target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    await this.init();
    const page = await this.getActivePage();

    try {
      const selector = target.trim();
      const axId = this.normalizeTargetId(selector);
      const axEntry = this.axTargetMap.get(axId);

      if (axEntry) {
        const { box } = await this.resolveCdpTarget(page, axEntry.backendDOMNodeId);
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
          await page.waitForTimeout(400).catch(() => {});
          const state = await this.getState();
          return { success: true, message: `Hovered over ${selector}`, state };
        }
      } else {
        const el = await page.$(selector);
        if (el) {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          const box = await el.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
          } else {
            await el.hover({ timeout: 3000 });
          }
          await page.waitForTimeout(400).catch(() => {});
          const state = await this.getState();
          return { success: true, message: `Hovered over ${selector}`, state };
        }
      }

      const state = await this.getState();
      return { success: false, message: `Element not found: ${selector}`, state };
    } catch (err: any) {
      const state = await this.getState();
      return { success: false, message: `Hover error: ${err.message}`, state };
    }
  }

  public async pressKey(key: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    await this.init();
    const page = await this.getActivePage();

    try {
      await page.keyboard.press(key);
      await page.waitForTimeout(400).catch(() => {});
      const state = await this.getState();
      return { success: true, message: `Pressed key "${key}"`, state };
    } catch (err: any) {
      const state = await this.getState();
      return { success: false, message: `Press key error: ${err.message}`, state };
    }
  }

  public async dragAndDrop(source: string, target: string): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    await this.init();
    const page = await this.getActivePage();

    try {
      const srcId = this.normalizeTargetId(source);
      const tgtId = this.normalizeTargetId(target);
      const srcAx = this.axTargetMap.get(srcId);
      const tgtAx = this.axTargetMap.get(tgtId);

      let srcBox: { x: number; y: number; width: number; height: number } | null = null;
      let tgtBox: { x: number; y: number; width: number; height: number } | null = null;

      if (srcAx) {
        srcBox = (await this.resolveCdpTarget(page, srcAx.backendDOMNodeId)).box;
      } else {
        const srcEl = await page.$(source.trim());
        if (srcEl) {
          await srcEl.scrollIntoViewIfNeeded().catch(() => {});
          srcBox = await srcEl.boundingBox();
        }
      }

      if (tgtAx) {
        tgtBox = (await this.resolveCdpTarget(page, tgtAx.backendDOMNodeId)).box;
      } else {
        const tgtEl = await page.$(target.trim());
        if (tgtEl) {
          await tgtEl.scrollIntoViewIfNeeded().catch(() => {});
          tgtBox = await tgtEl.boundingBox();
        }
      }

      if (srcBox && tgtBox) {
        const fromX = srcBox.x + srcBox.width / 2;
        const fromY = srcBox.y + srcBox.height / 2;
        const toX = tgtBox.x + tgtBox.width / 2;
        const toY = tgtBox.y + tgtBox.height / 2;

        await page.mouse.move(fromX, fromY, { steps: 6 });
        await page.mouse.down();
        await new Promise((r) => setTimeout(r, 120));
        await page.mouse.move(toX, toY, { steps: 16 });
        await new Promise((r) => setTimeout(r, 100));
        await page.mouse.up();
        await page.waitForTimeout(400).catch(() => {});

        const state = await this.getState();
        return { success: true, message: `Dragged ${source} to ${target}`, state };
      }

      if (!srcAx && !tgtAx) {
        try {
          await page.locator(source.trim()).dragTo(page.locator(target.trim()), { timeout: 4000 });
          const fallbackState = await this.getState();
          return { success: true, message: `Dragged ${source} to ${target}`, state: fallbackState };
        } catch {}
      }

      const notFoundState = await this.getState();
      return { success: false, message: `Drag target(s) not found`, state: notFoundState };
    } catch (err: any) {
      const state = await this.getState();
      return { success: false, message: `Drag error: ${err.message}`, state };
    }
  }

  public async type(target: string, value: string, submit: boolean = false): Promise<{ success: boolean; message: string; state: RealBrowserState }> {
    await this.init();
    const page = await this.getActivePage();

    try {
      const selector = target.trim();
      const axId = this.normalizeTargetId(selector);
      const axEntry = this.axTargetMap.get(axId);

      let didType = false;

      if (axEntry) {
        const { cdp, box, objectId } = await this.resolveCdpTarget(page, axEntry.backendDOMNodeId);

        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
          await page.waitForTimeout(100).catch(() => {});
        }
        await cdp.send('DOM.focus', { backendNodeId: axEntry.backendDOMNodeId }).catch(() => {});

        let handledAsSelect = false;
        if (objectId) {
          try {
            const res = await cdp.send('Runtime.callFunctionOn', {
              objectId,
              arguments: [{ value }],
              functionDeclaration: `function(val) {
                const el = this.nodeType === 3 ? this.parentElement : this;
                if (!el) return { isSelect: false };
                if (el.tagName === 'SELECT') {
                  const sel = el;
                  const targetLower = String(val || '').toLowerCase();
                  const opt = Array.from(sel.options).find(
                    (o) => o.value.toLowerCase() === targetLower || o.text.toLowerCase().includes(targetLower)
                  );
                  if (opt) {
                    sel.value = opt.value;
                    sel.dispatchEvent(new Event('input', { bubbles: true }));
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                  return { isSelect: true };
                }
                const inner = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
                  ? el
                  : el.querySelector('input, textarea, [contenteditable="true"]');
                if (inner && typeof inner.focus === 'function') {
                  inner.focus();
                } else if (typeof el.focus === 'function') {
                  el.focus();
                }
                return { isSelect: false };
              }`,
              returnByValue: true,
            });
            handledAsSelect = Boolean(res?.result?.value?.isSelect);
          } catch {}
        }

        if (!handledAsSelect) {
          await page.keyboard.press('Control+A').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await page.keyboard.type(value, { delay: 15 });
        }
        didType = true;
      } else {
        let el = await page.$(selector);
        if (!el) {
          el = await page.$('input[type="text"], input[type="search"], textarea, input:not([type="hidden"])');
        }

        if (el) {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await el.click({ timeout: 2000 }).catch(() => {});

          let targetInput = el;
          const tagName = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => 'input');
          if (tagName !== 'input' && tagName !== 'textarea') {
            const innerInput = await el.$('input, textarea');
            if (innerInput) {
              targetInput = innerInput;
            }
          }

          try {
            await targetInput.fill('');
          } catch {
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
          }

          await targetInput.type(value, { delay: 15 });
          didType = true;
        }
      }

      if (didType) {
        await page.waitForTimeout(400).catch(() => {});

        const hasSuggestionOption = await page.$(
          '[role="listbox"] [role="option"], ul[role="listbox"] li, div[role="option"], li[role="option"], .sbqs_c'
        );

        if (submit || hasSuggestionOption) {
          await page.keyboard.press('Enter').catch(() => {});
          await page.waitForTimeout(600).catch(() => {});
        } else {
          await page.waitForTimeout(200).catch(() => {});
        }

        const state = await this.getState();
        return { success: true, message: `Typed "${value}" into ${selector}`, state };
      }

      const state = await this.getState();
      return { success: false, message: `Input element not found: ${selector}`, state };
    } catch (err: any) {
      const state = await this.getState();
      return { success: false, message: `Type error: ${err.message}`, state };
    }
  }

  public async scroll(direction: 'up' | 'down', amount: number = 400): Promise<RealBrowserState> {
    await this.init();
    const page = await this.getActivePage();
    const delta = direction === 'up' ? -amount : amount;

    try {
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(300).catch(() => {});
    } catch (e) {
      console.warn('Scroll error:', e);
    }
    return this.getState();
  }

  public getProxyConfig(): ProxyTunnelConfig {
    return { ...this.proxyConfig };
  }

  public async setProxyConfig(config: ProxyTunnelConfig): Promise<{ success: boolean; ipInfo?: any; error?: string }> {
    this.proxyConfig = {
      enabled: Boolean(config.enabled),
      server: (config.server || '').trim(),
      username: (config.username || '').trim(),
      password: (config.password || '').trim(),
    };

    let previousUrl = '';
    try {
      const current = this.pages.get(this.activePageId);
      if (current && !current.isClosed()) {
        previousUrl = current.url();
      }
    } catch {}

    const recreateContext = async (targetUrl: string) => {
      if (this.context) {
        try {
          await this.context.close();
        } catch (_) {}
        this.context = null;
        this.pages.clear();
        this.activePageId = 'tab-1';
        this.tabCounter = 0;
      }
      await this.init();
      if (targetUrl && targetUrl.startsWith('http') && !targetUrl.includes('www.google.com')) {
        const active = await this.getActivePage().catch(() => null);
        if (active) {
          await active.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        }
      }
    };

    // Re-create context with new proxy configuration
    if (this.context) {
      await recreateContext(previousUrl);
    } else {
      await this.init();
    }

    // Check egress IP through the active browser and sync timezoneId if needed
    try {
      const ipInfo = await this.checkEgressIp();
      const detectedTz = typeof ipInfo?.timezone === 'string' ? ipInfo.timezone.trim() : '';
      if (detectedTz) {
        const cacheKey = this.proxyConfig.enabled && this.proxyConfig.server
          ? this.proxyConfig.server
          : 'direct';
        this.resolvedTimezoneCache.set(cacheKey, detectedTz);
        if (detectedTz !== this.activeTimezoneId) {
          console.log(`[Patchright Engine] Syncing browser timezone to egress IP: ${this.activeTimezoneId} -> ${detectedTz}`);
          await recreateContext(previousUrl);
        }
      }
      return { success: true, ipInfo };
    } catch (err: any) {
      return { success: true, error: err.message };
    }
  }

  public async checkEgressIp(): Promise<any> {
    await this.init();
    const testPage = await this.context!.newPage();
    try {
      await testPage.goto('http://ip-api.com/json', { timeout: 10000, waitUntil: 'domcontentloaded' });
      const bodyText = await testPage.innerText('body');
      const data = JSON.parse(bodyText);
      await testPage.close();
      return data;
    } catch (err: any) {
      try {
        await testPage.close();
      } catch (_) {}
      throw err;
    }
  }
}

export const chromiumManager = new ChromiumManager();
