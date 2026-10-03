/* ============================================================
 * tuner.js —— 实时调参面板（demo 专用开发工具，正式产品不带）
 * ------------------------------------------------------------
 * 把当前表情的全部数值字段变成滑块，拖动即通过 engine.tune() 实时生效
 * （不重播入场动画）；「复制 JSON」吐出可直接粘回 src/states.js 的对象字面量。
 * 依赖：engine 暴露的 setEmotion / tune / emotion / on('change')。
 * ============================================================ */

import { STATES, NUM_KEYS, SHAPES } from './states.js';

/* 各滑块的量程与步长（宁窄勿宽，超出范围基本是失真值） */
const RANGES = {
  open:        [0, 1, 0.01],
  w:           [6, 40, 0.5],
  h:           [6, 44, 0.5],
  tilt:        [-20, 20, 0.5],
  yaw:         [-0.8, 0.8, 0.01],
  pitch:       [-0.6, 0.6, 0.01],
  squash:      [-0.3, 0.3, 0.005],
  taper:       [-0.3, 0.3, 0.005],
  lean:        [-1, 1, 0.01],
  breatheAmp:  [0, 0.05, 0.001],
  breatheHz:   [0, 1.5, 0.01],
  meridian:    [0, 5, 0.05],
  driftYaw:    [0, 0.3, 0.005],
  driftHz:     [0, 1, 0.01],
  scanYaw:     [0, 1.2, 0.01],
  scanHz:      [0, 1.5, 0.01],
  bounce:      [0, 2, 0.01],
  pop:         [0, 0.4, 0.005]
};

const LABELS = {
  open: '眼开合', w: '眼宽', h: '眼高', tilt: '眼倾角',
  yaw: '头水平转', pitch: '头俯仰', squash: '身形挤压',
  taper: '水滴感', lean: '歪头', breatheAmp: '呼吸幅度',
  breatheHz: '呼吸频率', meridian: '经线转速',
  driftYaw: '飘移幅度', driftHz: '飘移频率',
  scanYaw: '扫视幅度', scanHz: '扫视频率',
  bounce: '弹跳', pop: '入场弹'
};

