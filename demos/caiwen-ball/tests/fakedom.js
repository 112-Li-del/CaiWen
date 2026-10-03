/* ============================================================
 * fakedom.js —— engine 冒烟测试共用的最小假 DOM
 * ------------------------------------------------------------
 * 只实现 engine.js 实际触到的表面：
 *   createElementNS / createElement / addEventListener / rAF 泵
 * 节点额外提供事件分发与 getBoundingClientRect，供点击命中测试用；
 * remove() 会真正从 parent.children 摘除，让"彩带是否清理干净"可被断言。
 * ============================================================ */

export function node(tag) {
  const n = {
    tag, attrs: {}, children: [], style: {}, textContent: '', parent: null,
    _ev: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); c.parent = n; return c; },
    insertBefore(c) { this.children.unshift(c); c.parent = n; return c; },
    remove() {
      if (!n.parent) return;
      const i = n.parent.children.indexOf(n);
      if (i >= 0) n.parent.children.splice(i, 1);
      n.parent = null;
    },
    querySelector() { return null; },
    firstChild: null,
    addEventListener(t, fn) { (n._ev[t] = n._ev[t] || []).push(fn); },
    removeEventListener(t, fn) {
      const a = n._ev[t];
      if (a) n._ev[t] = a.filter((f) => f !== fn);
    },
    dispatch(t, e) { (n._ev[t] || []).slice().forEach((fn) => fn(e)); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; }
  };
  return n;
}

export function walk(root, out = []) {
  out.push(root);
  for (const c of root.children || []) walk(c, out);
  return out;
}

/** 装一套最小假 DOM，返回手动泵帧的函数 */
export function installFakeDom() {
  globalThis.Element = class Element {};      /* engine 用 instanceof Element 判断提示节点 */
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  globalThis.document = {
    createElementNS: (_ns, tag) => node(tag),
    createElement: (tag) => node(tag),
    addEventListener() {},
    removeEventListener() {}
  };
  let cbs = [];
  globalThis.requestAnimationFrame = (fn) => { cbs.push(fn); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  let t = 0;
  return {
    step(ms) {
      t += ms;
      const list = cbs; cbs = [];
      list.forEach((fn) => fn(t));
      return t;
    },
    get now() { return t; }
  };
}
