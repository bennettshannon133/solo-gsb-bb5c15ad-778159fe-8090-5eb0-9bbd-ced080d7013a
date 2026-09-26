'use strict';

/**
 * 现场诊断：已知顶层故障确已发生时，基于精确枚举的贝叶斯后验分析。
 *
 * 输入（在故障树结构之上附加）：
 *   priors:   { [基础故障名]: 0～1 的独立先验发生概率 }（每个基础故障必填）
 *   evidence: { [基础故障名]: 'occurred' | 'absent' | 'unknown' }
 *             occurred = 现场已确认发生，absent = 现场已确认未发生，
 *             unknown / 缺省 = 未确认
 *
 * 方法：
 *   枚举全部 2^n 个基础故障状态组合（n ≤ 12），筛出与现场标记一致的组合；
 *   每个组合按各基础故障的独立先验求联合概率，并按 AND/OR 门求顶层状态。
 *   由于枚举的对象是基础故障状态而非门事件，共享子树在同一组合中只取
 *   同一个确定取值，不会被当作独立事件重复相乘。
 *   只保留顶层发生的组合，按条件概率归一化，得到每个未确认基础故障的
 *   后验发生概率 P(故障 | 顶层发生 ∧ 现场标记)，并按概率降序返回。
 *
 * 现场标记（或其与顶层发生的组合）概率为 0 时，抛出 err.contradiction = true
 * 的「观测与模型矛盾」错误。
 */

const { validateFaultTree } = require('./faultTree');

const STATUS_TEXT = { occurred: '已确认发生', absent: '已确认未发生' };

