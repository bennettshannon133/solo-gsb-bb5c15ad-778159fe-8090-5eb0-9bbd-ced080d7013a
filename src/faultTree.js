'use strict';

/**
 * 故障树最小割集（Minimal Cut Set）求解。
 *
 * 输入：
 *   basicFaults: string[]  基础故障名称，至多 12 个，名称唯一
 *   gates: Array<{ id: string, type: 'AND'|'OR', inputs: string[] }>
 *          门的输入可以是基础故障，也可以是其他门
 *   topEvent: string       顶层故障（基础故障或门）
 *
 * 输出：
 *   { combinations: string[][] }
 *   每个数组表示一个使顶层故障发生的「最小基础故障组合」，
 *   已按故障数升序、名称字典序排序。
 */

const MAX_BASIC_FAULTS = 12;

function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 合并两个有序字符串数组（AND 用），重复项只保留一次，结果仍有序 */
function unionSorted(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  const push = (v) => {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  };
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) push(a[i++]);
    else if (a[i] > b[j]) push(b[j++]);
    else {
      push(a[i++]);
      j++;
    }
  }
  while (i < a.length) push(a[i++]);
  while (j < b.length) push(b[j++]);
  return out;
}

/** s 是否为 t 的子集（入参均为有序、无重复） */
function isSubset(s, t) {
  if (s.length > t.length) return false;
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    while (j < t.length && t[j] < s[i]) j++;
    if (j >= t.length || t[j] !== s[i]) return false;
    j++;
  }
  return true;
}

/**
 * 最小化一组割集：
 *  1. 去重（重复路径不放大结果）；
 *  2. 删除「包含了更小组合」的超集。
 */
function minimize(cuts) {
  const unique = [];
  const seen = new Set();
  for (const cut of cuts) {
    const key = cut.join('');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(cut);
    }
  }
  unique.sort((a, b) =>
    a.length === b.length
      ? (a < b ? -1 : a > b ? 1 : 0)
      : a.length - b.length
  );

  const result = [];
  for (let i = 0; i < unique.length; i++) {
    let redundant = false;
    for (let j = 0; j < result.length; j++) {
      // result 中的组合不大于当前组合；若它是当前组合的子集，当前组合冗余
      if (isSubset(result[j], unique[i])) {
        redundant = true;
        break;
      }
    }
    if (!redundant) result.push(unique[i]);
  }
  return result;
}

/**
 * 分析故障树，返回最小割集。输入不合法时抛出带中文信息的 Error。
 */
