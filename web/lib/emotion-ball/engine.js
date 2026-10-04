/* ============================================================
 * engine.js —— 驱动层
 * ------------------------------------------------------------
 * 职责分工（对齐 jeremy-prt/bloub 的分层思路，代码为本仓库独立编写）：
 *   math.js   缓动 / 插值 / 弹簧 / 路径平滑
 *   shape.js  圆形包络 → 身形轮廓
 *   face.js   球面投影 + 眼睛贴合规制
 *   states.js 纯数据
 *   engine.js 只做三件事：建 DOM、按配置推进状态、对外发事件
 *
 * 全局共享一个 rAF 心跳，实例数量不增加循环开销。
 * ============================================================ */

import {
  TAU, clamp, rand, lerp, approach, smoothClosedPath,
  easings, loopNoise, blinkOpenMul, pulseAmount, pickWeighted
} from './math.js';
import { sphereSilhouette, shapeRadiusTable, tableRadiusAt, MORPH_KINDS } from './shape.js';
import { createTypeLine } from './typeline.js';
import { projectEye, clampToHull } from './face.js';
import { STATES, FALLBACK, NUM_KEYS, SHAPES, normalize, morphTimeline } from './states.js';

const NS = 'http://www.w3.org/2000/svg';
const CREAM = '#FFF6DC';
const EYE_LON = 0.34;                 /* 两眼的经度偏移（弧度） */
const EYE_R = 66;                     /* 眼睛贴合的球面半径 */
const CONFETTI_COLORS = ['#F4C34E', '#FFF6DC', '#E8556B', '#7FA8E0', '#C8354E'];
/* 流星彩带渐变色对（参考 bloub：紫→粉、橙→黄、蓝→绿…），首尾同色让弧段颜色循环 */
const RIBBON_PAIRS = [
  ['#B48BE0', '#E8556B'],
  ['#F4A64E', '#F4C34E'],
  ['#7FA8E0', '#7BC49A'],
  ['#E8556B', '#B48BE0'],
  ['#7BC49A', '#F4C34E']
];
const RIBBON_SEGS = 8;                 /* 每条丝带分 8 段：尾细淡、头粗亮 = 流星拖尾 */
const ZZZ_COLOR = '#F4C34E';           /* 南财黄 */
const ZZZ_INTERVAL = 0.3;              /* 三节 Z 的发车间隔（秒） */
const SPIN_DUR = 1.05;                 /* 点球后自转一圈的时长（秒） */
const RIBBON_LIFE = 1.8;               /* 彩带寿命：比转体长半拍，转完了丝带再飘一会淡出 */
const RIBBON_TILTS = [-0.95, -0.12, 0.72];   /* 三条轨道的基础倾角（弧度），错开才有环绕感 */
/* 经线可见度：底数 + 随宽度变化的增量。早期是 0.08/0.20，实测在红底上几乎看不见 */
const MERIDIAN_BASE = 0.20;
const MERIDIAN_GAIN = 0.45;

let seq = 0;

function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function setRect(node, w, h) {
  node.setAttribute('x', (-w / 2).toFixed(2));
  node.setAttribute('y', (-h / 2).toFixed(2));
  node.setAttribute('width', w.toFixed(2));
  node.setAttribute('height', h.toFixed(2));
  node.setAttribute('rx', (w / 2).toFixed(2));
}
/** 闭眼线：长度跟着眼宽走，睡眠（w=22）比待机（w=13）明显宽一截 */
function setBar(node, w) {
  node.setAttribute('x1', (-w / 2).toFixed(2));
  node.setAttribute('x2', (w / 2).toFixed(2));
}

/**
 * 打盹时的眼睛目标：在待机眼形与睡眠眼形之间混合。
 * 眼形不做半透明叠加（两个半透明眼形叠在一起会糊成一团），跨过中点直接换目标，
 * 由 alpha 的指数逼近完成平滑过渡；尺寸与垂直偏移连续插值。
 */
function eyeBlend(a, b, k) {
  if (k <= 0) return a;
  return {
    shape: k < 0.5 ? a.shape : b.shape,
    w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k),
    dy: lerp(a.dy || 0, b.dy || 0, k)
  };
}

