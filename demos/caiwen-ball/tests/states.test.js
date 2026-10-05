import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, FALLBACK, NUM_KEYS, SHAPES, GROUPS, normalize, morphTimeline } from '../src/states.js';
import { MORPH_KINDS } from '../src/shape.js';

const ids = Object.keys(STATES);

test('回退表情必须存在', () => {
  assert.ok(STATES[FALLBACK], `FALLBACK=${FALLBACK} 在 STATES 中找不到`);
});

test('已退役的编号不许复活（21 出错 / 22 惊讶）', () => {
  /* 编号作废后不能再复用：调用方可能还留着旧 id，复用会出现"同一 id 两种脸" */
  for (const dead of ['21', '22']) {
    assert.ok(!(dead in STATES), `${dead} 已退役，不该再出现在 STATES 里`);
  }
});

test('id 与键一一对应', () => {
  for (const key of ids) {
    assert.equal(STATES[key].id, key, `${key} 的 id 字段应与键一致`);
  }
});

test('每个表情都补齐了全部插值字段', () => {
  for (const key of ids) {
    for (const k of NUM_KEYS) {
      assert.equal(typeof STATES[key][k], 'number', `${key} 缺少数值字段 ${k}`);
    }
  }
});

test('数值字段取有限值，不会有 NaN/Infinity', () => {
  for (const key of ids) {
    for (const k of NUM_KEYS) {
      assert.ok(Number.isFinite(STATES[key][k]), `${key}.${k} 不是有限数`);
    }
  }
});

test('眼形与分组都落在已知集合内', () => {
  const groupKeys = GROUPS.map((g) => g.key);
  for (const key of ids) {
    assert.ok(SHAPES.includes(STATES[key].shape), `${key}.shape 非法：${STATES[key].shape}`);
    assert.ok(groupKeys.includes(STATES[key].group), `${key}.group 非法：${STATES[key].group}`);
  }
});

test('开合度在 0~1，尺寸为正', () => {
  for (const key of ids) {
    const s = STATES[key];
    assert.ok(s.open >= 0 && s.open <= 1, `${key}.open=${s.open} 越界`);
    assert.ok(s.w > 0 && s.h > 0, `${key} 的眼睛尺寸必须为正`);
  }
});

test('normalize 给缺失字段兜底为 0，且不改原对象', () => {
  const raw = { id: '99', shape: 'normal' };
  const out = normalize(raw);
  for (const k of NUM_KEYS) assert.equal(out[k], 0);
  assert.equal(raw.open, undefined, 'normalize 不应污染入参');
});

test('emotionId 分段符合对外契约', () => {
  const range = (lo, hi) => ids.filter((id) => +id >= lo && +id <= hi).map((id) => STATES[id].group);
  const life = range(0, 9);
  const agent = range(10, 19);
  const feedback = range(20, 29);
  assert.ok(life.length > 0 && life.every((g) => g === 'life'), '00-09 必须全是生命周期');
  assert.ok(agent.length > 0 && agent.every((g) => g === 'agent'), '10-19 必须全是代理工作状态');
  assert.ok(feedback.length > 0 && feedback.every((g) => g === 'feedback'), '20-29 必须全是结果反馈');
});

test('每个表情都带中文提示文案', () => {
  /* 13（书写）是钢笔过门动作：球缩没、原地写一行字，刻意不配提示文案——
   * 用户要求"书写下面不要字"，所以 tip 留空、typeline 连光标都不显示。 */
  const textless = new Set(['13']);
  for (const key of ids) {
    if (!textless.has(key)) {
      assert.ok(typeof STATES[key].tip === 'string' && STATES[key].tip.length > 0, `${key} 缺 tip`);
    }
    assert.ok(typeof STATES[key].name === 'string' && STATES[key].name.length > 0, `${key} 缺 name`);
  }
});

test('单眼覆盖 eyeL/eyeR 必须合法且尺寸为正', () => {
  for (const key of ids) {
    for (const side of ['eyeL', 'eyeR']) {
      const e = STATES[key][side];
      if (!e) continue;
      assert.ok(SHAPES.includes(e.shape), `${key}.${side}.shape 非法：${e.shape}`);
      assert.ok(e.w > 0 && e.h > 0, `${key}.${side} 尺寸必须为正`);
      if (e.dy != null) {
        assert.ok(Number.isFinite(e.dy) && Math.abs(e.dy) <= 30, `${key}.${side}.dy 非法：${e.dy}`);
      }
    }
  }
});

