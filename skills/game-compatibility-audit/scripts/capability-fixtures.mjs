/** TEST ONLY. Serializable init-script functions; use a fresh browser context per case. */
export function installCapabilityFaults(options = {}) {
  const win = window;
  const stats = win.__compatFaultStats = { installed: [], failed: [], hits: {} };
  const faults = new Set(options.faults || []);
  const hit = name => { stats.hits[name] = (stats.hits[name] || 0) + 1; };
  const apply = (name, action) => {
    if (!faults.has(name)) return;
    try { action(); stats.installed.push(name); }
    catch (error) { stats.failed.push({ name, error: String(error) }); }
    faults.delete(name);
  };
  const absent = (object, key) => {
    Object.defineProperty(object, key, { value: undefined, writable: true, configurable: true });
  };
  const throwing = (object, key) => {
    Object.defineProperty(object, key, { configurable: true, get() {
      hit(key); throw new DOMException(`Injected ${key} denial`, 'SecurityError');
    } });
  };
  for (const name of ['at', 'flat', 'flatMap', 'findLast', 'findLastIndex']) {
    apply(`no-array-${name}`, () => absent(Array.prototype, name));
  }
  apply('no-replaceAll', () => absent(String.prototype, 'replaceAll'));
  apply('no-fromEntries', () => absent(Object, 'fromEntries'));
  for (const name of ['structuredClone', 'AbortController', 'ResizeObserver', 'visualViewport']) {
    apply(`no-${name}`, () => absent(win, name));
  }
  apply('no-replaceChildren', () => {
    for (const type of [Element, Document, DocumentFragment]) absent(type.prototype, 'replaceChildren');
  });
  apply('no-roundRect', () => absent(CanvasRenderingContext2D.prototype, 'roundRect'));
  apply('no-dialog-method', () => {
    for (const method of ['showModal', 'show', 'close']) absent(HTMLDialogElement.prototype, method);
  });
  apply('no-dialog-class', () => absent(win, 'HTMLDialogElement'));
  apply('cssom-unreadable', () => {
    for (const key of ['cssRules', 'rules']) throwing(CSSStyleSheet.prototype, key);
    // Reading link.sheet is a distinct failure; select it separately if needed.
  });
  apply('link-sheet-unreadable', () => throwing(HTMLLinkElement.prototype, 'sheet'));
  const cryptoFaults = ['crypto-missing', 'crypto-throws', 'uuid-missing', 'uuid-throws'];
  if (cryptoFaults.filter(name => faults.has(name)).length > 1) {
    throw new Error('Use one crypto fault per context to isolate its cause');
  }
  apply('uuid-missing', () => absent(win.crypto, 'randomUUID'));
  apply('uuid-throws', () => {
    Object.defineProperty(win.crypto, 'randomUUID', { configurable: true, value() {
      hit('randomUUID'); throw new DOMException('Injected UUID failure', 'NotSupportedError');
    } });
  });
  apply('crypto-missing', () => absent(win, 'crypto'));
  apply('crypto-throws', () => throwing(win, 'crypto'));

  const storageFaults = ['storage-read-denied', 'storage-write-denied', 'storage-silent-write'];
  if (storageFaults.some(name => faults.has(name))) {
    if (!Array.isArray(options.storageKeys) || !options.storageKeys.length) {
      throw new Error('Storage faults require explicit storageKeys (or ["*"])');
    }
    const storage = win.localStorage;
    const matches = key => options.storageKeys.includes('*') || options.storageKeys.includes(String(key));
    apply('storage-read-denied', () => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (this === storage && matches(key)) {
          hit('storage-read-denied'); throw new DOMException('Injected read denial', 'SecurityError');
        }
        return original.call(this, key);
      };
    });
    if (faults.has('storage-write-denied') && faults.has('storage-silent-write')) {
      throw new Error('Write denial and silent loss need separate contexts');
    }
    for (const name of ['storage-write-denied', 'storage-silent-write']) {
      apply(name, () => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (this === storage && matches(key)) {
            hit(name);
            if (name === 'storage-write-denied') {
              throw new DOMException('Injected write denial', 'QuotaExceededError');
            }
            return undefined;
          }
          return original.call(this, key, value);
        };
      });
    }
  }
  apply('storage-getter-denied', () => throwing(win, 'localStorage'));

  if (faults.has('no-webgl2') || faults.has('antialias-fails')) {
    const original = HTMLCanvasElement.prototype.getContext;
    const noWebgl2 = faults.has('no-webgl2');
    const antialiasFails = faults.has('antialias-fails');
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      if (noWebgl2 && type === 'webgl2') { hit('no-webgl2'); return null; }
      if (antialiasFails && /^(webgl2?|experimental-webgl)$/.test(type) && attributes?.antialias === true) {
        hit('antialias-fails'); return null;
      }
      return original.call(this, type, attributes);
    };
    apply('no-webgl2', () => {});
    apply('antialias-fails', () => {});
  }
  apply('no-float-extensions', () => {
    for (const type of [win.WebGLRenderingContext, win.WebGL2RenderingContext].filter(Boolean)) {
      const original = type.prototype.getExtension;
      type.prototype.getExtension = function (name) {
        if (/^(EXT_color_buffer_(half_)?float|WEBGL_color_buffer_float|OES_texture_(half_)?float(_linear)?)$/i.test(name)) {
          hit('no-float-extensions'); return null;
        }
        return original.call(this, name);
      };
    }
  });
  // Last: do not make the fixture itself depend on globalThis.
  apply('no-globalThis', () => {
    if (!delete win.globalThis || 'globalThis' in win) throw new Error('Could not remove globalThis binding');
  });
  for (const name of faults) stats.failed.push({ name, error: 'Unknown fault; not injected' });
  return stats;
}