export function createTuner(host, ball) {
  host.innerHTML = '';

  let draft = {};
  let emotionId = ball.emotion;

  /* ---------- 骨架 ---------- */
  const head = document.createElement('div');
  head.className = 'tw-head';
  head.innerHTML = `<b>调参面板 · <span class="tw-emo"></span></b>
    <select class="tw-emo-sel"></select>
    <button class="tw-mini tw-reset">重置</button>
    <button class="tw-mini tw-copy">复制 JSON</button>`;

  const eyes = document.createElement('div');
  eyes.className = 'tw-eyes';

  const sliders = document.createElement('div');
  sliders.className = 'tw-sliders';

  const out = document.createElement('pre');
  out.className = 'tw-out';

  host.appendChild(head);
  host.appendChild(eyes);
  host.appendChild(sliders);
  host.appendChild(out);

  const emoName = head.querySelector('.tw-emo');
  const emoSel = head.querySelector('.tw-emo-sel');
  Object.keys(STATES).forEach((id) => {
    const op = document.createElement('option');
    op.value = id;
    op.textContent = `${id} ${STATES[id].name}`;
    emoSel.appendChild(op);
  });

  /* ---------- 控件工厂 ---------- */
  function slider(key, label, lo, hi, step, get, set) {
    const row = document.createElement('label');
    row.className = 'tw-row';
    const cap = document.createElement('span');
    cap.className = 'tw-cap';
    cap.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = lo; input.max = hi; input.step = step;
    input.value = get();
    const val = document.createElement('span');
    val.className = 'tw-val';
    val.textContent = (+input.value).toFixed(String(step).split('.')[1]?.length || 0);
    input.addEventListener('input', () => {
      set(+input.value);
      val.textContent = (+input.value).toFixed(String(step).split('.')[1]?.length || 0);
      apply();
    });
    row.append(cap, input, val);
    sliders.appendChild(row);
    return { input, refresh() { input.value = get(); val.textContent = (+input.value).toFixed(3); } };
  }

  function shapeSelect(label, get, set) {
    const row = document.createElement('label');
    row.className = 'tw-row';
    const cap = document.createElement('span');
    cap.className = 'tw-cap';
    cap.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'tw-shape';
    SHAPES.forEach((s) => {
      const op = document.createElement('option');
      op.value = s;
      op.textContent = { normal: '胶囊', wide: '大圆', happy: '笑弧', closed: '闭眼', cross: '叉眼' }[s];
      sel.appendChild(op);
    });
    sel.value = get();
    sel.addEventListener('change', () => { set(sel.value); apply(); });
    row.append(cap, sel);
    return { sel, refresh() { sel.value = get(); } };
  }

  /* ---------- 状态装载 ---------- */
  const controls = [];

  function load(id) {
    emotionId = id;
    draft = Object.assign({}, STATES[id]);
    emoName.textContent = `${id} ${STATES[id].name}`;
    emoSel.value = id;
    buildControls();
    apply(false);
  }

  function buildControls() {
    sliders.innerHTML = '';
    eyes.innerHTML = '';
    controls.length = 0;

    /* 眼形 + 左右眼覆盖 */
    controls.push(shapeSelect('主眼形',
      () => draft.shape,
      (v) => { draft.shape = v; }));
    const eyeWrap = document.createElement('div');
    eyeWrap.className = 'tw-eye-grid';
    [['eyeL', '左眼'], ['eyeR', '右眼']].forEach(([side, cap]) => {
      const box = document.createElement('label');
      box.className = 'tw-eye-box';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!draft[side];
      const name = document.createElement('span');
      name.textContent = cap;
      const w = document.createElement('input');
      w.type = 'number'; w.placeholder = '宽';
      w.value = draft[side] ? draft[side].w : draft.w;
      const h = document.createElement('input');
      h.type = 'number'; h.placeholder = '高';
      h.value = draft[side] ? draft[side].h : draft.h;
      const sel = document.createElement('select');
      SHAPES.forEach((s) => {
        const op = document.createElement('option');
        op.value = s;
        op.textContent = { normal: '胶囊', wide: '大圆', happy: '笑弧', closed: '闭眼', cross: '叉眼' }[s];
        sel.appendChild(op);
      });
      sel.value = draft[side] ? draft[side].shape : draft.shape;
      const sync = () => {
        /* 置 undefined 而不是 delete：tune 是「补丁合并」，不带的字段会
         * 透传 states 里的原值，导致取消勾选失效 */
        draft[side] = cb.checked ? { shape: sel.value, w: +w.value, h: +h.value } : undefined;
      };
      [cb, w, h].forEach((n) => n.addEventListener('input', () => { sync(); apply(); }));
      sel.addEventListener('change', () => { sync(); apply(); });
      box.append(name, cb, sel, w, h);
      eyeWrap.appendChild(box);
    });
    eyes.appendChild(eyeWrap);

    /* 数值滑块 */
    NUM_KEYS.forEach((key) => {
      const [lo, hi, step] = RANGES[key];
      controls.push(slider(key, LABELS[key] || key, lo, hi, step,
        () => draft[key] ?? 0,
        (v) => { draft[key] = v; }));
    });
  }

  /* ---------- 应用与导出 ---------- */
  function apply(render = true) {
    ball.tune(draft);
    if (render) refreshOut();
  }

  function refreshOut() {
    const lines = [];
    const push = (k, v) => lines.push(`  ${k}: ${JSON.stringify(v)},`);
    push('id', draft.id);
    push('name', draft.name);
    push('group', draft.group);
    push('tip', draft.tip);
    push('shape', draft.shape);
    NUM_KEYS.forEach((k) => push(k, +draft[k]));
    ['eyeL', 'eyeR'].forEach((side) => {
      if (draft[side]) push(side, { shape: draft[side].shape, w: +draft[side].w, h: +draft[side].h });
    });
    out.textContent = `'${draft.id}': {\n${lines.join('\n')}\n}`;
  }

  function refreshAll() {
    controls.forEach((c) => c.refresh && c.refresh());
    refreshOut();
  }

  /* ---------- 事件 ---------- */
  emoSel.addEventListener('change', () => ball.setEmotion(emoSel.value));
  head.querySelector('.tw-reset').addEventListener('click', () => load(emotionId));
  head.querySelector('.tw-copy').addEventListener('click', async () => {
    refreshOut();
    try {
      await navigator.clipboard.writeText(out.textContent);
      head.querySelector('.tw-copy').textContent = '已复制 ✓';
      setTimeout(() => { head.querySelector('.tw-copy').textContent = '复制 JSON'; }, 1200);
    } catch { out.scrollIntoView({ block: 'nearest' }); }
  });
  ball.on('change', (e) => load(e.id));
  load(emotionId);

  return { load, refreshAll };
}