/* 逐表情打磨流程：每个表情定稿后锁一条数值测试。
 * 若后续有意调整 01 的眼睛尺寸，请连这条断言一起改——它就是用来提醒你"这里是定的"。
 * 比例来源：bloub 实拍截图，眼宽≈球径 8.4%、眼高≈19%。 */
test('待机（01）定稿值：细长竖胶囊 13×30，略上视，左右对称（无单眼覆盖）', () => {
  const s = STATES['01'];
  assert.equal(s.shape, 'normal', '01 的眼形应为 normal（竖胶囊）');
  assert.equal(s.w, 13, '01 眼宽被改动，确认是有意的');
  assert.equal(s.h, 30, '01 眼高被改动，确认是有意的');
  assert.equal(s.pitch, -0.12, '01 基础俯仰被改动，确认是有意的');
  assert.equal(s.eyeL, undefined, '01 左右眼相同，不应留单眼覆盖');
  assert.equal(s.eyeR, undefined, '01 左右眼相同，不应留单眼覆盖');
});

test('wander 游移周期必须互不成整数比（否则会被看出循环）', () => {
  for (const key of ids) {
    const w = STATES[key].wander;
    if (!w) continue;
    assert.ok(Array.isArray(w.periods) && w.periods.length >= 2, `${key}.wander.periods 至少两个周期`);
    assert.ok(w.amp > 0 && w.ampPitch > 0, `${key}.wander 幅度必须为正`);
    for (let i = 0; i < w.periods.length; i++) {
      for (let j = i + 1; j < w.periods.length; j++) {
        const a = w.periods[i], b = w.periods[j];
        const ratio = Math.max(a, b) / Math.min(a, b);
        assert.ok(Math.abs(ratio - Math.round(ratio)) > 0.05,
          `${key}.wander.periods 中 ${a} 与 ${b} 成整数比（${ratio.toFixed(2)}），会看出重复`);
      }
    }
  }
});

test('morph 轮播配置必须合法（seq 落在已知形状、时长为正数）', () => {
  for (const key of ids) {
    const m = STATES[key].morph;
    if (!m) continue;
    assert.ok(Number.isFinite(m.every) && m.every >= 0, `${key}.morph.every 非法`);
    assert.ok(Number.isFinite(m.hold) && m.hold >= 0, `${key}.morph.hold 非法`);
    assert.ok(Number.isFinite(m.morphMs) && m.morphMs > 0, `${key}.morph.morphMs 非法`);
    assert.ok(Array.isArray(m.seq) && m.seq.length > 0, `${key}.morph.seq 不能为空`);
    for (const kind of m.seq) {
      assert.ok(MORPH_KINDS.includes(kind), `${key}.morph.seq 含未知形状 ${kind}`);
    }
  }
});

test('nap 打盹窗必须落在形变轮播之后，且 sleep 指向已存在的表情', () => {
  for (const key of ids) {
    const m = STATES[key].morph;
    if (!m || !m.nap) continue;
    const nap = m.nap;
    assert.ok(Number.isFinite(nap.at) && nap.at >= 0, `${key}.morph.nap.at 非法`);
    assert.ok(Number.isFinite(nap.duration) && nap.duration > 0, `${key}.morph.nap.duration 必须为正`);
    assert.ok(STATES[nap.sleep], `${key}.morph.nap.sleep=${nap.sleep} 在 STATES 中找不到`);
    const tl = morphTimeline(m);
    assert.ok(tl.napStart >= tl.every + tl.show,
      `${key} 打盹起点 ${tl.napStart} 早于形变结束 ${tl.every + tl.show}——顺序必须是先变形再睡`);
    assert.ok(tl.total >= tl.napEnd, `${key} 周期 ${tl.total} 没有覆盖打盹窗末端 ${tl.napEnd}`);
  }
});

test('morphTimeline：01 的时间轴顺序 = 静止 5s → 变形 4.8s → 缓冲 0.8s → 打盹 2s', () => {
  const tl = morphTimeline(STATES['01'].morph);
  assert.equal(tl.every, 5000);
  assert.equal(tl.show, 3 * (450 + 1000) + 450, '三段各停 1s + 收尾 0.45s');
  assert.equal(tl.napStart, 5000 + 4800 + 800, '打盹必须在变形结束之后');
  assert.equal(tl.napEnd - tl.napStart, 2000, '打盹窗 2 秒');
  assert.equal(tl.total, tl.napEnd, '周期应以打盹窗末端收尾，然后回到待机');
});

