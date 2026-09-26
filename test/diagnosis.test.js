'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseFaultTree } = require('../src/diagnosis');

const TOL = 1e-12;
function close(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) < TOL,
    `期望 ${expected}，实际 ${actual}`
  );
}

/** 共享分支树：G1=OR(A,B)，G2=OR(A,C)，TOP=AND(G1,G2)，先验均为 0.5 */
function sharedTree(evidence) {
  return {
    basicFaults: ['A', 'B', 'C'],
    gates: [
      { id: 'G1', type: 'OR', inputs: ['A', 'B'] },
      { id: 'G2', type: 'OR', inputs: ['A', 'C'] },
      { id: 'TOP', type: 'AND', inputs: ['G1', 'G2'] },
    ],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5, C: 0.5 },
    evidence: evidence || {},
  };
}

test('OR 门：后验概率按条件概率归一化并降序排列', () => {
  // TOP = OR(A, B)，pA=0.2，pB=0.3
  // P(TOP) = 1 - 0.8*0.7 = 0.44
  // P(A|TOP) = 0.2/0.44，P(B|TOP) = 0.3/0.44
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.2, B: 0.3 },
    evidence: {},
  });
  assert.equal(r.stateCount, 4);
  assert.equal(r.topStateCount, 3);
  close(r.evidenceProbability, 1);
  close(r.topProbability, 0.44);
  assert.equal(r.results.length, 2);
  // 降序：B 在前
  assert.equal(r.results[0].name, 'B');
  close(r.results[0].posterior, 0.3 / 0.44);
  assert.equal(r.results[1].name, 'A');
  close(r.results[1].posterior, 0.2 / 0.44);
});

test('AND 门：顶层发生时两个输入后验均为 1', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'AND', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.5, B: 0.5 },
    evidence: {},
  });
  close(r.topProbability, 0.25);
  assert.equal(r.results.length, 2);
  r.results.forEach((item) => close(item.posterior, 1));
});

test('共享分支不当作独立事件相乘（精确枚举）', () => {
  // TOP = AND(OR(A,B), OR(A,C))：A 被两个 OR 共享
  // 精确：P(TOP) = P(A) + P(¬A)P(B)P(C) = 0.5 + 0.125 = 0.625
  // 错误做法（独立相乘）：P(G1)*P(G2) = 0.75*0.75 = 0.5625
  const r = diagnoseFaultTree(sharedTree());
  assert.equal(r.stateCount, 8);
  assert.equal(r.topStateCount, 5);
  close(r.topProbability, 0.625);
  const byName = Object.fromEntries(r.results.map((x) => [x.name, x.posterior]));
  close(byName.A, 0.8);  // 0.5 / 0.625
  close(byName.B, 0.6);  // 0.375 / 0.625
  close(byName.C, 0.6);
});

test('现场标记：已确认的故障不参与后验，其余按标记条件归一化', () => {
  // 共享分支树 + B 已确认发生
  // P(标记) = P(B) = 0.5；P(TOP∧标记) = P(B)·P(A∨C) = 0.5*0.75 = 0.375
  // P(A|TOP,标记) = P(A)/P(A∨C) = 0.5/0.75 = 2/3，C 同理
  const r = diagnoseFaultTree(sharedTree({ B: 'occurred' }));
  assert.equal(r.stateCount, 4);
  assert.equal(r.topStateCount, 3);
  close(r.evidenceProbability, 0.5);
  close(r.topProbability, 0.375);
  assert.deepEqual(
    r.confirmed.map((c) => [c.name, c.status]),
    [['B', 'occurred']]
  );
  assert.equal(r.results.length, 2);
  const byName = Object.fromEntries(r.results.map((x) => [x.name, x.posterior]));
  close(byName.A, 2 / 3);
  close(byName.C, 2 / 3);
  assert.equal(byName.B, undefined);
});

