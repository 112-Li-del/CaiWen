/* ============================================================
 * states.js —— 表情配置（纯数据）
 * ------------------------------------------------------------
 * 每个表情 = 一段姿态 + 一组行为开关。加表情不用动引擎。
 *
 * emotionId 分段是对外契约，编号只增不改：
 *   00-09 生命周期 · 10-19 代理工作状态 · 20-29 结果反馈 · 30-49 预留 · 50+ 自定义
 *
 * 姿态字段（引擎逐帧插值）：
 *   shape      主眼形：normal 胶囊 / wide 大眼 / happy 笑弧 / closed 闭眼 / cross 叉
 *   open       眼睛开合 0~1            w/h     眼睛尺寸（左右眼共同的基础值）
 *   eyeL/eyeR  单眼覆盖 {shape,w,h,dy?}——大小眼、眯眼、圆点眼都靠它，缺省用基础值；
 *              dy 是该眼的屏幕垂直偏移（px，正=向下），做"一眼高一眼低"的睡姿用
 *   tilt       单眼倾角（度）          yaw/pitch 头部转向（弧度）
 *   squash     身形挤压（+矮胖/-瘦高） taper   水滴感（+下宽上窄）
 *   lean       歪头（+右倾）           breatheAmp/Hz 呼吸幅度与频率
 *   meridian   经纬线自转倍速
 *
 * 行为字段（叠加在姿态之上）：
 *   blinkMs      眨眼间隔随机区间，null = 不眨
 *   blinkDouble  单眨 / 连眨两下交替（活人感），true 开启
 *   wander       { amp, ampPitch, periods } 多周期叠加的极慢眼神游移（呼吸感），
 *                periods 必须互不成整数比，否则会看出循环
 *   glanceYaw    随机瞟一眼的偏航幅度    glanceMs  瞟一眼的触发间隔
 *   gazeWeight   跟随鼠标的强度 0~1
 *   driftYaw/Hz  缓慢飘移（思考时的眼神游移）
 *   scanYaw/Hz   左右扫视（检索资料）
 *   bounce       持续弹跳强度            pop       切入时的一次性弹跳
 *   shake        出错抖动                zzz       飘 Z（三节列车） confetti 撒彩带
 *   morph        待机形变轮播（只有长时间停留的表情才配，见下）
 *
 * morph 契约：{ every, hold, morphMs, seq, nap? }
 *   every    静止多少毫秒后开始轮播
 *   seq      依次变成的形状（MORPH_KINDS 里的 key），每个停留 hold 毫秒
 *   morphMs  单次形变过渡时长（用 outBack 弹性缓动，有压缩-回弹感）
 *   轮完 seq 自动变回球，再等 every 进入下一轮。切走表情即中断。
 *
 * nap 契约（挂在 morph 上）：{ at, duration, fade?, sleep }
 *   at        **形变轮播结束后**多少毫秒开始打盹（顺序：先变形，再睡）
 *   duration  打盹窗长度（毫秒，含首尾缓入缓出）
 *   fade      缓入缓出时长（毫秒，默认 350）
 *   sleep     打盹时插值过去的表情 id（目前是 '00' 睡眠）
 *   打盹不是切换表情，而是在待机姿态与睡眠姿态之间做连续插值——
 *   所以进入/退出都是平滑的，切走表情（或形变轮播开始）会自然中断。
 *
 * micro 契约（挂在长时间停留的表情上）：{ every, items }
 *   every   两次微表情之间的随机间隔区间 [min,max]（毫秒）
 *   items   微表情清单，每项：
 *     key     名字（便于调试/测试断言）
 *     weight  权重（缺省 1），越大出现越频繁
 *     dur     持续时间（毫秒，含首尾 fade 缓入缓出）
 *     fade    缓入缓出时长（毫秒，默认 120）
 *     shape/w/h  覆盖基础眼形与尺寸（不写则沿用当前值）
 *     wink    'L' | 'R' | 'random'：单眨眼，该侧换成闭眼线，另一侧保持
 *   微表情只在**清醒**时抽（打盹/睡眠期间不触发），形变轮播期间照常出现。
 *   它改的是眼睛目标，走的是和切表情同一套 alpha/尺寸插值，所以进出都平滑。
 * ============================================================ */