/* ---------------- 共享心跳 ---------------- */
const tickers = new Set();
let rafId = 0;
let lastTs = 0;
function pump(ts) {
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;
  tickers.forEach((fn) => fn(ts, dt));
  rafId = requestAnimationFrame(pump);
}
function addTicker(fn) {
  tickers.add(fn);
  if (!rafId) { lastTs = 0; rafId = requestAnimationFrame(pump); }
}
function removeTicker(fn) {
  tickers.delete(fn);
  if (!tickers.size && rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}

/* ---------------- 实例 ---------------- */
export function create(container, opts = {}) {
  const R = 78, CX = 100, CY = 105;
  const n = ++seq;
  const tipEl = opts.tip instanceof Element ? opts.tip
    : (container.querySelector('#ball-tip') || null);

  /* 提示文字：打字机效果（React Bits TextType 的原生移植版） */
  const tipLine = tipEl ? createTypeLine(tipEl, opts.tipType || {}) : null;

  const svg = el('svg', { viewBox: '0 0 200 200' });
  container.insertBefore(svg, container.firstChild);

  const defs = el('defs', {}, svg);
  const grad = el('radialGradient', { id: `cw-grad-${n}`, cx: '35%', cy: '30%', r: '80%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#C8354E' }, grad);
  el('stop', { offset: '55%', 'stop-color': '#A6192E' }, grad);
  el('stop', { offset: '100%', 'stop-color': '#73101F' }, grad);
  /* 经线泛光：高斯模糊两份叠在原线下面。stdDeviation 2.2 是"稍微发光"的量级，
   * 再大就从发光变成糊。开销：每帧一次离屏合成（4 条线），200×200 区城内可忽略；
   * 真要省可以把 opts.glow 传 false 关掉。 */
  if (opts.glow !== false) {
    const glow = el('filter', {
      id: `cw-glow-${n}`, x: '-60%', y: '-60%', width: '220%', height: '220%',
      'color-interpolation-filters': 'sRGB'
    }, defs);
    el('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '2.2', result: 'b' }, glow);
    const merge = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, merge);
    el('feMergeNode', { in: 'b' }, merge);
    el('feMergeNode', { in: 'SourceGraphic' }, merge);
  }

  const clip = el('clipPath', { id: `cw-clip-${n}` }, defs);
  const clipPath = el('path', {}, clip);

  const shadowEl = el('ellipse', { cx: CX, cy: 188, rx: 52, ry: 7, fill: 'rgba(60,20,20,.14)' }, svg);

  /* 思考的省略号：左右两个旁点（中间那颗是缩成小球的球自己，不在这里画）。
   * 透明度基值做出"左浅右深"的层次，活动脉动在 tick 里按时间错相。 */
  const dotSpecs = [
    { dx: -46, r: 11.5, base: 0.42 },
    { dx: 46, r: 13, base: 0.72 }
  ];
  const dotsLayer = el('g', {}, svg);
  const sideDots = dotSpecs.map((s) => {
    const c = el('circle', { cx: CX + s.dx, cy: CY, r: s.r, fill: '#8E1424', opacity: 0 }, dotsLayer);
    c._spec = s;
    return c;
  });

  /* 检索的道具书：一本摊开的书垫在左下角，检索时眼睛沿书页左右扫。
   * 书是刚性道具，不进 rig（不跟着 pop/挤压），只带一点点呼吸浮动。 */
  const bookG = el('g', { opacity: 0 }, svg);
  const bookInner = el('g', {}, bookG);
  const BOOK_POS = `translate(${CX - 58} ${CY + 62}) rotate(-8)`;
  bookG.setAttribute('transform', BOOK_POS);
  const bookPage = (d) => el('path', {
    d, fill: '#FFF6DC', stroke: '#73101F', 'stroke-width': 2, 'stroke-linejoin': 'round'
  }, bookInner);
  bookPage('M -34 -10 Q -17 -17 0 -9 L 0 14 Q -17 8 -34 14 Z');
  bookPage('M 34 -10 Q 17 -17 0 -9 L 0 14 Q 17 8 34 14 Z');
  el('path', {
    d: 'M 0 -9 L 0 14', fill: 'none', stroke: '#73101F',
    'stroke-width': 2, 'stroke-linecap': 'round'
  }, bookInner);

  /* 彩带的"球后"层：画在球身之下，丝带绕到背面的弧段被球身自然遮挡，
   * 只在超出轮廓的两端露头——这是"环绕"而不是"贴在球上"的关键。
   * 每帧把 rig 的刚体 transform 同步给它，pop/弹跳时里外层不脱节。 */
  const ribbonBack = el('g', opts.glow !== false ? { filter: `url(#cw-glow-${n})` } : {}, svg);
  const rig = el('g', {}, svg);
  const clipped = el('g', { 'clip-path': `url(#cw-clip-${n})` }, rig);
  /* cw-hit：点击命中标记。宿主上层可能把 svg 整体 pointer-events:none（球叠在
   * 输入框上时不能挡住下面的按钮），只有这个球面路径重新开启命中——点球
   * 依然触发 poke，点球旁边的透明区域会穿透到下层。 */
  const bodyPath = el('path', { fill: `url(#cw-grad-${n})`, class: 'cw-hit' }, clipped);

  /* 经线：rx 随相位变化 → 自转。整组套泛光滤镜 */
  const meridianLayer = el('g', opts.glow !== false ? { filter: `url(#cw-glow-${n})` } : {}, clipped);
  const meridians = [];
  for (let i = 0; i < 4; i++) {
    meridians.push(el('ellipse', {
      cx: CX, cy: CY, rx: 0, ry: R * 1.05,
      fill: 'none', stroke: 'rgba(255,246,220,.55)', 'stroke-width': 1.8,
      'stroke-linecap': 'round'
    }, meridianLayer));
  }
  /* 纬线 */
  [-54, -28, 0, 28, 54].forEach((dy) => {
    const rx = Math.sqrt(Math.max(1, R * R - dy * dy));
    el('ellipse', {
      cx: CX, cy: CY + dy, rx, ry: Math.max(4, rx * 0.26),
      fill: 'none', stroke: 'rgba(255,246,220,.20)', 'stroke-width': 1.2
    }, clipped);
  });
  /* 高光 */
  el('ellipse', {
    cx: 68, cy: 54, rx: 26, ry: 14, fill: 'rgba(255,255,255,.22)',
    transform: 'rotate(-28 68 54)'
  }, clipped);

  const eyeLayer = el('g', {}, rig);
  const fx = el('g', {}, svg);
  const orbitDot = el('circle', { r: 4.5, fill: '#F4C34E', opacity: 0 }, fx);
  /* 彩带的"球前"层：最顶层，丝带在观众这一侧的弧段压在球脸上。
   * 两层都挂经线同款发光滤镜——丝带是"光带"，不是纸条 */
  const ribbonFront = el('g', opts.glow !== false ? { filter: `url(#cw-glow-${n})` } : {}, svg);

  /* 眼睛：五种字形共存，靠透明度交叉淡入 */
  function buildEye(sign) {
    const g = el('g', {}, eyeLayer);
    const inner = el('g', {}, g);
    const nodes = {};
    nodes.normal = el('rect', { fill: CREAM }, inner);
    nodes.wide = el('rect', { fill: CREAM }, inner);
    nodes.happy = el('path', {
      d: 'M -10 5 Q 0 -9 10 5', fill: 'none',
      stroke: CREAM, 'stroke-width': 5.5, 'stroke-linecap': 'round'
    }, inner);
    /* 闭眼线加粗到 6.5：5 的时候在红底上偏细，睡眠时看着像没画 */
    nodes.closed = el('line', {
      x1: -10, y1: 0, x2: 10, y2: 0, stroke: CREAM, 'stroke-width': 6.5, 'stroke-linecap': 'round'
    }, inner);
    const cg = el('g', { stroke: CREAM, 'stroke-width': 5, 'stroke-linecap': 'round' }, inner);
    el('line', { x1: -8, y1: -8, x2: 8, y2: 8 }, cg);
    el('line', { x1: 8, y1: -8, x2: -8, y2: 8 }, cg);
    nodes.cross = cg;
    const alpha = {};
    SHAPES.forEach((s) => { alpha[s] = s === 'normal' ? 1 : 0; });
    return { g, inner, nodes, sign, alpha, w: 20, h: 26, dy: 0, visible: true };
  }
  const eyes = [buildEye(-1), buildEye(1)];

  /* 单眼配置：状态可用 eyeL/eyeR 覆盖左/右眼的眼形、尺寸与垂直偏移
   * （大小眼、眯眼、圆点眼、睡姿的一高一低），缺省回落到基础 shape/w/h。 */
  const eyeCfg = (st, side) => st[side] || { shape: st.shape, w: st.w, h: st.h };

  /* ---------------- 状态 ---------------- */
  let target = normalize(STATES[FALLBACK]);
  let emotionId = FALLBACK;
  const cur = {};
  NUM_KEYS.forEach((k) => { cur[k] = target[k]; });

  let now = 0;
  let entryT = 0;
  let meridianPhase = 0;
  /* 打盹：待机在形变轮播的静止期中间往睡眠姿态插值。napSleep 只取一次，
   * 每帧复用 napVals 存混合结果，避免每帧新建对象。 */
  const napSleep = normalize(STATES['00']);
  const napVals = {};
  NUM_KEYS.forEach((k) => { napVals[k] = target[k]; });
  let napFired = false;
  /* 微表情：待机时的短期眼睛变奏（大圆眼 / 睁大 / 单眨眼）。
   * 调度**绑定在形变轮播的轮次上**：一个动作轮次（静止→饼→六角→三角→打盹→回球）
   * 内最多做一次，下一轮才可能再抽一次——原来按独立随机间隔跑，一个轮次里会连做
   * 两三回，观感是"表情太密"。有 morph 的状态用轮次制；没有 morph 的状态（如工作态）
   * 退回按 micro.every 的随机间隔。
   * 打盹（napK 高）依旧不抽也不续——睡着了的脸不该做表情。 */
  let micro = null;          /* 当前生效的一项，null = 无 */
  let microT0 = 0;           /* 本项开始时刻（毫秒） */
  let microNext = 0;         /* 本轮排定的触发时刻（无 morph 时 = 下一次可以抽的时刻） */
  let microDeadline = 0;     /* 本轮最后可触发时刻，过期本轮作废等下一轮 */
  let microRound = -1;       /* 已排定的轮次序号，轮次一变就重排 */
  let microSide = 0;         /* wink 闭哪只眼：0=左 1=右 */
  let microLast = '';        /* 上一次抽到的 key——下次要避开它，见下 */
  let microTipOn = false;    /* 当前 tip 是否被微表情的台词顶掉了（结束时换回来） */
  let microLineLast = '';    /* 上一句台词——连着说同一句太像复读机 */
  /* 形变轮播：只在 target.morph 存在时运转。tables 预烘焙各目标形状的半径表，
   * 每帧在「同角度的球半径」和「目标半径」之间插值，从数学上保证过渡无跳变。 */
  const MORPH_SAMPLES = 64;
  const morphTables = {};
  for (const kind of MORPH_KINDS) {
    if (kind !== 'ball') morphTables[kind] = shapeRadiusTable(kind, R, MORPH_SAMPLES);
  }
  let morphAnchor = 0;
  let blinkNext = 1600, blinkT = -1, blinkCount = 1;
  let glanceNext = 2400, glanceTarget = 0, glanceCur = 0;
  let gazeTX = 0, gazeTY = 0, gazeX = 0, gazeY = 0;
  let orbitA = 0;
  let zzzNext = 0;
  let bookK = 0;             /* 道具书的显示浓度（approach 渐显渐隐） */
  let particles = [];
  /* 点球转体：twirl = { t0, dir }，dir ∈ {+1,-1} 随机（顺/逆时针） */
  let twirl = null;
  let ribbons = [];
  let destroyed = false;
  const listeners = { change: [], error: [] };

  function onPointer(e) {
    const r = svg.getBoundingClientRect();
    const bx = r.left + r.width / 2;
    const by = r.top + r.height / 2;
    gazeTX = clamp((e.clientX - bx) / Math.max(140, window.innerWidth / 2), -1, 1);
    gazeTY = clamp((e.clientY - by) / Math.max(140, window.innerHeight / 2), -1, 1);
  }
  if (opts.gaze !== false) document.addEventListener('mousemove', onPointer);

  function burstConfetti(count = 26) {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + rand(-1.1, 1.1);
      const sp = rand(130, 260);
      particles.push({
        x: CX + rand(-20, 20), y: CY - 40,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: rand(0, 360), vr: rand(-400, 400),
        life: rand(0.9, 1.5), age: 0, text: false,
        node: el('rect', {
          x: -3.5, y: -1.5, width: 7, height: 3, rx: 1,
          fill: CONFETTI_COLORS[i % CONFETTI_COLORS.length]
        }, fx)
      });
    }
  }
  /**
   * 三节 Z 列车：同一出发点、同一速度，靠**负 age**（延迟出发）依次发车，
   * 于是飞行中自然排成一列——和单节 Z 的区别就是队形，不是三个独立粒子。
   * 越晚发车的越小（远处车厢），配合 opacity 衰减形成"飘远"的层次。
   */
  function spawnZTrain() {
    const vx = rand(-17, -8), vy = rand(-36, -24);
    for (let i = 0; i < 3; i++) {
      const t = el('text', {
        fill: ZZZ_COLOR, 'font-size': (16 - i * 2.2).toFixed(1),
        'font-weight': 900, 'font-family': 'system-ui, "Segoe UI", sans-serif', opacity: 0
      }, fx);
      t.textContent = 'Z';
      particles.push({
        x: 124, y: 46, vx, vy,
        rot: rand(-10, 10), vr: 0,
        life: 2.4, age: -i * ZZZ_INTERVAL, text: true, node: t
      });
    }
  }

  /* ---------------- 点球转身 + 流星彩带 ---------------- */
  /**
   * 流星彩带：一条倾斜的椭圆轨道上跑着一段"彗星"——
   *   渐变色  stroke 引用沿轨道长轴铺的 linearGradient（userSpaceOnUse），
   *           弧段沿轨道跑时颜色相对丝带流动，像彩虹在身上滑过；
   *   拖尾    弧段按采样序分 RIBBON_SEGS 段，尾细淡、头粗亮，段间共享采样点保证连续；
   *   变速    相位速度乘一个随时间的正弦脉冲，忽快忽慢才是流星；
   *   流星头  弧段头部挂一颗亮点圆（在球后时切到背层）。
   * 每帧按**轨道本地 y 的符号**把各段切成"背面段/正面段"，分别画进球后层
   * 与球前层——绕到背面的弧被球身挡住，只在两端露头，才有环绕的立体感。
   */
  function spawnRibbons(dir) {
    /* 5 对渐变色抽 3 不重复 */
    const pairs = RIBBON_PAIRS.slice();
    for (let i = pairs.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    for (let i = 0; i < 3; i++) {
      /* 轨道比球大一圈才像"环绕"：bloub 的丝带整体飘在球外。
       * svg 已开 overflow:visible，超出 viewBox 的部分飘到页面上，不再被裁 */
      const rx = R * rand(1.32, 1.55);
      const [c1, c2] = pairs[i];
      const baseTilt = RIBBON_TILTS[i] + rand(-0.2, 0.2);
      const ct = Math.cos(baseTilt), st = Math.sin(baseTilt);
      /* 渐变沿轨道长轴（随倾角旋转）铺满整条椭圆，首尾同色让颜色沿轨道循环 */
      const grad = el('linearGradient', {
        id: `cw-rbn-${n}-${i}`, gradientUnits: 'userSpaceOnUse',
        x1: (CX - rx * ct).toFixed(1), y1: (CY - rx * st).toFixed(1),
        x2: (CX + rx * ct).toFixed(1), y2: (CY + rx * st).toFixed(1)
      }, defs);
      el('stop', { offset: '0%', 'stop-color': c1 }, grad);
      el('stop', { offset: '50%', 'stop-color': c2 }, grad);
      el('stop', { offset: '100%', 'stop-color': c1 }, grad);
      const stroke = `url(#cw-rbn-${n}-${i})`;
      const back = [], front = [], opBack = [], opFront = [];
      for (let s = 0; s < RIBBON_SEGS; s++) {
        const kSeg = s / (RIBBON_SEGS - 1);            /* 0 = 尾，1 = 头 */
        const w = 2.2 + 5.0 * kSeg * kSeg;             /* 拖尾：二次曲线，头部明显粗 */
        const op = 0.22 + 0.78 * kSeg;                 /* 尾部淡但仍看得见，不能细到消失 */
        const attrs = {
          fill: 'none', stroke, 'stroke-width': w.toFixed(2),
          'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        };
        opBack.push(op * 0.7);
        opFront.push(op);
        back.push(el('path', Object.assign({}, attrs, { opacity: (op * 0.7).toFixed(3) }), ribbonBack));
        front.push(el('path', Object.assign({}, attrs, { opacity: op.toFixed(3) }), ribbonFront));
      }
      const hb = el('circle', { r: 3.6, fill: c2, opacity: 0 }, ribbonBack);
      const hf = el('circle', { r: 3.6, fill: c2, opacity: 0 }, ribbonFront);
      ribbons.push({
        grad, back, front, hb, hf, opBack, opFront, rx, ry: rx * rand(0.3, 0.4),
        tilt: baseTilt,
        phase: rand(0, TAU),               /* 弧段头部在轨道上的参数角 */
        sweep: rand(1.7, 2.4),             /* 弧段长度（弧度） */
        baseSpeed: rand(2.2, 3.2) * dir,   /* 与转体同向：丝带带着球转的感觉 */
        seed: rand(0, TAU),                /* 变速脉冲相位，每条错开不同步 */
        age: 0, life: RIBBON_LIFE
      });
    }
  }

  function updateRibbons(dt) {
    for (let i = ribbons.length - 1; i >= 0; i--) {
      const rb = ribbons[i];
      rb.age += dt;
      if (rb.age >= rb.life) {
        for (const p of rb.back) p.remove();
        for (const p of rb.front) p.remove();
        rb.hb.remove(); rb.hf.remove(); rb.grad.remove();
        ribbons.splice(i, 1);
        continue;
      }
      /* 流星变速：正弦脉冲忽快忽慢，最低压到 15% 防止完全停住 */
      const wobble = 1 + 0.85 * Math.sin(rb.age * 6.3 + rb.seed);
      rb.phase += rb.baseSpeed * Math.max(0.15, wobble) * dt;
      /* 包络：0.14s 淡入，结尾 0.45s 淡出（比转体晚收，转完还有余韵）。
       * 各段的粗细/相对透明度在 spawn 时已定，这里只乘整体 env。 */
      const env = Math.min(1, rb.age / 0.14) * clamp((rb.life - rb.age) / 0.45, 0, 1);
      const ct = Math.cos(rb.tilt), st = Math.sin(rb.tilt);
      const dBack = Array(RIBBON_SEGS).fill('');
      const dFront = Array(RIBBON_SEGS).fill('');
      let headPt = null;
      const PTS = 8;                     /* 每段采样点数，段间共享端点，拖尾是一条连续渐细的线 */
      for (let sIdx = 0; sIdx < RIBBON_SEGS; sIdx++) {
        let prevSide = null;             /* 每段各自维护：段首就必须发 M */
        for (let k = 0; k <= PTS; k++) {
          const u = (sIdx + k / PTS) / RIBBON_SEGS;
          const th = rb.phase + u * rb.sweep;
          const lx = rb.rx * Math.cos(th);
          const ly = rb.ry * Math.sin(th);
          const side = ly < 0 ? 'back' : 'front';   /* 轨道平面上半 = 绕向球后 */
          const X = CX + lx * ct - ly * st;
          const Y = CY + lx * st + ly * ct;
          if (u >= 1) headPt = { X, Y, side };
          const pt = X.toFixed(1) + ' ' + Y.toFixed(1);
          (side === 'back' ? dBack : dFront)[sIdx] += ((side === prevSide) ? ' L ' : 'M ') + pt;
          if (prevSide && prevSide !== side) {
            /* 跨越前后层的那一点同时写进两层，否则接缝缺一小截，拖尾会断开 */
            (prevSide === 'back' ? dBack : dFront)[sIdx] += ' L ' + pt;
          }
          prevSide = side;
        }
      }
      for (let sIdx = 0; sIdx < RIBBON_SEGS; sIdx++) {
        rb.back[sIdx].setAttribute('d', dBack[sIdx]);
        rb.front[sIdx].setAttribute('d', dFront[sIdx]);
        rb.back[sIdx].setAttribute('opacity', (rb.opBack[sIdx] * env).toFixed(3));
        rb.front[sIdx].setAttribute('opacity', (rb.opFront[sIdx] * env).toFixed(3));
      }
      /* 流星头：头点在球前亮在正面层，绕到球后切背层并压暗 */
      if (headPt) {
        const c = headPt.side === 'back' ? rb.hb : rb.hf;
        const dim = headPt.side === 'back' ? 0.45 : 1;
        c.setAttribute('cx', headPt.X.toFixed(1));
        c.setAttribute('cy', headPt.Y.toFixed(1));
        c.setAttribute('opacity', (env * dim).toFixed(3));
        (headPt.side === 'back' ? rb.hf : rb.hb).setAttribute('opacity', '0');
      }
    }
  }

  /** 点一下球：随机方向转身一圈（像地球自转，展示脸和背）+ 流星彩带。连点则直接重开一轮。 */
  function poke() {
    if (destroyed) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    twirl = { t0: now, dir, phase0: meridianPhase };
    for (const rb of ribbons) {
      for (const p of rb.back) p.remove();
      for (const p of rb.front) p.remove();
      rb.hb.remove(); rb.hf.remove(); rb.grad.remove();
    }
    ribbons = [];
    spawnRibbons(dir);
    if (typeof opts.onPoke === 'function') opts.onPoke(dir);
  }

  /** 点击命中：SVG 客户端坐标 → 200×200 viewBox，落点距球心 < 1.22R 才算点到球上 */
  function onClick(e) {
    if (!svg.getBoundingClientRect) return;
    const r = svg.getBoundingClientRect();
    if (!r || !r.width) return;
    const x = (e.clientX - r.left) * (200 / r.width);
    const y = (e.clientY - r.top) * (200 / r.height);
    if (Math.hypot(x - CX, y - CY) <= R * 1.22) poke();
  }
  if (opts.poke !== false && svg.addEventListener) {
    svg.addEventListener('click', onClick);
  }

  function setEmotion(id) {
    let def = STATES[id];
    if (!def) {
      const err = { message: `未知 emotionId: ${id}`, fallback: FALLBACK };
      listeners.error.forEach((cb) => cb(err));
      console.warn('[CaiwenBall]', err.message, '→ 回退', FALLBACK);
      def = STATES[FALLBACK];
      id = FALLBACK;
    }
    emotionId = id;
    target = normalize(def);
    entryT = now;
    blinkT = -1;
    /* 形变轮播从进入表情那一刻重新计时——切走再切回，5 秒静止从头算 */
    morphAnchor = now;
    napFired = false;
    zzzNext = now;
    /* 微表情重新排队：切进来不要立刻变脸。有 morph 的状态交给 tick 按轮次排
     * （microRound = -1 会让下一帧立刻排当前轮次），无 morph 的按 every 排。 */
    micro = null;
    microLast = '';
    microTipOn = false;            /* 下面 tipLine.set(target.tip) 会覆盖台词 */
    microRound = -1;
    microDeadline = Infinity;
    const hasMorph = !!(target.morph && target.morph.seq && target.morph.seq.length);
    microNext = !hasMorph && target.micro && target.micro.every
      ? now + rand(target.micro.every[0], target.micro.every[1])
      : Infinity;
    if (target.confetti) burstConfetti(26);
    if (tipLine) tipLine.set(target.tip || '');
    listeners.change.forEach((cb) => cb({ id, def: target }));
    if (typeof opts.onChange === 'function') opts.onChange(id, target);
  }

  /**
   * 调参专用：把一组字段直接灌进当前目标姿态。
   * 与 setEmotion 的区别是**不重置入场计时**，所以不会重播 pop / 彩带 / 眨眼，
   * 拖滑块时看到的是纯粹的姿态变化。正式运行不需要调它。
   */
  function tune(patch) {
    target = normalize(Object.assign({}, STATES[emotionId] || {}, patch));
  }

  /**
   * 形变轮播调度：按 (now - morphAnchor) 在周期内定位当前段落。
   * 时间轴：every(静止) → [变 seq[0] → 停 hold → 变 seq[1] → …] → 变回球 → 循环
   * 过渡用 outBack（overshoot ~10%），半径会弹过目标再回来——这就是用户要的
   * 「压缩、拉伸、回弹」手感。t 可能 >1，混合函数必须支持外插。
   */
  function morphInfo() {
    const m = target.morph;
    if (!m || !Array.isArray(m.seq) || !m.seq.length) return null;
    const tl = morphTimeline(m);
    const { morphMs, hold, every } = tl;
    let ph = (now - morphAnchor) % tl.total;
    if (ph < every) return { from: 'ball', kind: 'ball', t: 0 };
    ph -= every;
    let prev = 'ball';
    for (const kind of m.seq) {
      if (ph < morphMs) return { from: prev, kind, t: easings.outBack(clamp(ph / morphMs, 0, 1)) };
      ph -= morphMs;
      if (ph < hold) return { from: prev, kind, t: 1 };
      ph -= hold;
      prev = kind;
    }
    /* 收尾：最后一个形状变回球 */
    return { from: prev, kind: 'ball', t: easings.outBack(clamp(ph / morphMs, 0, 1)) };
  }

  /**
   * 微表情在本轮次内的可触发窗口（相对轮次起点的毫秒区间）。
   * 默认 0.6s ~ 打盹开始前 0.6s：表情要落在"清醒且没在睡"的区间里，否则排到睡梦里
   * 会被 napK 门控掐掉、本轮一次都做不成。没有打盹的状态取到轮次的 75%。
   * 想手工控位置就在 states 的 micro 上写 window: [min, max]。
   */
  function microWindow(mcfg, tl) {
    const w = Array.isArray(mcfg.window) ? mcfg.window : null;
    const lo = Math.max(0, w ? w[0] : 600);
    let hi;
    if (w) {
      hi = w[1];
    } else if (tl.napEnd > tl.napStart) {
      /* 上限要容得下**最长**那条微表情播完：打盹的 fade 从 napStart-350 就开始爬，
       * 播到一半被睡眠门控收掉（脸突然变回睡眠、台词被掐）很突兀，
       * 所以除了 fade 提前量，再往回退一个 maxDur。 */
      let maxDur = 700;
      for (const it of mcfg.items || []) maxDur = Math.max(maxDur, Number(it && it.dur) || 700);
      hi = tl.napStart - 350 - maxDur;
    } else {
      hi = tl.total * 0.75;
    }
    if (!(hi > lo)) hi = tl.total * 0.75;
    return [lo, Math.min(hi, Math.max(lo, tl.total - 200))];
  }

  /** 微表情结束后把台词换回当前表情自己的 tip（没换过就别多打一遍字） */
  function restoreTip() {
    if (!microTipOn) return;
    microTipOn = false;
    if (tipLine) tipLine.set(target.tip || '');
  }

  /**
   * 给当前轮次排定**唯一一次**微表情。
   * 有 morph：在本轮窗口内随机取一个时刻，超过 deadline 还没做成（比如被睡觉门控
   * 推过了头）就当本轮作废，等下一轮——宁可少做一次，也不在一个轮次里补做第二次。
   * 无 morph（工作态那类）：退回 micro.every 的随机间隔。
   */
  function scheduleMicro(nowMs, tl, idx) {
    if (tl) {
      const start = morphAnchor + idx * tl.total;
      const win = microWindow(target.micro, tl);
      microNext = start + rand(win[0], win[1]);
      microDeadline = start + win[1];
      microRound = idx;
    } else {
      const iv = target.micro.every || [2600, 5600];
      microNext = nowMs + rand(iv[0], iv[1]);
      microDeadline = Infinity;
      microRound = -1;
    }
  }

  /* ---------------- 每帧 ---------------- */
  function tick(ts, dt) {
    if (destroyed) return;
    now = ts;
    const age = (now - entryT) / 1000;

    /* 0) 点球转身调度：必须在经线渲染**之前**算好——转身期间 meridianPhase
     *    被精确覆写为 phase0+spinYaw（第 3 步跳过自然自转），否则渲染值会
     *    混入一帧自然自转，转完一圈收尾画面无法与起点重合。 */
    let spinYaw = 0, twirlPop = 1;
    if (twirl) {
      const a = (now - twirl.t0) / 1000;
      if (a >= SPIN_DUR) twirl = null;
      else {
        const t = easings.inOutCubic(a / SPIN_DUR);
        spinYaw = twirl.dir * TAU * t;
        meridianPhase = twirl.phase0 + spinYaw;
        twirlPop = 1 + 0.1 * Math.sin(Math.PI * Math.min(1, a / 0.35));
      }
    }

    /* 0) 打盹调度：静止期中间开一个时间窗，窗内把姿态整体往睡眠插值。
     *    窗口外 napK=0（形变轮播期间天然为 0，所以打盹不会和变形撞车）。
     *    这里不是 setEmotion 切表情——切表情会重置入场动画、重播 pop 和彩带，
     *    而打盹要的是"原地慢慢眯过去"，所以只在数值层面混合。 */
    const nap = target.morph && target.morph.nap;
    let napK = 0;
    if (nap && target.morph.seq && target.morph.seq.length) {
      /* 必须取模：用 (now - morphAnchor) 的绝对时间算窗的话，第一轮过去之后
       * 窗就永远落在身后了——表现就是"睡了一次之后再也不睡"。 */
      const tl = morphTimeline(target.morph);
      const ph = (now - morphAnchor) % tl.total;
      napK = pulseAmount(ph / 1000, tl.napStart / 1000, tl.napEnd / 1000,
        (nap.fade != null ? nap.fade : 350) / 1000);
    }

    /* 0.45) 思考省略号调度：进入 10 后先缩成一点（dotsK=1 时缩到 20%），
     *      左右浮出两个点组成"…"，dur 结束变回脸，every 循环一次。
     *      pulseAmount 的 start/fade 都取 fade 值 → 进出各有 fade 毫秒的淡入淡出。 */
    const dots = target.dots;
    let dotsK = 0;
    if (dots && dots.every > 0) {
      const ph = (now - entryT) % dots.every;
      const fade = (dots.fade != null ? dots.fade : 400) / 1000;
      dotsK = pulseAmount(ph / 1000, fade, (dots.dur || 2200) / 1000, fade);
    }

    /* 0.5) 微表情调度：短期眼睛变奏（大圆眼 / 睁大 / 单眨眼）。
     *    **一个动作轮次只做一次**：触发时刻按轮次排定（见 scheduleMicro），
     *    做完就把 microNext 打到 Infinity，本轮不再抽，下一轮才重新排。
     *    原来按独立随机间隔跑，一个 12.6s 的轮次里会连做两三回，表情太密。
     *    打盹（napK > 0.15）不抽也不续——睡眠表情保持不动，这是明确要求；
     *    形变轮播期间照常出现（饼/六角/三角形态下也会瞪一下、眨一下）。 */
    let microK = 0;
    const mcfg = target.micro;
    if (mcfg && mcfg.items && mcfg.items.length) {
      const mtl = target.morph && target.morph.seq && target.morph.seq.length
        ? morphTimeline(target.morph) : null;
      const idx = mtl ? Math.floor((now - morphAnchor) / mtl.total) : -1;
      if (mtl ? idx !== microRound : !isFinite(microNext)) scheduleMicro(now, mtl, idx);
      if (napK > 0.15) {
        /* 睡着的脸不做表情：正在进行的一律收掉（否则微表情会盖掉睡眠闭眼线，
         * 表现成"打盹时突然瞪大眼"），并把下一次推到醒来之后。已经做过的那轮
         * microNext 是 Infinity，取 max 后仍是 Infinity → 本轮不会补做第二次。 */
        micro = null;
        restoreTip();
        microNext = Math.max(microNext, now + 700);
      } else if (!micro && now >= microNext && now <= microDeadline) {
        /* 不连着做同一个微表情：纯加权随机在只有 3 种时会频繁连出同种
         * （实测 7 次里就撞了 1 次 wink 接 wink），观感是"一直都在 wink"。
         * 抽之前把上一次那个踢出候选池，剩下的仍按权重抽——交错但不呆板。
         * 只剩一项（或清一色同名）时不踢，否则会永远抽不到。 */
        const pool = mcfg.items.length > 1
          ? mcfg.items.filter((it) => (it.key || it) !== microLast)
          : mcfg.items;
        micro = pickWeighted(pool.length ? pool : mcfg.items);
        microT0 = now;
        microLast = micro ? (micro.key || micro) : '';
        microSide = micro && (micro.wink === 'L' ? 0 : micro.wink === 'R' ? 1 : (Math.random() < 0.5 ? 0 : 1));
        microNext = Infinity;      /* 本轮用掉唯一名额 */
        /* 台词：做表情的同时换一句话（typeline 会先删后打，不会两段文字叠在一起），
         * 微表情结束由 restoreTip() 换回表情自己的 tip。 */
        const lines = micro && micro.lines;
        if (lines && lines.length && tipLine) {
          let line = lines[Math.floor(Math.random() * lines.length)];
          /* 只有一句时没法躲；两句以上撞了上一句就顺移一位，别连着说同一句 */
          if (lines.length > 1 && line === microLineLast) {
            line = lines[(lines.indexOf(line) + 1) % lines.length];
          }
          microLineLast = line;
          tipLine.set(line);
          microTipOn = true;
        }
      }
      if (micro) {
        const dur = micro.dur > 0 ? micro.dur : 700;
        const a = now - microT0;
        if (a >= dur) {
          micro = null;
          restoreTip();
        } else {
          microK = pulseAmount(a / 1000, 0, dur / 1000, (micro.fade != null ? micro.fade : 120) / 1000);
        }
      }
    }

    /* 1) 姿态数值趋近目标（帧率无关）。眼形与尺寸左右独立插值，
     *    切换时两眼各自淡入淡出，才有 bloub 那种"换表情不换帧"的顺滑 */
    for (const k of NUM_KEYS) {
      napVals[k] = napK > 0 ? lerp(target[k], napSleep[k], napK) : target[k];
      cur[k] = approach(cur[k], napVals[k], 9, dt);
    }
    const eyeTargets = [
      eyeBlend(eyeCfg(target, 'eyeL'), eyeCfg(napSleep, 'eyeL'), napK),
      eyeBlend(eyeCfg(target, 'eyeR'), eyeCfg(napSleep, 'eyeR'), napK)
    ];
    for (let i = 0; i < 2; i++) {
      const eye = eyes[i];
      /* 微表情覆盖：k 过半才换目标形状，配合 alpha 的指数逼近得到"渐变过去"而不是硬切。
       * wink 只闭一侧——另一侧保持胶囊，闭的那侧换成闭眼线（比压扁的胶囊更像"眨眼"）。 */
      let tc = eyeTargets[i];
      if (micro && microK > 0.5) {
        if (micro.wink && microSide === i) {
          tc = { shape: 'closed', w: Math.max(tc.w, (micro.w || tc.w) * 1.15), h: tc.h, dy: tc.dy };
        } else {
          tc = {
            shape: micro.shape || tc.shape,
            w: micro.w != null ? micro.w : tc.w,
            h: micro.h != null ? micro.h : tc.h,
            dy: tc.dy
          };
        }
      }
      for (const s of SHAPES) eye.alpha[s] = approach(eye.alpha[s], tc.shape === s ? 1 : 0, 11, dt);
      eye.w = approach(eye.w, tc.w, 9, dt);
      eye.h = approach(eye.h, tc.h, 9, dt);
      eye.dy = approach(eye.dy, tc.dy || 0, 9, dt);
    }

    /* 2) 身形：低频调和形变（连续半径函数，天然光滑，无圆包络的扇贝纹）。
     *    sphereSilhouette 以原点为球心，画前平移到画布坐标 (CX,CY)。
     *    形变轮播：每个取样点沿自己的方向角，在球半径与目标形状半径之间
     *    用弹性 t 插值——目标半径同样乘 breathe，呼吸在形变期间不停。 */
    const breathe = 1 + cur.breatheAmp * Math.sin((now / 1000) * cur.breatheHz * TAU);
    const hull = sphereSilhouette(R, {
      squash: cur.squash, taper: cur.taper, lean: cur.lean, breathe
    }).map(([x, y]) => [x + CX, y + CY]);
    const mi = morphInfo();
    if (mi && mi.t !== 0) {
      const toTable = mi.kind === 'ball' ? null : morphTables[mi.kind];
      const fromTable = mi.from === 'ball' ? null : morphTables[mi.from];
      for (let i = 0; i < hull.length; i++) {
        const x = hull[i][0] - CX, y = hull[i][1] - CY;
        const r0 = Math.hypot(x, y);
        if (r0 < 1e-6) continue;
        const th = Math.atan2(y, x);
        const rFrom = fromTable ? tableRadiusAt(fromTable, th) * breathe : r0;
        const rTo = toTable ? tableRadiusAt(toTable, th) * breathe : r0;
        const r = rFrom + (rTo - rFrom) * mi.t;   /* t 可 >1（outBack 外插 = 回弹） */
        hull[i][0] = CX + (x / r0) * r;
        hull[i][1] = CY + (y / r0) * r;
      }
    }
    const d = smoothClosedPath(hull);
    bodyPath.setAttribute('d', d);
    clipPath.setAttribute('d', d);

    /* 3) 经纬线自转
     *    cos 决定这条经线此刻被压得多窄（正对观众时最宽、侧对时收成一条线），
     *    sin 的符号区分它在球的正面还是背面——背面压暗一半，转动才有"绕过去"的立体感，
     *    否则四条线亮度一样，看起来只是在原地缩放。 */
    if (!twirl) meridianPhase += dt * 0.55 * Math.max(0.001, cur.meridian || 1);
    /* 省略号阶段整组经线淡出：发光线缩在 15px 的小球上是一团噪点 */
    meridianLayer.setAttribute('opacity', (1 - dotsK).toFixed(3));
    meridians.forEach((m, i) => {
      const ph = meridianPhase + (i * Math.PI) / 4;
      const rx = Math.abs(Math.cos(ph)) * R * 1.2;
      const front = Math.sin(ph) > 0 ? 1 : 0.42;
      m.setAttribute('rx', Math.max(1.5, rx).toFixed(2));
      m.setAttribute('opacity', ((MERIDIAN_BASE + MERIDIAN_GAIN * (rx / (R * 1.2))) * front).toFixed(3));
    });

    /* 4) 头部朝向 = 基础姿态 + 点球转身 + 鼠标注视 + 随机瞟一眼 + 扫视 + 飘移
     *    转身（spinYaw）在 0) 已算好：headYaw 绕竖直轴转过 2π，眼睛沿球面横移、
     *    靠边缘时被透视压缩、过背面被剔除消失、再从另一侧绕回来——projectEye
     *    的球面投影天然支持，所以"展示脸和背"不用额外建模，一个 yaw 偏移就够了。 */
    gazeX = approach(gazeX, gazeTX, 6, dt);
    gazeY = approach(gazeY, gazeTY, 6, dt);
    if (target.glanceMs && now > glanceNext) {
      glanceTarget = (Math.random() < 0.5 ? -1 : 1) * target.glanceYaw * rand(0.6, 1);
      glanceNext = now + rand(target.glanceMs[0], target.glanceMs[1]);
    }
    /* 打盹时不瞟、不眨眼、不受鼠标牵引——睡眠姿态的 gazeWeight 是 0，
     * 这里用混合值让牵引力随打盹深度平滑退掉，而不是一刀切 */
    const gazeW = lerp(target.gazeWeight || 0, napSleep.gazeWeight || 0, napK);
    glanceCur = approach(glanceCur, (target.glanceMs && napK < 0.45) ? glanceTarget : 0, 5, dt);

    /* 生命感游移：多周期叠加的极慢眼神漂移，幅度小到像呼吸带出来的。
     * 与 driftYaw 的区别——drift 是单个正弦（思考状态用），wander 是多周期噪声（待机用）。
     * yaw / pitch 用不同相位，避免两个方向同步摆动变成斜线运动。 */
    let wanderYaw = 0, wanderPitch = 0;
    const wb = target.wander;
    if (wb && wb.periods && wb.periods.length) {
      const ty = now / 1000;
      const fade = 1 - napK;   /* 打盹时游移逐渐停下，睡着了眼神就不该再飘 */
      wanderYaw = loopNoise(ty, wb.periods, 0) * (wb.amp || 0) * fade;
      wanderPitch = loopNoise(ty, wb.periods, 2.1) * (wb.ampPitch != null ? wb.ampPitch : (wb.amp || 0) * 0.6) * fade;
    }

    const headYaw = cur.yaw
      + spinYaw
      + gazeX * 0.5 * gazeW
      + glanceCur
      + wanderYaw
      + Math.sin((now / 1000) * (cur.scanHz || 0) * TAU) * cur.scanYaw
      + Math.sin((now / 1000) * (cur.driftHz || 0) * TAU) * cur.driftYaw;
    /* 视线符号映射（易错点，别随手改符号）：
     *   projectEye 约定 yaw 正 = 眼向右（x 增大）、pitch 正 = 眼向上（y 减小）。
     *   鼠标在球右侧 → gazeX > 0，要向右看 → yaw 取 +；
     *   鼠标在球下方 → gazeY > 0（clientY 向下为正），要向下看 → pitch 必须取 -，
     *   否则就出现"眼神跟鼠标反着来"的 bug（SVG 的 y 轴朝下，和直觉相反）。 */
    const headPitch = cur.pitch - gazeY * 0.3 * gazeW + wanderPitch;

    /* 5) 眨眼（打盹中眼已闭，不眨） */
    let openMul = 1;
    if (target.blinkMs && napK < 0.45) {
      if (blinkT < 0 && now > blinkNext) {
        blinkT = 0;
        /* 单眨 / 连眨两下交替——真人不会每次都眨得一模一样，这是最便宜的"活人感" */
        blinkCount = target.blinkDouble ? (blinkCount === 1 ? 2 : 1) : 1;
        blinkNext = now + rand(target.blinkMs[0], target.blinkMs[1]);
      }
      if (blinkT >= 0) {
        const dur = 0.24 * (blinkCount === 2 ? 1.35 : 1);   /* 连眨整体略长，不显得赶 */
        blinkT += dt / dur;
        openMul = blinkOpenMul(Math.min(1, blinkT), blinkCount);
        if (blinkT >= 1) blinkT = -1;
      }
    }

    /* 6) 眼睛落位 */
    for (const eye of eyes) {
      const p = projectEye({ yaw: headYaw + eye.sign * EYE_LON, pitch: headPitch, R: EYE_R, cx: CX, cy: CY });
      const fixed = clampToHull(hull, CX, CY, p.x, p.y, 0.86);
      eye.visible = p.visible;
      eye.g.setAttribute('opacity', p.visible ? (1 - dotsK).toFixed(3) : '0');
      if (!p.visible) continue;
      eye.g.setAttribute('transform',
        `translate(${fixed.x.toFixed(2)} ${(fixed.y + eye.dy).toFixed(2)}) rotate(${cur.tilt.toFixed(2)}) scale(${p.sx.toFixed(3)} ${p.sy.toFixed(3)})`);
      /* open 的纵向压缩只作用于矩形类眼形（normal/wide）。
       * 描边类眼形（happy 笑弧 / closed 闭眼线 / cross 叉）一旦被非均匀 scale，
       * 描边粗细会被一起压掉——睡眠那条闭眼线就是这样消失的。 */
      const openScale = `scale(1 ${Math.max(0.05, cur.open * openMul).toFixed(3)})`;
      eye.nodes.normal.setAttribute('transform', openScale);
      eye.nodes.wide.setAttribute('transform', openScale);
      setRect(eye.nodes.normal, eye.w, eye.h);
      setRect(eye.nodes.wide, eye.w * 1.3, eye.h * 1.3);
      setBar(eye.nodes.closed, eye.w);
      /* 笑弧/叉这类描边眼形不吃 open 的非等比压缩（会连描边一起压没），
       * 但可以按 w **等比**缩放——等比不会破坏描边粗细比例。基准 20。 */
      const arcScale = (eye.w / 20).toFixed(3);
      eye.nodes.happy.setAttribute('transform', `scale(${arcScale})`);
      eye.nodes.cross.setAttribute('transform', `scale(${arcScale})`);
      for (const s of SHAPES) eye.nodes[s].setAttribute('opacity', eye.alpha[s].toFixed(3));
    }

    /* 7) 轨道小点（思考 / 检索） */
    const orbiting = target.scanHz > 0 || (target.meridian || 0) > 2;
    if (orbiting) {
      orbitA += dt * 2.6;
      const ox = CX + Math.cos(orbitA) * 48;
      const oy = 30 + Math.sin(orbitA) * 9;
      orbitDot.setAttribute('cx', ox.toFixed(2));
      orbitDot.setAttribute('cy', oy.toFixed(2));
      orbitDot.setAttribute('opacity', Math.cos(orbitA) > 0 ? '0.9' : '0.25');
    } else {
      orbitDot.setAttribute('opacity', approach(parseFloat(orbitDot.getAttribute('opacity')) || 0, 0, 10, dt).toFixed(3));
    }

    /* 8) Zzz：打盹是上升沿触发，且把下次发车推到窗结束之后——一次打盹只飘一列，
     *    否则 2 秒的窗里会挤出两列车，看着像打了个很忙的盹。
     *    00 睡眠是常驻表情，走下面的定时发车（1.5~2.1s 一列）。 */
    const sleeping = target.zzz || napK > 0.55;
    if (napK > 0.55 && !napFired) { napFired = true; spawnZTrain(); zzzNext = now + 2800; }
    if (napK < 0.35) napFired = false;
    if (sleeping && now > zzzNext) { spawnZTrain(); zzzNext = now + rand(1500, 2100); }

    /* 9) 粒子 */
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age < 0) { p.node.setAttribute('opacity', '0'); continue; }   /* 还没发车 */
      if (p.age >= p.life) { p.node.remove(); particles.splice(i, 1); continue; }
      if (!p.text) p.vy += 300 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = 1 - p.age / p.life;
      p.node.setAttribute('transform', `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.rot.toFixed(1)})`);
      p.node.setAttribute('opacity', (p.text ? k * 0.9 : Math.min(1, k * 2)).toFixed(3));
    }

    /* 9.5) 彩带轨道（点球触发的环绕特效） */
    updateRibbons(dt);

    /* 10) 刚体：pop / 弹跳 / 抖动 / 完成时的转体（点球转身不走这里，
     *     它是 yaw 层的球面旋转——rig 的 2D rotate 会把眼睛翻倒，不符合"地球自转"） */
    const pop = 1 + target.pop * Math.sin(Math.PI * Math.min(1, age / 0.5));
    const bounceY = -Math.abs(Math.sin(now / 280)) * 5 * cur.bounce;
    const shakeX = target.shake ? Math.sin(now * 0.045) * 2.6 : 0;
    const confettiSpin = target.confetti ? 360 * (age < 0.9 ? (1 - Math.pow(1 - Math.min(1, age / 0.9), 3)) : 1) : 0;

    /* 入场弹跳（hop）：像拍篮球——先弹起来，再一跳比一跳矮地连弹几下。
     * ① 高度用抛物线 4f(1-f) 而不是 |sin|：正弦的上升段太"飘"，抛物线才是重力下的轨迹；
     * ② 一跳比一跳矮 = height * decay^k；
     * ③ 触地那一瞬挤压（非等比 scale），弹起时略微拉长——"有重量"的弹跳靠这个，
     *    只有上下位移会像飘着的肥皂泡；
     * ④ 只跑入场那一段（age 从切表情起算），times 跳之后归 0 自然收住。 */
    let hopY = 0, hopSX = 1, hopSY = 1;
    const hp = target.hop;
    if (hp) {
      const u = age / hp.period;
      const k = Math.floor(u);
      if (k < hp.times) {
        const f = u - k;
        const hr = 4 * f * (1 - f);                        /* 0 = 触地，1 = 最高点 */
        const amp = hp.height * Math.pow(hp.decay, k);     /* 第 k 跳的高度 */
        const ratio = amp / hp.height;
        hopY = -amp * hr;
        const contact = Math.pow(1 - hr, 6);               /* 只在触地瞬间接近 1 */
        hopSY = 1 - 0.18 * contact + 0.05 * hr * ratio;
        hopSX = 1 + 0.14 * contact - 0.03 * hr * ratio;
      }
    }

    const popAll = pop * twirlPop;
    /* scale 的锚点放在球底（相对球心再往下 R）而不是球心：挤压时是"压在地上"，
     * 而不是两头一起缩、看着像悬空。rotate 仍以球心为轴。 */
    const rigT = `translate(${shakeX.toFixed(2)} ${(bounceY + hopY).toFixed(2)}) translate(${CX} ${CY}) rotate(${confettiSpin.toFixed(2)}) translate(0 ${R}) scale(${(popAll * hopSX).toFixed(3)} ${(popAll * hopSY).toFixed(3)}) translate(0 ${-R}) translate(${-CX} ${-CY})`;
    /* 省略号阶段围绕球心整体缩小——中间那颗"点"就是缩小的球自己，眼睛/经线已淡出 */
    const shrink = 1 - dotsK * 0.8;
    const dotsT = shrink < 1
      ? `translate(${CX} ${CY}) scale(${shrink.toFixed(3)}) translate(${-CX} ${-CY}) `
      : '';
    rig.setAttribute('transform', dotsT + rigT);
    ribbonBack.setAttribute('transform', dotsT + rigT);   /* 球后彩带层与球身同步运动 */

    /* 10.5) 思考旁点 + 道具书 */
    for (const c of sideDots) {
      const s = c._spec;
      /* 三个点轮流"鼓"一下：按时间错相的正弦，左中右依次活跃，像在打字 */
      const w = 0.5 + 0.5 * Math.sin(now / 1000 * 4.6 - (s.dx < 0 ? 0.9 : s.dx > 0 ? -0.9 : 0));
      c.setAttribute('r', (s.r * (0.82 + 0.22 * w)).toFixed(2));
      c.setAttribute('opacity', (s.base * dotsK * (0.55 + 0.45 * w)).toFixed(3));
    }
    /* 影子跟球一起淡出：省略号阶段球悬空变成了"文字"，地上不该有影子 */
    shadowEl.setAttribute('opacity', (1 - dotsK * 0.85).toFixed(3));

    bookK = approach(bookK, target.book ? 1 : 0, 6, dt);
    bookG.setAttribute('opacity', bookK.toFixed(3));
    if (bookK > 0.01) {
      /* 跟呼吸同频的一点点浮动，书不是钉死的 */
      const bob = Math.sin(now / 1000 * (cur.breatheHz || 0.4) * TAU) * 1.6;
      bookInner.setAttribute('transform', `translate(0 ${bob.toFixed(2)})`);
    }
  }

  addTicker(tick);

  function destroy() {
    destroyed = true;
    removeTicker(tick);
    document.removeEventListener('mousemove', onPointer);
    if (svg.removeEventListener) svg.removeEventListener('click', onClick);
    if (tipLine) tipLine.destroy();
    svg.remove();
  }

  return {
    setEmotion,
    tune,
    poke,
    destroy,
    on(evt, cb) { if (listeners[evt]) listeners[evt].push(cb); return this; },
    get emotion() { return emotionId; }
  };
}

export { STATES, FALLBACK };
