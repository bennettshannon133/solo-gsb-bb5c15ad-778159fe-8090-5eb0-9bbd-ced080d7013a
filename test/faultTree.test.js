'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeFaultTree, minimize, unionSorted, isSubset } = require('../src/faultTree');

/** 分析并返回排序后的组合（key 形式，方便断言） */
function keys(input) {
  return analyzeFaultTree(input).combinations.map((c) => c.join('+'));
}

test('unionSorted 合并两个有序数组并去重', () => {
  assert.deepEqual(unionSorted(['a', 'c'], ['b', 'c', 'd']), ['a', 'b', 'c', 'd']);
  assert.deepEqual(unionSorted([], ['a']), ['a']);
  assert.deepEqual(unionSorted(['a', 'b'], ['a', 'b']), ['a', 'b']);
});

test('isSubset 子集判定', () => {
  assert.equal(isSubset(['a'], ['a', 'b']), true);
  assert.equal(isSubset(['a', 'c'], ['a', 'b', 'c']), true);
  assert.equal(isSubset(['a', 'd'], ['a', 'b', 'c']), false);
  assert.equal(isSubset(['a', 'b'], ['a']), false);
});

test('minimize 去重并删除超集', () => {
  const out = minimize([
    ['a', 'b'], ['a'], ['c'], ['a', 'b'], ['a', 'c'], ['b', 'c', 'd'],
  ]).map((c) => c.join('+'));
  assert.deepEqual(out, ['a', 'c']);
});

test('顶层为基础故障', () => {
  assert.deepEqual(keys({ basicFaults: ['X'], gates: [], topEvent: 'X' }), ['X']);
});

test('纯 AND 门：组合为所有子项的合并', () => {
  assert.deepEqual(
    keys({
      basicFaults: ['A', 'B', 'C'],
      gates: [{ id: 'G', type: 'AND', inputs: ['A', 'B', 'C'] }],
      topEvent: 'G',
    }),
    ['A+B+C']
  );
});

test('纯 OR 门：每个子项各成一个组合', () => {
  assert.deepEqual(
    keys({
      basicFaults: ['A', 'B', 'C'],
      gates: [{ id: 'G', type: 'OR', inputs: ['A', 'B', 'C'] }],
      topEvent: 'G',
    }),
    ['A', 'B', 'C']
  );
});

test('AND 下含 OR：笛卡尔积展开', () => {
  // TOP = AND(A, OR(B,C)) => {A,B},{A,C}
  assert.deepEqual(
    keys({
      basicFaults: ['A', 'B', 'C'],
      gates: [
        { id: 'G1', type: 'OR', inputs: ['B', 'C'] },
        { id: 'TOP', type: 'AND', inputs: ['A', 'G1'] },
      ],
      topEvent: 'TOP',
    }),
    ['A+B', 'A+C']
  );
});

test('OR 汇总后剔除超集（吸收律：A + AB = A）', () => {
  // OR(A, AND(A,B)) => 只有 {A}
  assert.deepEqual(
    keys({
      basicFaults: ['A', 'B'],
      gates: [
        { id: 'G1', type: 'AND', inputs: ['A', 'B'] },
        { id: 'TOP', type: 'OR', inputs: ['A', 'G1'] },
      ],
      topEvent: 'TOP',
    }),
    ['A']
  );
});

test('AND 中同一基础故障经多条路径重复引用时只算一次', () => {
  // AND(OR(A,B), OR(A,C)) = AA,AC,BA,BC => {A},{A,C},{A,B},{B,C} => {A},{B,C}
  assert.deepEqual(
    keys({
      basicFaults: ['A', 'B', 'C'],
      gates: [
        { id: 'G1', type: 'OR', inputs: ['A', 'B'] },
        { id: 'G2', type: 'OR', inputs: ['A', 'C'] },
        { id: 'TOP', type: 'AND', inputs: ['G1', 'G2'] },
      ],
      topEvent: 'TOP',
    }),
    ['A', 'B+C']
  );
});