/**
 * 形变轮播的时间轴（纯函数，无 DOM，可单测）。段落顺序：
 *   [0, every)                    待机静止
 *   [every, every+show)           形变轮播（seq 各停留 hold，最后 morphMs 变回球）
 *   [every+show, napStart)        变形结束后的缓冲（球）
 *   [napStart, napEnd)            打盹窗（含首尾 fade 缓入缓出）
 *   [napEnd, total)               → 周期结束，回到待机静止
 *
 * 打盹排在形变**之后**是明确要求的顺序；引擎按 total 取模定位相位，
 * 所以每一轮都会打盹（早期版本用绝对时间算窗，导致只睡了一次）。
 */
export function morphTimeline(m) {
  const morphMs = m.morphMs > 0 ? m.morphMs : 450;
  const hold = m.hold >= 0 ? m.hold : 1000;
  const every = m.every >= 0 ? m.every : 5000;
  const show = m.seq.length * (morphMs + hold) + morphMs;
  const napAt = m.nap ? (m.nap.at || 0) : 0;
  const napDur = m.nap ? m.nap.duration : 0;
  const napStart = every + show + napAt;
  return {
    morphMs, hold, every, show,
    napStart, napEnd: napStart + napDur,
    total: Math.max(1, napStart + napDur)
  };
}

export const FALLBACK = '01';

export const GROUPS = [
  { key: 'life', name: '生命周期' },
  { key: 'agent', name: '代理工作状态' },
  { key: 'feedback', name: '结果反馈' }
];

