'use strict';

/**
 * 现场诊断：已知顶层故障确已发生时，计算各未确认基础故障的后验发生概率。
 *
 * 方法（精确枚举，不做任何独立性近似）：
 *   1. 枚举全部 2^n 个基础故障状态组合（n ≤ 12，至多 4096 个）；
 *   2. 丢弃与现场标记（已确认发生 / 已确认未发生）不一致的组合；
 *   3. 每个组合的联合概率 = ∏ p_i^x_i · (1 − p_i)^(1−x_i)，
 *      其中共享引用（同一基础故障被多个门引用）在同一组合内只取同一个
 *      确定状态，天然避免了「把共享分支当作独立事件相乘」的错误；
 *   4. 按 AND/OR 门自底向上求顶层状态（记忆化，共享子树只求一次），
 *      只保留顶层发生的组合；
 *   5. 后验概率 = 组合概率归一化：P(fault_i | top, evidence)
 *      = Σ P(state) / Σ P(state')（对保留组合中含 fault_i 者求和）。
 *
 * 输入（在故障树结构之外新增）：
 *   priors:   { [基础故障名称]: number }   独立先验发生概率，0～1，每个基础故障必填
 *   evidence: { [基础故障名称]: 'occurred' | 'absent' }   现场确认标记，可缺省
 *
 * 输出：
 *   { topEvent, evidenceProbability, posteriors, statesEnumerated }
 *   evidenceProbability：与标记一致且顶层发生的状态组合的联合概率之和（归一化分母）；
 *   posteriors：仅未确认的基础故障，按后验概率降序。
 *
 * 证据概率为零（观测与模型矛盾）时抛出带 contradiction 标记的 Error。
 */

const { validateFaultTree } = require('./faultTree');

function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 诊断故障树。结构校验复用 validateFaultTree；
 * 输入不合法时抛出带 validationErrors 的 Error，
 * 证据概率为零时抛出带 contradiction 标记的 Error。
 */
function diagnoseFaultTree(input) {
  const data = input && typeof input === 'object' ? input : {};

  // ---- 1. 故障树结构校验（与 /api/analyze 完全同一套规则） -----------------
  const { basics, gates, topEvent } = validateFaultTree(data);
  const basicSet = new Set(basics);

  const errors = [];

  // ---- 2. 先验概率校验：每个基础故障都必须是 0～1 的有限数值 --------------
  const priors = new Map();
  const rawPriors = data.priors;
  if (!rawPriors || typeof rawPriors !== 'object' || Array.isArray(rawPriors)) {
    errors.push('缺少先验概率表 priors（对象：基础故障名称 → 0～1 的概率）。');
  } else {
    for (const name of basics) {
      const p = rawPriors[name];
      if (typeof p !== 'number' || !Number.isFinite(p)) {
        errors.push(`基础故障「${name}」缺少有效的先验概率（0～1 的数值）。`);
      } else if (p < 0 || p > 1) {
        errors.push(`基础故障「${name}」的先验概率 ${p} 超出 0～1 范围。`);
      } else {
        priors.set(name, p);
      }
    }
    for (const key of Object.keys(rawPriors)) {
      if (!basicSet.has(cleanName(key))) {
        errors.push(`先验概率表中存在未定义的基础故障：「${key}」。`);
      }
    }
  }

  // ---- 3. 现场标记校验：仅针对基础故障，值为 occurred / absent -------------
  const evidence = new Map(); // name -> true(已确认发生) | false(已确认未发生)
  const rawEvidence = data.evidence;
  if (rawEvidence != null && (typeof rawEvidence !== 'object' || Array.isArray(rawEvidence))) {
    errors.push('现场标记 evidence 必须是对象（基础故障名称 → "occurred" | "absent"）。');
  } else if (rawEvidence) {
    for (const [key, value] of Object.entries(rawEvidence)) {
      const name = cleanName(key);
      if (!basicSet.has(name)) {
        errors.push(`现场标记指向未定义的基础故障：「${key}」。`);
        continue;
      }
      if (value === 'occurred' || value === true) evidence.set(name, true);
      else if (value === 'absent' || value === false) evidence.set(name, false);
      else if (value === 'unknown' || value == null) continue; // 未确认：等同不传
      else {
        errors.push(
          `基础故障「${name}」的现场标记无效：${JSON.stringify(value)}，` +
          '应为 "occurred"（已确认发生）或 "absent"（已确认未发生）。'
        );
      }
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join('\n'));
    err.validationErrors = errors;
    throw err;
  }

  // ---- 4. 精确枚举与标记一致的状态组合 --------------------------------------
  const n = basics.length;
  const indexOf = new Map(basics.map((b, i) => [b, i]));
  const unknownIdx = basics
    .map((b, i) => i)
    .filter((i) => !evidence.has(basics[i]));

  const occur = new Array(n).fill(false);
  const gateCache = new Map(); // 每个状态组合内共享子树只求值一次

  // 按 AND/OR 门求节点在该状态下的布尔值（共享引用取同一状态，不重复相乘）
  const evalNode = (name) => {
    if (indexOf.has(name)) return occur[indexOf.get(name)];
    if (gateCache.has(name)) return gateCache.get(name);
    const gate = gates.get(name);
    const result =
      gate.type === 'AND'
        ? gate.inputs.every(evalNode)
        : gate.inputs.some(evalNode);
    gateCache.set(name, result);
    return result;
  };

  let evidenceProbability = 0; // Σ P(state)：与标记一致且顶层发生
  const acc = new Array(n).fill(0); // 未确认故障在保留组合中的概率质量和
  let statesEnumerated = 0;

  const total = 1 << n; // n ≤ 12 → 至多 4096 个组合
  for (let mask = 0; mask < total; mask++) {
    // 与现场标记一致性检查 + 联合概率（先验独立乘积）
    let p = 1;
    let consistent = true;
    for (let i = 0; i < n; i++) {
      const bit = ((mask >> i) & 1) === 1;
      occur[i] = bit;
      if (evidence.has(basics[i]) && evidence.get(basics[i]) !== bit) {
        consistent = false;
        break;
      }
      p *= bit ? priors.get(basics[i]) : 1 - priors.get(basics[i]);
    }
    if (!consistent) continue;
    statesEnumerated++;

    gateCache.clear();
    if (!evalNode(topEvent)) continue; // 只保留顶层发生的组合

    evidenceProbability += p;
    for (const i of unknownIdx) {
      if (occur[i]) acc[i] += p;
    }
  }

  // ---- 5. 证据概率为零 → 观测与模型矛盾 -------------------------------------
  if (evidenceProbability === 0) {
    const err = new Error(
      '证据概率为零：在现有现场标记下没有任何状态组合能使顶层故障发生，' +
      '观测与模型矛盾。请检查「已确认发生 / 已确认未发生」标记、先验概率或故障树结构。'
    );
    err.contradiction = true;
    throw err;
  }

  // ---- 6. 条件概率归一化，按后验概率降序 ------------------------------------
  const posteriors = unknownIdx
    .map((i) => ({ name: basics[i], probability: acc[i] / evidenceProbability }))
    .sort(
      (a, b) =>
        b.probability - a.probability ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );

  return { topEvent, evidenceProbability, posteriors, statesEnumerated };
}

module.exports = { diagnoseFaultTree };
