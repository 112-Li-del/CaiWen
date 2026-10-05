/* ============================================================
 * typeline.js —— 打字机文本（原生 JS，无依赖、不碰业务逻辑）
 * ------------------------------------------------------------
 * 行为移植自 React Bits 的 TextType（reactbits.dev/text-animations/text-type）。
 * 原组件是 React + hooks 实现，这里按同样的参数契约写成原生版，供 demo 与
 * 将来的 React 组件共用一份语义：
 *
 *   typingSpeed / deletingSpeed / pauseDuration  打字·删除·停顿速度（ms）
 *   variableSpeed {min,max}   每个字符随机速度，制造"人在打字"的手感
 *   cursorCharacter / showCursor / cursorBlinkDuration / hideCursorWhileTyping
 *   initialDelay / loop / onSentenceComplete
 *
 * 两条硬约束：
 *   1. 只对外暴露 set() / destroy()，内部用单个 setTimeout 串联，
 *      切表情时先删后打，不会出现两段文字叠在一起。
 *   2. 尊重 prefers-reduced-motion：开了就直接整段显示，不做逐字动画。
 *
 * DOM 结构由本模块自建（.dt-tl-text + .dt-tl-cursor），调用方给个容器即可。
 * ============================================================ */

import { rand } from './math.js';

/**
 * 单个字符的打字间隔。
 * @param {number} base 基础速度
 * @param {{min:number,max:number}|undefined} variable 变速度区间
 */
export function charDelay(base, variable) {
  if (!variable) return base;
  return rand(variable.min, variable.max);
}

/** 是否应降级为「直接显示」（系统开启了减弱动效） */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function createTypeLine(host, opts = {}) {
  const o = Object.assign({
    typingSpeed: 55,
    deletingSpeed: 26,
    pauseDuration: 900,
    variableSpeed: { min: 40, max: 95 },
    showCursor: true,
    cursorCharacter: '|',
    cursorBlinkDuration: 0.6,
    hideCursorWhileTyping: false,
    initialDelay: 0,
    loop: false,
    onSentenceComplete: null
  }, opts);

  host.textContent = '';
  const textEl = document.createElement('span');
  textEl.className = 'dt-tl-text';
  host.appendChild(textEl);

  const cursorEl = document.createElement('span');
  cursorEl.className = 'dt-tl-cursor';
  cursorEl.textContent = o.cursorCharacter;
  cursorEl.style.animationDuration = `${o.cursorBlinkDuration}s`;
  if (!o.showCursor) cursorEl.style.display = 'none';
  host.appendChild(cursorEl);

  let timer = 0;
  let shown = '';
  let pending = '';
  let dead = false;

  function clear() {
    if (timer) { clearTimeout(timer); timer = 0; }
  }
  function render() {
    textEl.textContent = shown;
    /* 用 visibility 而不是 opacity：闪烁动画占用了 opacity，改它会失效 */
    cursorEl.style.visibility =
      ((o.hideCursorWhileTyping && shown.length < pending.length) || pending.length === 0) ? 'hidden' : 'visible';
  }

  function stepType() {
    if (dead) return;
    if (shown.length < pending.length) {
      shown = pending.slice(0, shown.length + 1);
      render();
      timer = setTimeout(stepType, charDelay(o.typingSpeed, o.variableSpeed));
      return;
    }
    if (typeof o.onSentenceComplete === 'function') o.onSentenceComplete(pending);
    if (!o.loop) return;
    timer = setTimeout(stepDelete, o.pauseDuration);
  }

  function stepDelete() {
    if (dead) return;
    if (shown.length > 0) {
      shown = shown.slice(0, -1);
      render();
      timer = setTimeout(stepDelete, o.deletingSpeed);
      return;
    }
    timer = setTimeout(stepType, 60);
  }

  /**
   * 显示一段新文字：先把当前这段文字删掉（删除速度），再逐字打出来。
   * 首次调用没有旧内容，直接从空开始打。
   */
  function set(text) {
    pending = text || '';
    clear();
    if (prefersReducedMotion()) { shown = pending; render(); return; }
    if (shown.length > 0) { stepDelete(); return; }
    shown = '';
    render();
    timer = setTimeout(stepType, o.initialDelay);
  }

  function destroy() {
    dead = true;
    clear();
    host.textContent = '';
  }

  return { set, destroy, get text() { return pending; } };
}
