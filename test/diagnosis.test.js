'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseFaultTree } = require('../src/diagnosis');

const EPS = 1e-12;

/** 取某故障的后验概率 */
function posteriorOf(result, name) {
  const item = result.posteriors.find((p) => p.name === name);
  assert.ok(item, `posteriors 中应包含「${name}」`);
  return item.probability;
}

test('OR 门无证据：P(A|TOP) = P(A) / P(A∪B)', () => {
  // TOP = OR(A, B)，p = 0.5/0.5 → P(TOP)=0.75，P(A|TOP)=0.5/0.75=2/3
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5 },
    evidence: {},
  });
  assert.ok(Math.abs(r.evidenceProbability - 0.75) < EPS);
  assert.ok(Math.abs(posteriorOf(r, 'A') - 2 / 3) < EPS);
  assert.ok(Math.abs(posteriorOf(r, 'B') - 2 / 3) < EPS);
  assert.equal(r.statesEnumerated, 4);
});

test('AND 门无证据：顶层发生则两个故障必然都发生', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'AND', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.3, B: 0.4 },
    evidence: {},
  });
  assert.ok(Math.abs(r.evidenceProbability - 0.12) < EPS);
  assert.equal(posteriorOf(r, 'A'), 1);
  assert.equal(posteriorOf(r, 'B'), 1);
});

test('现场标记过滤状态组合：B 已确认未发生时顶层只能由 A 引起', () => {
  // TOP = OR(A, B)，evidence: B absent → 仅保留 (A=1,B=0)，联合概率 0.25，P(A|TOP)=1
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5 },
    evidence: { B: 'absent' },
  });
  assert.ok(Math.abs(r.evidenceProbability - 0.25) < EPS);
  assert.equal(r.posteriors.length, 1);
  assert.equal(posteriorOf(r, 'A'), 1);
});

test('已确认发生的故障不出现在后验列表中', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5 },
    evidence: { A: 'occurred' },
  });
  assert.deepEqual(r.posteriors.map((p) => p.name), ['B']);
  // P(B|TOP, A=1) = P(B) = 0.5（A 确定发生后 B 与顶层独立）
  assert.ok(Math.abs(posteriorOf(r, 'B') - 0.5) < EPS);
});

test('共享引用不能当作独立事件相乘', () => {
  // G1 = OR(A, B)，G2 = OR(A, C)，TOP = AND(G1, G2)，p 均为 0.5
  // 错误（独立相乘）：P(TOP) = 0.75 × 0.75 = 0.5625
  // 正确（枚举）：A=1（0.5）+ A=0,B=1,C=1（0.125）= 0.625
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B', 'C'],
    gates: [
      { id: 'G1', type: 'OR', inputs: ['A', 'B'] },
      { id: 'G2', type: 'OR', inputs: ['A', 'C'] },
      { id: 'TOP', type: 'AND', inputs: ['G1', 'G2'] },
    ],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5, C: 0.5 },
    evidence: {},
  });
  assert.ok(Math.abs(r.evidenceProbability - 0.625) < EPS);
  // P(A|TOP) = 0.5/0.625 = 0.8；P(B|TOP) = P(C|TOP) = 0.375/0.625 = 0.6
  assert.ok(Math.abs(posteriorOf(r, 'A') - 0.8) < EPS);
  assert.ok(Math.abs(posteriorOf(r, 'B') - 0.6) < EPS);
  assert.ok(Math.abs(posteriorOf(r, 'C') - 0.6) < EPS);
});

test('后验概率按降序排列', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B', 'C'],
    gates: [
      { id: 'G1', type: 'OR', inputs: ['A', 'B'] },
      { id: 'G2', type: 'OR', inputs: ['A', 'C'] },
      { id: 'TOP', type: 'AND', inputs: ['G1', 'G2'] },
    ],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5, C: 0.5 },
    evidence: {},
  });
  const probs = r.posteriors.map((p) => p.probability);
  assert.deepEqual(probs, [...probs].sort((x, y) => y - x));
  assert.equal(r.posteriors[0].name, 'A');
});

test('顶层为基础故障：其余故障后验等于各自先验（相互独立）', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [],
    topEvent: 'A',
    priors: { A: 0.3, B: 0.4 },
    evidence: {},
  });
  assert.ok(Math.abs(r.evidenceProbability - 0.3) < EPS);
  assert.ok(Math.abs(posteriorOf(r, 'B') - 0.4) < EPS);
});

test('全部基础故障均已确认：后验列表为空', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5 },
    evidence: { A: 'occurred', B: 'absent' },
  });
  assert.deepEqual(r.posteriors, []);
  assert.ok(Math.abs(r.evidenceProbability - 0.25) < EPS);
});

test('证据概率为零：标记与模型矛盾（AND 门输入被确认未发生）', () => {
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A', 'B'],
      gates: [{ id: 'TOP', type: 'AND', inputs: ['A', 'B'] }],
      topEvent: 'TOP',
      priors: { A: 0.5, B: 0.5 },
      evidence: { A: 'absent' },
    }),
    (err) => err.contradiction === true && /矛盾/.test(err.message)
  );
});

test('证据概率为零：先验为 0 的故障被标记已确认发生', () => {
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: { A: 0 },
      evidence: { A: 'occurred' },
    }),
    (err) => err.contradiction === true
  );
});

test('校验：先验缺失 / 越界 / 多余名称', () => {
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: {},
      evidence: {},
    }),
    /缺少有效的先验概率/
  );
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: { A: 1.5 },
      evidence: {},
    }),
    /超出 0～1/
  );
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: { A: 0.5, 幽灵: 0.1 },
      evidence: {},
    }),
    /未定义的基础故障/
  );
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      evidence: {},
    }),
    /缺少先验概率表/
  );
});

test('校验：现场标记指向未知故障或取值非法', () => {
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: { A: 0.5 },
      evidence: { 幽灵: 'occurred' },
    }),
    /未定义的基础故障/
  );
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: { A: 0.5 },
      evidence: { A: '也许吧' },
    }),
    /现场标记无效/
  );
});

test('复用故障树结构校验：成环 / 引用不存在同样报错', () => {
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [
        { id: 'G1', type: 'OR', inputs: ['A', 'G2'] },
        { id: 'G2', type: 'AND', inputs: ['A', 'G1'] },
      ],
      topEvent: 'G1',
      priors: { A: 0.5 },
      evidence: {},
    }),
    (err) => Array.isArray(err.validationErrors) && /循环引用/.test(err.message)
  );
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [{ id: 'G', type: 'AND', inputs: ['A', '幽灵'] }],
      topEvent: 'G',
      priors: { A: 0.5 },
      evidence: {},
    }),
    /不存在/
  );
});

test('evidence 可缺省；unknown 标记等同不传', () => {
  const input = {
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5 },
  };
  const noEvidence = diagnoseFaultTree(input);
  const unknownMark = diagnoseFaultTree({ ...input, evidence: { A: 'unknown' } });
  assert.deepEqual(noEvidence.posteriors, unknownMark.posteriors);
  assert.ok(Math.abs(noEvidence.evidenceProbability - 0.75) < EPS);
});