/** Read trusted test expressions in Chromium without Playwright's globalThis-dependent polling. */
export async function readMainWorld(page, expression) {
  const session = await page.context().newCDPSession(page);
  try {
    const result = await session.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    if (result.result.subtype === 'error') throw new Error(result.result.description);
    return result.result.value;
  } finally { await session.detach(); }
}

/** Actual intercepting DOM controls plus optionally late CSS vars. Does NOT resize by default. */
export function installHostOccupancy(options = {}) {
  if (options.topOnly !== false && window.top !== window) return;
  const stats = window.__compatHostStats = { installed: false, clicks: 0, rects: 0 };
  const install = () => {
    const selector = options.selector || ':root';
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Missing safe-area owner: ${selector}`);
    const variables = options.variables || {};
    let style = root.style;
    if (options.source === 'stylesheet') {
      const sheetNode = document.createElement('style');
      document.head.appendChild(sheetNode);
      const index = sheetNode.sheet.insertRule(`${selector} {}`, 0);
      style = sheetNode.sheet.cssRules[index].style;
    }
    for (const [key, value] of Object.entries(variables)) {
      if (!/^--[\w-]+$/.test(key)) throw new Error(`Not a CSS variable: ${key}`);
      style.setProperty(key, String(value));
    }
    for (const [index, rect] of (options.rects || []).entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.compatHost = String(index);
      button.textContent = rect.label || '宿主控件（测试）';
      Object.assign(button.style, {
        position: 'fixed', zIndex: '2147483647', pointerEvents: 'auto',
        background: '#a22', color: '#fff', padding: '0', margin: '0',
        border: '0', borderRadius: '0', boxSizing: 'border-box', touchAction: 'auto',
      });
      for (const key of ['top', 'right', 'bottom', 'left', 'width', 'height']) {
        if (rect[key] !== undefined) button.style[key] = typeof rect[key] === 'number' ? `${rect[key]}px` : rect[key];
      }
      button.addEventListener('pointerdown', event => event.stopPropagation());
      button.addEventListener('click', event => { stats.clicks++; event.stopPropagation(); });
      document.body.appendChild(button);
      stats.rects++;
    }
    stats.installed = true;
    if (options.dispatchResize === true) window.dispatchEvent(new Event('resize'));
  };
  const schedule = () => window.setTimeout(install, Math.max(0, options.delayMs || 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, { once: true });
  else schedule();
}

/** Controlled Three-like fragment-output corruption, NOT a physical GPU emulator. */
export function installClearcoatFault(options = {}) {
  const stats = window.__compatShaderStats = { matchedShaders: 0, inspectedFragments: 0 };
  const pattern = new RegExp(options.pattern || '^\\s*#define\\s+USE_CLEARCOAT\\b', 'm');
  const seen = new WeakSet();
  for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const proto = type.prototype;
    if (seen.has(proto)) continue;
    seen.add(proto);
    const original = proto.shaderSource;
    proto.shaderSource = function (shader, source) {
      let text = String(source);
      if (this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER) {
        stats.inspectedFragments++;
        if (pattern.test(text)) {
          const end = text.lastIndexOf('}');
          if (end < 0) throw new Error('Matched shader has no main-function ending');
          // Suitable only when main() is the last function and gl_FragColor exists/has an alias.
          text = `${text.slice(0, end)}\n gl_FragColor.rgb = vec3(0.0);\n${text.slice(end)}`;
          stats.matchedShaders++;
        }
      }
      return original.call(this, shader, text);
    };
  }
}