function analyzeFaultTree(input) {
  const errors = [];
  const data = input && typeof input === 'object' ? input : {};

  // ---- 1. 基础故障校验 ----------------------------------------------------
  const rawBasic = Array.isArray(data.basicFaults) ? data.basicFaults : null;
  if (!rawBasic) {
    errors.push('缺少基础故障列表 basicFaults。');
  }
  const basics = [];
  if (rawBasic) {
    if (rawBasic.length > MAX_BASIC_FAULTS) {
      errors.push(
        `基础故障最多 ${MAX_BASIC_FAULTS} 个，当前有 ${rawBasic.length} 个。`
      );
    }
    const seen = new Set();
    rawBasic.forEach((item, idx) => {
      const name = cleanName(item);
      if (!name) {
        errors.push(`第 ${idx + 1} 个基础故障名称为空。`);
      } else if (seen.has(name)) {
        errors.push(`基础故障名称重复：「${name}」。`);
      } else {
        seen.add(name);
        basics.push(name);
      }
    });
  }

  // ---- 2. 门校验 ----------------------------------------------------------
  const rawGates = Array.isArray(data.gates) ? data.gates : [];
  const gates = new Map();
  const gateOrder = [];
  const nameClash = new Set(basics);

  rawGates.forEach((g, idx) => {
    const where = `第 ${idx + 1} 个门`;
    if (!g || typeof g !== 'object') {
      errors.push(`${where}格式无效。`);
      return;
    }
    const id = cleanName(g.id);
    const label = id ? `（「${id}」）` : '';
    if (!id) {
      errors.push(`${where}缺少名称。`);
    } else if (nameClash.has(id)) {
      errors.push(
        `${where}名称「${id}」与基础故障或其他门重名，名称必须全局唯一。`
      );
    }

    const type =
      typeof g.type === 'string' ? g.type.trim().toUpperCase() : '';
    if (type !== 'AND' && type !== 'OR') {
      errors.push(`${where}${label}的类型必须是 AND 或 OR。`);
    }

    let inputs = [];
    if (!Array.isArray(g.inputs)) {
      errors.push(`${where}${label}的输入列表缺失。`);
    } else if (g.inputs.length === 0) {
      errors.push(`${where}${label}没有任何输入。`);
    } else {
      // 重复引用直接去重，不放大结果
      inputs = [...new Set(g.inputs.map(cleanName).filter(Boolean))];
      if (inputs.length === 0) {
        errors.push(`${where}${label}存在空输入。`);
      }
    }

    // 名称占用先登记，以便后续重复命名能被检出；有效门再进入 gates
    if (id && !nameClash.has(id)) nameClash.add(id);
    if (id && (type === 'AND' || type === 'OR') && inputs.length > 0) {
      gateOrder.push(id);
      gates.set(id, { id, type, inputs });
    }
  });

  // 自引用检查（也属于成环）
  for (const g of gates.values()) {
    if (g.inputs.includes(g.id)) {
      errors.push(`门「${g.id}」引用了自身，门之间不能成环。`);
    }
  }

  // ---- 3. 顶层故障校验 ----------------------------------------------------
  const topEvent = cleanName(data.topEvent);
  if (!topEvent) {
    errors.push('未指定顶层故障。');
  } else if (!nameClash.has(topEvent)) {
    errors.push(`顶层故障「${topEvent}」不存在：它必须是已定义的基础故障或门。`);
  }

  // ---- 4. 引用完整性 ------------------------------------------------------
  const basicSet = new Set(basics);
  for (const g of gates.values()) {
    for (const ref of g.inputs) {
      if (ref === g.id) continue; // 自环已报错
      if (!basicSet.has(ref) && !gates.has(ref)) {
        errors.push(`门「${g.id}」引用了不存在的基础故障或门：「${ref}」。`);
      }
    }
  }

  // ---- 5. 环检测（DFS 三色标记，独立于其他校验，保证环总能被报出） ----
  {
    const COLOR = { GRAY: 1, BLACK: 2 };
    const color = new Map();
    const stack = [];

    const visit = (id) => {
      color.set(id, COLOR.GRAY);
      stack.push(id);
      const g = gates.get(id);
      if (g) {
        for (const ref of g.inputs) {
          if (ref === id) continue; // 自引用已在前面单独报错
          if (!gates.has(ref)) continue; // 基础故障或缺失引用不在此展开
          if (color.get(ref) === COLOR.GRAY) {
            const cycleStart = stack.indexOf(ref);
            const path = stack.slice(cycleStart).concat(ref).join(' → ');
            errors.push(`门之间存在循环引用：${path}。故障树不能成环。`);
            return true;
          }
          if (!color.has(ref) && visit(ref)) return true;
        }
      }
      stack.pop();
      color.set(id, COLOR.BLACK);
      return false;
    };

    for (const id of gateOrder) {
      if (!color.has(id) && visit(id)) break;
    }
  }

  if (errors.length > 0) {
    const err = new Error(errors.join('\n'));
    err.validationErrors = errors;
    throw err;
  }

  // ---- 6. 自底向上计算最小割集（记忆化） ----------------------------------
  const memo = new Map();

  const evalNode = (name) => {
    if (basicSet.has(name)) return [[name]];
    if (memo.has(name)) return memo.get(name);

    const gate = gates.get(name);
    const childCuts = gate.inputs.map(evalNode);

    let cuts;
    if (gate.type === 'AND') {
      // AND：任取每个子节点的一个组合并合并（同一基础故障经多条路径
      // 引用时只算一次）；每步最小化，避免重复路径放大中间结果。
      cuts = [[]];
      for (const child of childCuts) {
        const merged = [];
        for (const acc of cuts) {
          for (const cc of child) {
            merged.push(unionSorted(acc, cc));
          }
        }
        cuts = minimize(merged);
      }
    } else {
      // OR：任一子节点的组合都可导致本门发生，汇总后最小化。
      cuts = minimize(childCuts.flat());
    }

    cuts = minimize(cuts);
    memo.set(name, cuts);
    return cuts;
  };

  const combinations = evalNode(topEvent).map((c) => [...c]);
  return { combinations, gates: gateOrder, topEvent };
}

module.exports = { analyzeFaultTree, minimize, unionSorted, isSubset, MAX_BASIC_FAULTS };
