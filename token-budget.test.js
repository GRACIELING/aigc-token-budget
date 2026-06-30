/**
 * token-budget 计费逻辑单元测试
 *
 * 目的：验证「每月免费次数」输入任意大小（含 >200）时，月计费次数与成本的计算
 *       数学正确——当免费额度覆盖全部生成量时计费为 0 是模型的正确结果，并非 BUG。
 *
 * 运行：node token-budget.test.js
 *
 * 说明：calcRank 逻辑内嵌在 token-budget.html 中（单一事实来源）。本测试直接从
 *       HTML 源码里抽取 calcRank 函数体后执行，避免维护两份逻辑导致漂移。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---- 从 token-budget.html 中提取 calcRank 函数 ----
const html = fs.readFileSync(path.join(__dirname, 'token-budget.html'), 'utf8');
const m = html.match(/function calcRank\([\s\S]*?\n\s{2}\}/);
if (!m) {
  console.error('未能在 token-budget.html 中找到 calcRank 函数定义');
  process.exit(1);
}
// eslint-disable-next-line no-eval
const calcRank = eval('(' + m[0].replace(/^function calcRank/, 'function') + ')');

// ---- 测试运行器 ----
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    console.error('  \u2717 ' + name + '\n      ' + e.message);
  }
}
function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

console.log('运行 token-budget 计费逻辑测试...\n');

// ========== 用户反馈的核心场景：free 输入 200 ==========
test('free=200 且 gpd×天数 < free 时：计费为 0（免费完全覆盖，正确结果而非异常）', () => {
  // 1000 人，人均 3 次/天，30 天 → 月生成 90 次；免费 200 次 > 90 → 全覆盖
  const r = calcRank(1000, 3, 200, 30, 0.0005);
  assert.strictEqual(r.genMonth, 1000 * 3 * 30, '月生成次数应为 90000');
  assert.strictEqual(r.billable, 0, 'free 覆盖全部生成时计费应为 0');
  assert.strictEqual(r.cost, 0, '计费为 0 时成本应为 0');
  assert.strictEqual(r.fullyCovered, true, '应标记为免费完全覆盖');
});

test('free=200 但 gpd×天数 > 200 时：仍正常产生计费（不会异常归零）', () => {
  // 人均 12 次/天，30 天 → 月生成 360 次 > 免费 200 次 → 计费 160 次
  const users = 58, gpd = 12, free = 200, days = 30, cpg = 0.001;
  const r = calcRank(users, gpd, free, days, cpg);
  const expectBillable = users * gpd * days - users * free; // 58*360 - 58*200 = 58*160
  assert.strictEqual(r.billable, expectBillable, '计费次数应为 (生成-免费)');
  assert.ok(approx(r.cost, expectBillable * cpg), '成本应为计费次数×单次成本');
  assert.strictEqual(r.fullyCovered, false, '有计费时不应标记为完全覆盖');
});

test('free 远超 200（如 9999）：计费稳定为 0，不出现 NaN/负数', () => {
  const r = calcRank(500, 5, 9999, 31, 0.0008);
  assert.strictEqual(r.billable, 0, '超大免费额度计费应为 0');
  assert.strictEqual(r.cost, 0, '成本应为 0');
  assert.ok(isFinite(r.billable) && isFinite(r.cost), '结果应为有限数');
  assert.ok(r.billable >= 0, '计费次数不应为负');
});

// ========== 边界场景 ==========
test('边界：gpd×天数 恰好等于 free → 计费恰好为 0', () => {
  // gpd=10, days=20 → 人均 200；free=200 → 恰好覆盖
  const r = calcRank(100, 10, 200, 20, 0.001);
  assert.strictEqual(r.billable, 0, '恰好覆盖时计费为 0');
  assert.strictEqual(r.fullyCovered, true, '应标记完全覆盖');
});

test('边界：free 比生成少 1（人均）→ 产生少量计费', () => {
  // gpd=10, days=20 → 人均 200；free=199 → 人均计费 1 次
  const r = calcRank(100, 10, 199, 20, 0.001);
  assert.strictEqual(r.billable, 100 * 1, '应产生 100 次计费');
  assert.strictEqual(r.fullyCovered, false, '不应标记完全覆盖');
});

// ========== 零值 / 异常输入兜底 ==========
test('free=0：全部生成都计费', () => {
  const r = calcRank(200, 4, 0, 30, 0.0005);
  assert.strictEqual(r.billable, 200 * 4 * 30, 'free=0 时计费=全部生成');
});

test('gpd=0：无生成，无计费', () => {
  const r = calcRank(200, 0, 50, 30, 0.0005);
  assert.strictEqual(r.genMonth, 0, '无生成');
  assert.strictEqual(r.billable, 0, '无计费');
  assert.strictEqual(r.fullyCovered, false, 'genMonth=0 不算"被覆盖"');
});

test('空串/非数字输入：兜底为 0，不报错', () => {
  const r = calcRank('', 'abc', null, undefined, NaN);
  assert.strictEqual(r.genMonth, 0);
  assert.strictEqual(r.billable, 0);
  assert.strictEqual(r.cost, 0);
  assert.ok(isFinite(r.cost), '不应出现 NaN');
});

test('小数输入：按输入值计算，不强制取整', () => {
  // gpd=2.5, days=30 → 人均 75；free=50 → 人均计费 25
  const r = calcRank(10, 2.5, 50, 30, 0.002);
  assert.strictEqual(r.billable, 10 * 25, '应支持小数 gpd 计算');
  assert.ok(approx(r.cost, 250 * 0.002), '成本应正确');
});

// ========== 合计聚合一致性 ==========
test('多段位聚合：含 free>200 段位时合计计费/成本正确', () => {
  const rows = [
    { users: 1000, gpd: 3,  free: 200 }, // 月生成 90000，免费 200000 → 计费 0
    { users: 58,   gpd: 12, free: 200 }, // 月生成 626400... 实为 58*12*30=20880，免费 58*200=11600 → 计费 9280
  ];
  const days = 30, cpg = 0.001;
  let totalBillable = 0, totalCost = 0;
  rows.forEach(r => {
    const c = calcRank(r.users, r.gpd, r.free, days, cpg);
    totalBillable += c.billable;
    totalCost += c.cost;
  });
  const expectBillable = 0 + (58 * 12 * 30 - 58 * 200);
  assert.strictEqual(totalBillable, expectBillable, '合计计费次数应正确');
  assert.ok(approx(totalCost, expectBillable * cpg), '合计成本应正确');
  assert.ok(totalBillable > 0, '存在高 gpd 段位时合计计费应 > 0');
});

// ---- 结果汇总 ----
console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项。');
if (failed > 0) process.exit(1);
console.log('\u2705 所有计费逻辑测试通过：free 输入任意大小（含 >200）计算均正确。');