test('待机（01）打盹定稿值：变形结束后 800ms 起睡 2 秒', () => {
  const nap = STATES['01'].morph.nap;
  assert.equal(nap.at, 800, '01 打盹起始被改动，确认是有意的');
  assert.equal(nap.duration, 2000, '01 打盹时长被改动，确认是有意的');
  assert.equal(nap.sleep, '00', '01 打盹应插值到睡眠（00）');
});

test('睡眠（00）：closed 眼形 + 低眼位 + 小 open（睡醒时眼睛从线鼓开）', () => {
  const s = STATES['00'];
  assert.equal(s.shape, 'closed', '睡眠应画闭眼线');
  assert.ok(s.open > 0 && s.open <= 0.2,
    `open=${s.open}：苏醒动画靠 normal 眼形从压扁状态鼓起来，open 必须留小值而非 1`);
  assert.ok(s.pitch < 0, 'pitch 应为负 = 眼位在球中线下方（projectEye: y = cy − R·sin(pitch)）');
  assert.ok(s.w > STATES['01'].w, '闭眼线应比待机的眼睛宽，才看得出是一条线');
  assert.equal(s.zzz, true, '睡眠必须冒 Z');
  assert.ok(s.eyeR && s.eyeR.dy < 0, '右眼应比左眼高（dy 负 = 向上），照参考图的睡姿');
});

test('待机（01）是当前唯一配 morph 的表情', () => {
  const withMorph = ids.filter((k) => STATES[k].morph);
  assert.deepEqual(withMorph, ['01'], 'morph 轮播只该出现在长时停留的表情上');
});

test('倾听（03）：视线落到下方、眼睛比待机睁大、微微歪头、不跑形变轮播', () => {
  const s = STATES['03'];
  const idle = STATES['01'];
  assert.ok(!s.morph, '用户在打字时球不该自己跑去玩形变轮播——那等于没在听');
  assert.ok(s.pitch < idle.pitch,
    `眼位应比待机更低（看向下面的输入框）：03 ${s.pitch} vs 01 ${idle.pitch}`);
  assert.ok(s.w > idle.w && s.h > idle.h, '眼睛应比待机睁大一点，才像"在认真听"');
  assert.ok(s.lean > 0, '应微微歪头（lean > 0 是逆时针）');
  assert.ok(s.blinkMs, '倾听时仍要偶尔眨眼，不然像定住了');
  assert.ok(!s.zzz, '倾听时不冒 Z');
});

test('思考（10）：省略号只播一次 + 思考链接翻书 + 歪头大小眼（左竖胶囊右横线）', () => {
  const s = STATES['10'];
  assert.equal(s.tip, '让我想想~');
  /* 省略号是"我要开始想了"的起手式，**只播一次**：every 为 0（或缺失）。
   * 早期版本 every=9000 循环，观感是"想一下、回个神、再想一下"。 */
  assert.ok(s.dots && s.dots.dur > 0, '思考开场应有省略号（dots）');
  assert.ok(!s.dots.every, `dots 不该循环（every 应为 0/缺省，现 ${s.dots.every}）`);
  /* dots 播完还要再琢磨一会儿，模型没输出才交给翻书 */
  assert.ok(s.chain && s.chain.to === '11' && s.chain.hold > 0,
    '思考应挂一条链：还没输出就自动接翻知识库（11）');
  assert.equal(s.eyeR && s.eyeR.shape, 'closed', '右眼应是一条闭眼横线（照 bloub thinking 脸）');
  assert.ok(s.eyeL && s.eyeL.h > s.eyeL.w * 1.6, '左眼应是竖长胶囊');
  assert.ok(s.tilt > 8, '两眼应整体歪着（tilt > 8）');
});

test('检索（11）：低头看书 + 左右扫视 + 带道具书', () => {
  const s = STATES['11'];
  assert.equal(s.book, true, '检索应带道具书');
  assert.ok(s.pitch < -0.2, `眼位应压低看向书（pitch=${s.pitch}）`);
  assert.ok(s.scanYaw > 0.2 && s.scanHz > 0, '应沿书页左右来回扫视');
});