test('全部基础故障已确认：后验列表为空', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 0.2, B: 0.3 },
    evidence: { A: 'occurred', B: 'absent' },
  });
  assert.equal(r.results.length, 0);
  assert.equal(r.confirmed.length, 2);
  close(r.evidenceProbability, 0.2 * 0.7);
  close(r.topProbability, 0.2 * 0.7); // A 发生 ⇒ 顶层必发生
});

test('顶层故障本身是基础故障：其后验为 1，无关故障保持先验', () => {
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [],
    topEvent: 'A',
    priors: { A: 0.5, B: 0.5 },
    evidence: {},
  });
  const byName = Object.fromEntries(r.results.map((x) => [x.name, x.posterior]));
  close(byName.A, 1);
  close(byName.B, 0.5);
});

test('矛盾：已确认发生的故障先验为 0，证据概率为 0', () => {
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A'],
      gates: [],
      topEvent: 'A',
      priors: { A: 0 },
      evidence: { A: 'occurred' },
    }),
    (err) => err.contradiction === true && /观测与模型矛盾/.test(err.message)
  );
});

test('矛盾：现场标记下顶层不可能发生', () => {
  // TOP = AND(A, B)，但 A 已确认未发生 ⇒ P(TOP∧标记) = 0
  assert.throws(
    () => diagnoseFaultTree({
      basicFaults: ['A', 'B'],
      gates: [{ id: 'TOP', type: 'AND', inputs: ['A', 'B'] }],
      topEvent: 'TOP',
      priors: { A: 0.5, B: 0.5 },
      evidence: { A: 'absent' },
    }),
    (err) => err.contradiction === true && /观测与模型矛盾/.test(err.message)
  );
});

test('校验：先验概率缺失 / 越界 / 非数字 / 多余键', () => {
  const base = {
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    evidence: {},
  };
  assert.throws(
    () => diagnoseFaultTree({ ...base, priors: { A: 0.2 } }),
    /「B」缺少先验发生概率/
  );
  assert.throws(
    () => diagnoseFaultTree({ ...base, priors: { A: 1.5, B: 0.3 } }),
    /必须在 0～1 之间/
  );
  assert.throws(
    () => diagnoseFaultTree({ ...base, priors: { A: 'abc', B: 0.3 } }),
    /先验概率无效/
  );
  assert.throws(
    () => diagnoseFaultTree({ ...base, priors: { A: 0.2, B: 0.3, 幽灵: 0.1 } }),
    /未定义的基础故障：「幽灵」/
  );
  assert.throws(
    () => diagnoseFaultTree({ ...base, priors: [0.2, 0.3] }),
    /priors 必须是由基础故障名称到/
  );
});

test('校验：现场标记取值非法 / 针对未定义故障', () => {
  const base = {
    basicFaults: ['A'],
    gates: [],
    topEvent: 'A',
    priors: { A: 0.5 },
  };
  assert.throws(
    () => diagnoseFaultTree({ ...base, evidence: { A: 'maybe' } }),
    /现场标记无效/
  );
  assert.throws(
    () => diagnoseFaultTree({ ...base, evidence: { 幽灵: 'occurred' } }),
    /未定义的基础故障：「幽灵」/
  );
});

test('复用故障树结构校验：成环、引用缺失同样报错', () => {
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
    /循环引用/
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

test('先验为边界值 0 与 1 时枚举仍正确', () => {
  // A 必发生（先验 1），B 必不发生（先验 0），TOP = OR(A, B)
  const r = diagnoseFaultTree({
    basicFaults: ['A', 'B'],
    gates: [{ id: 'TOP', type: 'OR', inputs: ['A', 'B'] }],
    topEvent: 'TOP',
    priors: { A: 1, B: 0 },
    evidence: {},
  });
  close(r.topProbability, 1);
  const byName = Object.fromEntries(r.results.map((x) => [x.name, x.posterior]));
  close(byName.A, 1);
  close(byName.B, 0);
});
