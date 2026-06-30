/**
 * token-budget 计费逻辑单元测试
 *
 * 业务模型（清晰、无歧义）：
 *   1. 免费发放次数 freeGrant = 人数 × 每月免费次数（官方一定发放，必然占用成本）
 *   2. 真实使用次数 usedMonth = 人数 × 人均次/天 × 天数
 *   3. 免费成本 freeCost = 免费发放次数 × 单次成本（一定产生的预估预算）
 *   4. 付费次数 paidQty = max(0, 真实使用 − 免费发放)
 *   5. 付费成本 paidCost = 付费次数 × 单次成本
 *   6. 总成本 totalCost = 免费成本 + 付费成本
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

// ========== 模型四要素：免费发放 / 真实使用 / 付费 / 成本 ==========
test('基本：免费发放次数 = 人数 × 每月免费次数', () => {
  const r = calcRank(1000, 3, 50, 30, 0.001);
  assert.strictEqual(r.freeGrant, 1000 * 50, '免费发放次数应为 50000');
});

test('基本：真实使用次数 = 人数 × 人均次/天 × 天数', () => {
  const r = calcRank(1000, 3, 50, 30, 0.001);
  assert.strictEqual(r.usedMonth, 1000 * 3 * 30, '真实使用次数应为 90000');
});

test('基本：付费次数 = 真实使用 − 免费发放', () => {
  // 真实使用 90000，免费发放 50000 → 付费 40000
  const r = calcRank(1000, 3, 50, 30, 0.001);
  assert.strictEqual(r.paidQty, 90000 - 50000, '付费次数应为 40000');
});

test('基本：免费发放也算成本（官方买单），总成本 = 免费成本 + 付费成本', () => {
  const cpg = 0.001;
  const r = calcRank(1000, 3, 50, 30, cpg);
  assert.ok(approx(r.freeCost, 50000 * cpg), '免费成本 = 免费发放 × 单次成本');
  assert.ok(approx(r.paidCost, 40000 * cpg), '付费成本 = 付费次数 × 单次成本');
  assert.ok(approx(r.totalCost, (50000 + 40000) * cpg), '总成本 = 免费成本 + 付费成本');
});

// ========== 用户关注的场景：免费次数较大（>200）==========
test('免费次数=200 且 真实使用 < 免费发放：付费=0，但免费成本仍存在（不会归零）', () => {
  // 真实使用 1000×3×30=90000；免费发放 1000×200=200000 > 使用 → 付费 0
  const cpg = 0.001;
  const r = calcRank(1000, 3, 200, 30, cpg);
  assert.strictEqual(r.usedMonth, 90000, '真实使用 90000');
  assert.strictEqual(r.freeGrant, 200000, '免费发放 200000');
  assert.strictEqual(r.paidQty, 0, '使用未超免费额度，付费为 0');
  assert.ok(approx(r.freeCost, 200000 * cpg), '免费成本仍按免费发放计（必然占用）');
  assert.ok(approx(r.totalCost, 200000 * cpg), '总成本 = 免费成本（付费为 0 时）');
  assert.ok(r.totalCost > 0, '免费发放产生成本，总成本不应为 0');
});

test('免费次数=200 且 真实使用 > 免费发放：付费正常产生', () => {
  // 人均 12 次/天，30 天 → 真实使用 360/人；免费 200/人 → 付费 160/人
  const users = 58, cpg = 0.001;
  const r = calcRank(users, 12, 200, 30, cpg);
  assert.strictEqual(r.usedMonth, users * 360, '真实使用');
  assert.strictEqual(r.freeGrant, users * 200, '免费发放');
  assert.strictEqual(r.paidQty, users * 160, '付费次数 = 使用 − 免费');
  assert.ok(approx(r.totalCost, (users * 200 + users * 160) * cpg), '总成本含免费与付费两部分');
});

test('免费次数极大（9999）：付费为 0，免费成本巨大但稳定，无 NaN/负数', () => {
  const r = calcRank(500, 5, 9999, 31, 0.0008);
  assert.strictEqual(r.paidQty, 0, '使用远小于免费 → 付费 0');
  assert.ok(r.freeCost > 0, '免费成本应为正');
  assert.ok(isFinite(r.totalCost) && r.totalCost >= 0, '总成本应为有限非负数');
});

// ========== 边界场景 ==========
test('边界：真实使用 恰好等于 免费发放 → 付费为 0，成本=免费成本', () => {
  // gpd=10, days=20 → 人均使用 200；free=200 → 恰好相等
  const cpg = 0.001;
  const r = calcRank(100, 10, 200, 20, cpg);
  assert.strictEqual(r.paidQty, 0, '恰好相等时付费为 0');
  assert.ok(approx(r.totalCost, 100 * 200 * cpg), '总成本=免费成本');
});

test('边界：真实使用 比 免费发放 多一点 → 产生少量付费', () => {
  // gpd=10, days=20 → 人均 200；free=199 → 人均付费 1
  const r = calcRank(100, 10, 199, 20, 0.001);
  assert.strictEqual(r.paidQty, 100 * 1, '应产生 100 次付费');
});

// ========== 零值 / 异常输入兜底 ==========
test('free=0：无免费发放，全部使用都付费，总成本=付费成本', () => {
  const cpg = 0.0005;
  const r = calcRank(200, 4, 0, 30, cpg);
  assert.strictEqual(r.freeGrant, 0, '无免费发放');
  assert.strictEqual(r.paidQty, 200 * 4 * 30, '全部使用都付费');
  assert.ok(approx(r.totalCost, 200 * 4 * 30 * cpg), '总成本=付费成本');
});

test('gpd=0：无真实使用，但免费发放仍产生成本', () => {
  const cpg = 0.001;
  const r = calcRank(200, 0, 50, 30, cpg);
  assert.strictEqual(r.usedMonth, 0, '无使用');
  assert.strictEqual(r.paidQty, 0, '无付费');
  assert.ok(approx(r.freeCost, 200 * 50 * cpg), '免费发放仍产生成本');
  assert.ok(approx(r.totalCost, 200 * 50 * cpg), '总成本=免费成本');
});

test('空串/非数字输入：兜底为 0，不报错', () => {
  const r = calcRank('', 'abc', null, undefined, NaN);
  assert.strictEqual(r.freeGrant, 0);
  assert.strictEqual(r.usedMonth, 0);
  assert.strictEqual(r.paidQty, 0);
  assert.strictEqual(r.totalCost, 0);
  assert.ok(isFinite(r.totalCost), '不应出现 NaN');
});

test('小数输入：按输入值计算，不强制取整', () => {
  // gpd=2.5, days=30 → 人均使用 75；free=50 → 人均付费 25
  const cpg = 0.002;
  const r = calcRank(10, 2.5, 50, 30, cpg);
  assert.strictEqual(r.paidQty, 10 * 25, '应支持小数 gpd 计算付费');
  assert.ok(approx(r.totalCost, (10 * 50 + 10 * 25) * cpg), '总成本正确');
});

// ========== 合计聚合一致性 ==========
test('多段位聚合：免费/使用/付费/总成本分别累加正确', () => {
  const rows = [
    { users: 1000, gpd: 3,  free: 200 }, // 使用 90000，免费 200000，付费 0
    { users: 58,   gpd: 12, free: 200 }, // 使用 20880，免费 11600，付费 9280
  ];
  const days = 30, cpg = 0.001;
  let tFree = 0, tUsed = 0, tPaid = 0, tCost = 0;
  rows.forEach(r => {
    const c = calcRank(r.users, r.gpd, r.free, days, cpg);
    tFree += c.freeGrant; tUsed += c.usedMonth; tPaid += c.paidQty; tCost += c.totalCost;
  });
  assert.strictEqual(tFree, 1000 * 200 + 58 * 200, '合计免费发放');
  assert.strictEqual(tUsed, 1000 * 90 + 58 * 360, '合计真实使用');
  assert.strictEqual(tPaid, 0 + (58 * 360 - 58 * 200), '合计付费次数');
  assert.ok(approx(tCost, (tFree + tPaid) * cpg), '合计总成本 = (免费发放+付费)×单次成本');
});

// ---- 结果汇总 ----
console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项。');
if (failed > 0) process.exit(1);
console.log('\u2705 所有计费逻辑测试通过：免费发放/真实使用/付费/成本四要素计算均正确。');