/** 去掉浮点噪声（如 0.30000000000000004），保留 12 位有效数字 */
function cleanNumber(v) {
  if (!Number.isFinite(v)) return 0;
  const r = Number(v.toPrecision(12));
  return Math.abs(r) < 1e-15 ? 0 : r;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function diagnoseFaultTree(input) {
  const data = input && typeof input === 'object' ? input : {};
  // 复用故障树结构校验（基础故障/门/顶层故障/引用完整性/环），错误直接抛出
  const { basics, gates, topEvent, basicSet } = validateFaultTree(data);

  const errors = [];

  // ---- 先验概率校验 ---------------------------------------------------
  const rawPriors = data.priors;
  const priors = new Map();
  if (rawPriors !== undefined && !isPlainObject(rawPriors)) {
    errors.push('先验概率 priors 必须是由基础故障名称到 0～1 概率值的对象。');
  } else {
    const priorsObj = rawPriors || {};
    for (const name of basics) {
      const raw = priorsObj[name];
      const missing =
        raw === undefined || raw === null ||
        (typeof raw === 'string' && raw.trim() === '');
      const num = typeof raw === 'string' ? Number(raw) : raw;
      if (missing) {
        errors.push(`基础故障「${name}」缺少先验发生概率（0～1）。`);
      } else if (typeof num !== 'number' || !Number.isFinite(num)) {
        errors.push(`基础故障「${name}」的先验概率无效：必须是 0～1 之间的数字。`);
      } else if (num < 0 || num > 1) {
        errors.push(`基础故障「${name}」的先验概率必须在 0～1 之间，当前为 ${num}。`);
      } else {
        priors.set(name, num);
      }
    }
    for (const key of Object.keys(priorsObj)) {
      if (!basicSet.has(key)) {
        errors.push(`先验概率中包含未定义的基础故障：「${key}」。`);
      }
    }
  }

  // ---- 现场标记校验 ---------------------------------------------------
  const rawEvidence = data.evidence;
  const evidence = new Map(); // name -> 'occurred' | 'absent'
  if (rawEvidence !== undefined && !isPlainObject(rawEvidence)) {
    errors.push('现场标记 evidence 必须是由基础故障名称到 occurred / absent / unknown 的对象。');
  } else {
    for (const [key, value] of Object.entries(rawEvidence || {})) {
      if (!basicSet.has(key)) {
        errors.push(`现场标记中包含未定义的基础故障：「${key}」。`);
        continue;
      }
      const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (v === '' || v === 'unknown') continue; // 未确认，等价于不标记
      if (v !== 'occurred' && v !== 'absent') {
        errors.push(
          `基础故障「${key}」的现场标记无效：「${value}」，应为 ` +
          `occurred（已确认发生）/ absent（已确认未发生）/ unknown（未确认）。`
        );
        continue;
      }
      evidence.set(key, v);
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join('\n'));
    err.validationErrors = errors;
    throw err;
  }

  // ---- 精确枚举全部与现场标记一致的状态组合 ----------------------------
  const n = basics.length;
  const priorArr = basics.map((name) => priors.get(name));
  const markArr = basics.map((name) => evidence.get(name) || null);
  const basicIndex = new Map(basics.map((name, i) => [name, i]));

  let pEvidence = 0;    // P(现场标记)
  let pTop = 0;         // P(顶层发生 ∧ 现场标记)
  let stateCount = 0;   // 与现场标记一致的状态组合数
  let topStateCount = 0;
  const numerator = new Array(n).fill(0); // 各未确认故障的后验分子

  const total = 2 ** n;
  for (let s = 0; s < total; s++) {
    // 组装状态、核对现场标记、求联合概率（只对基础故障的先验连乘）
    const occurred = new Array(n);
    let prob = 1;
    let consistent = true;
    for (let j = 0; j < n; j++) {
      occurred[j] = ((s >> j) & 1) === 1;
      const mark = markArr[j];
      if ((mark === 'occurred' && !occurred[j]) || (mark === 'absent' && occurred[j])) {
        consistent = false;
        break;
      }
      prob *= occurred[j] ? priorArr[j] : 1 - priorArr[j];
    }
    if (!consistent) continue;
    stateCount += 1;
    pEvidence += prob;

    // 按 AND/OR 门求顶层状态；同一状态内共享子树只求值一次（取同一确定值）
    const memo = new Map();
    const evalNode = (name) => {
      const bi = basicIndex.get(name);
      if (bi !== undefined) return occurred[bi];
      if (memo.has(name)) return memo.get(name);
      const gate = gates.get(name);
      const val = gate.type === 'AND'
        ? gate.inputs.every(evalNode)
        : gate.inputs.some(evalNode);
      memo.set(name, val);
      return val;
    };

    if (evalNode(topEvent)) {
      topStateCount += 1;
      pTop += prob;
      for (let j = 0; j < n; j++) {
        if (occurred[j] && !markArr[j]) numerator[j] += prob;
      }
    }
  }

  // ---- 矛盾检测：证据概率为 0 ------------------------------------------
  if (pEvidence === 0) {
    const err = new Error(
      '观测与模型矛盾：在当前先验概率下，现场标记出现的概率为 0，' +
      '请检查先验概率与现场标记是否冲突。'
    );
    err.contradiction = true;
    throw err;
  }
  if (pTop === 0) {
    const err = new Error(
      `观测与模型矛盾：在当前先验概率与现场标记下，顶层故障「${topEvent}」` +
      `发生的概率为 0，与「顶层故障确已发生」矛盾。`
    );
    err.contradiction = true;
    throw err;
  }

  // ---- 后验概率（只保留顶层发生的组合，按条件概率归一化） ---------------
  const results = [];
  for (let j = 0; j < n; j++) {
    if (markArr[j]) continue; // 已确认的故障不需要后验
    results.push({
      name: basics[j],
      prior: cleanNumber(priorArr[j]),
      posterior: cleanNumber(numerator[j] / pTop),
    });
  }
  // 按后验概率降序，并列时按名称（中文）字典序
  results.sort((a, b) =>
    b.posterior - a.posterior || a.name.localeCompare(b.name, 'zh-Hans-CN')
  );

  return {
    topEvent,
    evidenceProbability: cleanNumber(pEvidence),
    topProbability: cleanNumber(pTop),
    stateCount,
    topStateCount,
    confirmed: basics
      .filter((name) => evidence.has(name))
      .map((name) => ({
        name,
        status: evidence.get(name),
        statusText: STATUS_TEXT[evidence.get(name)],
      })),
    results,
  };
}

module.exports = { diagnoseFaultTree };