export const STATES = {
  '00': {
    id: '00', name: '睡眠', group: 'life', tip: 'Zzz…',
    /* 眼位照 bloub 睡眠截图摆：两条细闭眼线落在球中线下方（pitch 负 = 眼位低，
     * projectEye: y = cy − R·sin(pitch)），右眼比左眼高一点（eyeR.dy = -9），
     * 线微微向右上挑（tilt 负 = 逆时针）。w 决定闭眼线长度，26 比待机 13 长一截。
     * open = 0.15 是**睡醒动画**的机关：苏醒时 closed 线淡出、normal 眼形淡入，
     * 而 open 从 0.15 爬回 1——normal 眼形以"压扁的胶囊"出现再慢慢立起来，
     * 正是"眼睛从一条线鼓成一颗眼"的膨胀感（参考 bloub 醒来的逐帧）。 */
    shape: 'closed', open: 0.15, w: 26, h: 26, tilt: -5, yaw: 0, pitch: -0.26,
    eyeR: { shape: 'closed', w: 26, h: 26, dy: -9 },
    squash: 0.08, taper: 0.22, lean: 0, breatheAmp: 0.008, breatheHz: 0.34,
    meridian: 0.25, driftYaw: 0, driftHz: 0, scanYaw: 0, scanHz: 0,
    bounce: 0, pop: 0.03, blinkMs: null, glanceYaw: 0, glanceMs: null,
    gazeWeight: 0, shake: false, zzz: true, confetti: false
  },
  '01': {
    id: '01', name: '待机', group: 'life', tip: '我在呢，随便问～',
    /* 眼睛比例照 bloub 实拍截图量得：眼宽≈球径 8.4%、眼高≈19%（细长竖胶囊 13×30）。
     * pitch -0.12：projectEye 的 y = cy − R·sin(pitch)，负 pitch = 眼位在球中线略下方。
     * 左右眼完全相同，不写 eyeL/eyeR 覆盖。 */
    shape: 'normal', open: 1, w: 13, h: 30, tilt: 0, yaw: 0, pitch: -0.12,
    squash: 0, taper: 0, lean: 0.01, breatheAmp: 0.012, breatheHz: 0.26,
    meridian: 1, driftYaw: 0, driftHz: 0, scanYaw: 0, scanHz: 0,
    bounce: 0, pop: 0.06, blinkMs: [2600, 5600], glanceYaw: 0.3, glanceMs: [2200, 5200],
    gazeWeight: 1, shake: false, zzz: false, confetti: false,
    /* 活人感：① 单眨/双眨交替 ② 眼神多周期缓慢游移（周期互不整除 → 看不出重复） */
    blinkDouble: true,
    wander: { amp: 0.07, ampPitch: 0.035, periods: [11.3, 3.7, 9.1] },
    /* 待机专属：静止 5s（中间 1.5s~3.5s 打盹）→ 压扁圆柱饼 → 六角 → 三角（各停 1s）
     * → 变回球 → 循环。打盹不是切表情，是往睡眠姿态插值，进出都是渐变。 */
    morph: {
      every: 5000, hold: 1000, morphMs: 450, seq: ['pancake', 'hexagon', 'triangle'],
      nap: { at: 800, duration: 2000, fade: 350, sleep: '00' }
    },
    /* 微表情：待机时不该一直一个表情，偶尔来一下才像活的。
     * 三种随机轮番出现，**每种自带一组台词**（lines）——做表情时下面的文案换成
     * 里面随机一句，做完换回表情自己的 tip：
     *   ① surprise 大圆眼（w=h → rect 的 rx=w/2 正好是圆）——配"在想事"的台词；
     *   ② widen   纯粹睁大，仍是胶囊（w/h 同比放大，比例不变才认得出是同一个球）
     *              ——配"被吓一跳/委屈"的台词；
     *   ③ wink    单眨眼（随机左右），闭的那侧换成闭眼线，另一侧保持胶囊。
     * dur 是表情时长，按"看得清"给的：原来 0.76~1.1s 一闪而过，现在 1.2~1.7s。
     * **调度按"动作轮次"走**：一个形变轮播周期（12.6s）内只做一次，位置在轮次的
     * 清醒窗口里随机（默认 0.6s 起，且保证最长的那条能播完才打盹），下一轮才可能再来
     * 一次。原来按独立随机间隔跑，一轮里会连做两三回，太密。
     * every 只在**没有 morph** 的状态下生效（那时退化成随机间隔）；
     * 想手工指定位置就写 window: [min,max]（相对轮次起点的毫秒）。
     * 打盹/睡眠期间不抽；形变轮播（饼/六角/三角）期间照常出现。 */
    micro: {
      every: [2600, 5600],
      items: [
        { key: 'surprise', weight: 2, dur: 1500, shape: 'normal', w: 33, h: 33,
          lines: ['思考ing', '让我想想', '有点意思~'] },
        { key: 'widen', weight: 3, dur: 1700, shape: 'normal', w: 18, h: 41,
          lines: ['震惊！', '什么？', '你还好吗？', '呜呜呜~'] },
        { key: 'wink', weight: 3, dur: 1200, shape: 'normal', w: 16, h: 34, wink: 'random',
          lines: ['wink~', '想什么呢？'] }
      ]
    }
  },
  '02': {
    id: '02', name: '欢迎', group: 'life', tip: '你好呀！我是财宝',
    /* 欢迎 = 笑弧 + 拍球式入场。
     * ① 两只眼都是 happy 笑弧，左右一致（原来草稿里的 26×33 / 22×28 大小眼是随手写的，去掉）；
     *    w 在引擎里等比缩放笑弧（20 为基准），26 = 比基准略大一点，笑得更开。
     * ② hop：进门先跳起来，再一跳比一跳矮地连弹几下（decay 0.55，4 跳约 2.1s），
     *    弹完自然停住——欢迎只占 3s，正好弹完就切待机。 */
    shape: 'happy', open: 1, w: 26, h: 26, tilt: 0, yaw: 0, pitch: -0.08,
    squash: -0.05, taper: 0, lean: 0.02, breatheAmp: 0.014, breatheHz: 0.4,
    meridian: 1.4, driftYaw: 0.05, driftHz: 0.25, scanYaw: 0, scanHz: 0,
    bounce: 0.3, pop: 0.16, blinkMs: [2800, 5000], glanceYaw: 0.2, glanceMs: [2600, 4600],
    gazeWeight: 1, shake: false, zzz: false, confetti: false,
    hop: { height: 26, period: 0.52, times: 4, decay: 0.55 }
  },
  '03': {
    id: '03', name: '倾听', group: 'life', tip: '你说，我听着～',
    /* 用户在输入框里打字（不是聚焦，是**框里有字**）时的姿态：
     * ① 视线落到下方——输入框在球的下面，pitch 负 = 眼位低（-0.3 比待机 -0.12 低一截）；
     * ② 微微歪头（lean 0.12，逆时针）——像凑过去听；
     * ③ 眼睛比待机睁大一点（15×33 vs 13×30）——"在认真听"；
     * ④ 不打盹、不跑形变轮播——用户在说话的时候球不该自己玩自己的。 */
    shape: 'normal', open: 1, w: 15, h: 33, tilt: 0, yaw: 0, pitch: -0.3,
    squash: 0, taper: 0, lean: 0.12, breatheAmp: 0.01, breatheHz: 0.42,
    meridian: 1.15, driftYaw: 0.02, driftHz: 0.18, scanYaw: 0, scanHz: 0,
    bounce: 0.05, pop: 0.05, blinkMs: [3200, 6000], glanceYaw: 0.12, glanceMs: [3000, 6000],
    gazeWeight: 0.5, shake: false, zzz: false, confetti: false,
    wander: { amp: 0.05, ampPitch: 0.02, periods: [9.7, 4.3] }
  },
  '10': {
    id: '10', name: '思考中', group: 'agent', tip: '让我想想~',
    /* 脸部照 bloub thinking 的实拍截图：左眼一根斜竖胶囊、右眼一条短横线（closed），
     * 两眼整体顺时针歪（tilt 14°，右眼线跟着微微下斜）、眼位偏高（pitch 0.25）——
     * "歪着头琢磨"的脸。
     * dots：进状态先缩成一颗小球，左右浮出两个点组成省略号"…"（中间是球自己，
     * 也就是三个点里最大最实的那颗），2.2s 后变回这张脸，约 9s 循环一次。 */
    shape: 'normal', open: 1, w: 17, h: 36, tilt: 14, yaw: 0, pitch: 0.25,
    eyeL: { shape: 'normal', w: 17, h: 36 },
    eyeR: { shape: 'closed', w: 26, h: 26 },
    squash: 0, taper: 0, lean: 0.05, breatheAmp: 0.008, breatheHz: 0.5,
    meridian: 1.4, driftYaw: 0.03, driftHz: 0.2, scanYaw: 0, scanHz: 0,
    bounce: 0, pop: 0.05, blinkMs: null, glanceYaw: 0, glanceMs: null,
    gazeWeight: 0.3, shake: false, zzz: false, confetti: false,
    dots: { dur: 2200, every: 9000, fade: 400 }
  },
  '11': {
    id: '11', name: '检索中', group: 'agent', tip: '翻翻知识库…',
    /* 低头翻资料：眼位压低（pitch -0.34，看向左下角那本打开的书，book: true 由引擎画），
     * scanYaw 0.42 / scanHz 0.32 让脑袋沿书页左右来回扫（约 3s 一个来回），
     * meridian 放慢（检索是"细看"，不是"晕头转向"）。右上角的小轨道点保留——
     * 对照 bloub reading 状态，那颗绕球的小点是"在找东西"的符号。 */
    shape: 'normal', open: 1, w: 16, h: 26, tilt: 0, yaw: 0, pitch: -0.34,
    squash: 0, taper: 0, lean: 0.08, breatheAmp: 0.006, breatheHz: 0.6,
    meridian: 1.6, driftYaw: 0, driftHz: 0, scanYaw: 0.3, scanHz: 0.32,
    bounce: 0, pop: 0.05, blinkMs: [3600, 6400], glanceYaw: 0, glanceMs: null,
    gazeWeight: 0.2, shake: false, zzz: false, confetti: false,
    book: true
  },
  '12': {
    id: '12', name: '回答中', group: 'agent', tip: '正在回答…',
    shape: 'normal', open: 1, w: 20, h: 26, tilt: 0, yaw: 0, pitch: -0.02,
    eyeL: { shape: 'normal', w: 21, h: 27 }, eyeR: { shape: 'normal', w: 19, h: 25 },
    squash: 0, taper: 0, lean: 0, breatheAmp: 0.01, breatheHz: 0.55,
    meridian: 1.2, driftYaw: 0.03, driftHz: 0.3, scanYaw: 0, scanHz: 0,
    bounce: 1, pop: 0.07, blinkMs: [2000, 4200], glanceYaw: 0.22, glanceMs: [2400, 4200],
    gazeWeight: 1, shake: false, zzz: false, confetti: false
  },
  '20': {
    id: '20', name: '完成', group: 'feedback', tip: '搞定！',
    shape: 'happy', open: 1, w: 22, h: 28, tilt: 0, yaw: 0, pitch: -0.05,
    squash: -0.03, taper: 0, lean: 0, breatheAmp: 0.012, breatheHz: 0.5,
    meridian: 1, driftYaw: 0, driftHz: 0, scanYaw: 0, scanHz: 0,
    bounce: 0.5, pop: 0.14, blinkMs: null, glanceYaw: 0, glanceMs: null,
    gazeWeight: 1, shake: false, zzz: false, confetti: true
  },
  '21': {
    id: '21', name: '出错', group: 'feedback', tip: '哎呀，出错了',
    shape: 'cross', open: 1, w: 20, h: 26, tilt: 0, yaw: 0, pitch: 0.02,
    squash: 0.04, taper: 0.1, lean: 0, breatheAmp: 0.006, breatheHz: 0.5,
    meridian: 0.5, driftYaw: 0, driftHz: 0, scanYaw: 0, scanHz: 0,
    bounce: 0, pop: 0.05, blinkMs: null, glanceYaw: 0, glanceMs: null,
    gazeWeight: 0, shake: true, zzz: false, confetti: false
  },
  '22': {
    id: '22', name: '惊讶', group: 'feedback', tip: '真的吗？！',
    shape: 'wide', open: 1, w: 24, h: 30, tilt: 0, yaw: 0, pitch: -0.06,
    eyeL: { shape: 'normal', w: 10, h: 12 }, eyeR: { shape: 'wide', w: 27, h: 33 },
    squash: -0.03, taper: 0, lean: 0, breatheAmp: 0.012, breatheHz: 0.45,
    meridian: 1.6, driftYaw: 0, driftHz: 0, scanYaw: 0, scanHz: 0,
    bounce: 0, pop: 0.16, blinkMs: [3000, 5200], glanceYaw: 0, glanceMs: null,
    gazeWeight: 1, shake: false, zzz: false, confetti: false
  }
};

/** 引擎要插值的数值字段（缺失按 0 兜底） */
export const NUM_KEYS = [
  'open', 'w', 'h', 'tilt', 'yaw', 'pitch',
  'squash', 'taper', 'lean', 'breatheAmp', 'breatheHz', 'meridian',
  'driftYaw', 'driftHz', 'scanYaw', 'scanHz', 'bounce', 'pop'
];

export const SHAPES = ['normal', 'wide', 'happy', 'closed', 'cross'];

export function normalize(state) {
  const out = Object.assign({}, state);
  for (const k of NUM_KEYS) if (typeof out[k] !== 'number') out[k] = 0;
  return out;
}