test('共享子树不放大结果（记忆化 + 去重）', () => {
  // TOP = OR(G, G)，G = AND(A,B)，应只得到一个 {A,B}
  assert.deepEqual(
    keys({
      basicFaults: ['A', 'B'],
      gates: [
        { id: 'G', type: 'AND', inputs: ['A', 'B'] },
        { id: 'TOP', type: 'OR', inputs: ['G', 'G'] },
      ],
      topEvent: 'TOP',
    }),
    ['A+B']
  );
});

test('复杂树：按故障数、名称排序', () => {
  // 供电失效 = OR(主电源中断, 备用电源失效)
  // 散热失效 = AND(冷却泵停转, 散热风扇损坏)
  // 设备停机 = OR(供电失效, 散热失效, 人员误操作)
  assert.deepEqual(
    keys({
      basicFaults: ['主电源中断', '备用电源失效', '冷却泵停转', '散热风扇损坏', '人员误操作'],
      gates: [
        { id: '供电失效', type: 'OR', inputs: ['主电源中断', '备用电源失效'] },
        { id: '散热失效', type: 'AND', inputs: ['冷却泵停转', '散热风扇损坏'] },
        { id: '设备停机', type: 'OR', inputs: ['供电失效', '散热失效', '人员误操作'] },
      ],
      topEvent: '设备停机',
    }),
    ['主电源中断', '人员误操作', '备用电源失效', '冷却泵停转+散热风扇损坏']
  );
});

test('错误：引用不存在的节点', () => {
  assert.throws(
    () => analyzeFaultTree({
      basicFaults: ['A'],
      gates: [{ id: 'G', type: 'AND', inputs: ['A', '幽灵'] }],
      topEvent: 'G',
    }),
    /不存在/
  );
});

test('错误：直接成环', () => {
  assert.throws(
    () => analyzeFaultTree({
      basicFaults: ['A'],
      gates: [
        { id: 'G1', type: 'OR', inputs: ['A', 'G2'] },
        { id: 'G2', type: 'AND', inputs: ['A', 'G1'] },
      ],
      topEvent: 'G1',
    }),
    /循环引用/
  );
});

test('错误：门引用自身', () => {
  assert.throws(
    () => analyzeFaultTree({
      basicFaults: ['A'],
      gates: [{ id: 'G', type: 'OR', inputs: ['A', 'G'] }],
      topEvent: 'G',
    }),
    /自身|成环/
  );
});

test('错误：未指定顶层故障', () => {
  assert.throws(
    () => analyzeFaultTree({ basicFaults: ['A'], gates: [], topEvent: '' }),
    /未指定顶层故障/
  );
});

test('错误：顶层故障不存在', () => {
  assert.throws(
    () => analyzeFaultTree({ basicFaults: ['A'], gates: [], topEvent: 'X' }),
    /顶层故障「X」不存在/
  );
});

test('错误：基础故障超过 12 个 / 重名 / 门无输入 / 重名门', () => {
  assert.throws(
    () => analyzeFaultTree({
      basicFaults: Array.from({ length: 13 }, (_, i) => `B${i}`),
      gates: [],
      topEvent: '',
    }),
    /最多 12/
  );
  assert.throws(
    () => analyzeFaultTree({ basicFaults: ['A', 'A'], gates: [], topEvent: 'A' }),
    /重复/
  );
  assert.throws(
    () => analyzeFaultTree({
      basicFaults: ['A'],
      gates: [{ id: 'G', type: 'AND', inputs: [] }],
      topEvent: 'G',
    }),
    /没有任何输入/
  );
  assert.throws(
    () => analyzeFaultTree({
      basicFaults: ['A'],
      gates: [
        { id: 'A', type: 'OR', inputs: ['A'] },
      ],
      topEvent: 'A',
    }),
    /重名/
  );
});
