'use strict';

/* 故障树编辑器前端：状态保存在内存，分析时提交给 /api/analyze */

const MAX_BASICS = 12;

const state = {
  basics: [],          // { uid, name, prior, status: 'unknown'|'occurred'|'absent' }
  gates: [],           // { uid, name, type: 'AND'|'OR', inputs: Set<string> }
  topEvent: '',
  seq: 0,
};

const uid = (p) => `${p}_${Date.now().toString(36)}_${(state.seq += 1)}`;

const $ = (sel) => document.querySelector(sel);

const basicListEl = $('#basicList');
const gateListEl = $('#gateList');
const topSelectEl = $('#topSelect');
const basicCountEl = $('#basicCount');
const addBasicBtn = $('#addBasicBtn');
const addGateBtn = $('#addGateBtn');
const analyzeBtn = $('#analyzeBtn');
const diagnoseBtn = $('#diagnoseBtn');
const clearBtn = $('#clearBtn');
const loadSampleBtn = $('#loadSampleBtn');
const errorPanel = $('#errorPanel');
const errorList = $('#errorList');
const resultPanel = $('#resultPanel');
const resultList = $('#resultList');
const resultSummary = $('#resultSummary');
const diagPanel = $('#diagPanel');
const diagList = $('#diagList');
const diagSummary = $('#diagSummary');
const diagConfirmed = $('#diagConfirmed');

/* ---------------- 状态操作 ---------------- */

function addBasic(basic = {}) {
  if (state.basics.length >= MAX_BASICS) return;
  state.basics.push({
    uid: uid('b'),
    name: basic.name || '',
    prior: basic.prior !== undefined ? String(basic.prior) : '0.1',
    status: basic.status || 'unknown',
  });
  renderAll();
}

function addGate(gate = {}) {
  state.gates.push({
    uid: uid('g'),
    name: gate.name || '',
    type: gate.type || 'AND',
    inputs: new Set(gate.inputs || []),
  });
  renderAll();
}

function deleteBasic(uidVal) {
  const item = state.basics.find((b) => b.uid === uidVal);
  state.basics = state.basics.filter((b) => b.uid !== uidVal);
  if (item) {
    state.gates.forEach((g) => g.inputs.delete(item.name));
    if (state.topEvent === item.name) state.topEvent = '';
  }
  renderAll();
}

function deleteGate(uidVal) {
  const item = state.gates.find((g) => g.uid === uidVal);
  state.gates = state.gates.filter((g) => g.uid !== uidVal);
  if (item) {
    state.gates.forEach((g) => g.inputs.delete(item.name));
    if (state.topEvent === item.name) state.topEvent = '';
  }
  renderAll();
}

/* 重命名时同步其他门的引用与顶层选择 */
function renameReferences(oldName, newName) {
  if (oldName === newName) return;
  state.gates.forEach((g) => {
    if (g.inputs.has(oldName)) {
      g.inputs.delete(oldName);
      if (newName) g.inputs.add(newName);
    }
  });
  if (state.topEvent === oldName) state.topEvent = newName;
}

/* ---------------- 渲染 ---------------- */

function renderAll() {
  renderBasics();
  renderGates();
  renderTopSelect();
}

function renderBasics() {
  basicListEl.innerHTML = '';
  state.basics.forEach((b, idx) => {
    const row = document.createElement('div');
    row.className = 'basic-row';

    const badge = document.createElement('span');
    badge.className = 'index';
    badge.textContent = idx + 1;

    const input = document.createElement('input');
    input.className = 'input';
    input.placeholder = `基础故障名称，如：主电源中断`;
    input.value = b.name;
    input.maxLength = 40;
    input.addEventListener('input', () => {
      const next = input.value.trim();
      renameReferences(b.name.trim(), next);
      b.name = input.value;
      updateTopSelectKeep();
    });
    input.addEventListener('blur', renderAll);

    const prob = document.createElement('input');
    prob.className = 'input prob-input';
    prob.type = 'number';
    prob.min = '0';
    prob.max = '1';
    prob.step = '0.001';
    prob.placeholder = '先验 0~1';
    prob.title = '独立先验发生概率（0～1）';
    prob.value = b.prior;
    prob.addEventListener('input', () => { b.prior = prob.value; });

    const statusSel = document.createElement('select');
    statusSel.className = 'status-select';
    statusSel.title = '现场确认情况';
    [
      ['unknown', '未确认'],
      ['occurred', '已确认发生'],
      ['absent', '已确认未发生'],
    ].forEach(([val, text]) => {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = text;
      if (b.status === val) opt.selected = true;
      statusSel.appendChild(opt);
    });
    statusSel.dataset.value = b.status;
    statusSel.addEventListener('change', () => {
      b.status = statusSel.value;
      statusSel.dataset.value = b.status;
    });

    const del = document.createElement('button');
    del.className = 'btn btn-danger-sm';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', () => deleteBasic(b.uid));

    row.append(badge, input, prob, statusSel, del);
    basicListEl.appendChild(row);
  });

  const n = state.basics.length;
  basicCountEl.textContent = `${n} / ${MAX_BASICS}`;
  basicCountEl.classList.toggle('over', n > MAX_BASICS);
  addBasicBtn.disabled = n >= MAX_BASICS;
}

function kindOf(name, selfGate) {
  if (state.basics.some((b) => b.name.trim() === name)) return 'B';
  const g = state.gates.find((x) => x !== selfGate && x.name.trim() === name);
  return g ? g.type : null;
}

function renderGateInputChips(gate, container) {
  container.innerHTML = '';
  const options = [];
  state.basics.forEach((b) => {
    const name = b.name.trim();
    if (name) options.push({ name, kind: 'B' });
  });
  state.gates.forEach((g) => {
    if (g === gate) return;
    const name = g.name.trim();
    if (name) options.push({ name, kind: g.type });
  });

  if (options.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'chip-empty';
    empty.textContent = '暂无可引用的节点，请先定义基础故障或其他门。';
    container.appendChild(empty);
    return;
  }

  options.forEach(({ name, kind }) => {
    const label = document.createElement('label');
    label.className = 'chip' + (gate.inputs.has(name) ? ' checked' : '');
    if (name === gate.name.trim()) label.classList.add('disabled');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = gate.inputs.has(name);
    cb.addEventListener('change', () => {
      if (cb.checked) gate.inputs.add(name);
      else gate.inputs.delete(name);
      renderGates();
    });

    const kindTag = document.createElement('span');
    kindTag.className = `kind ${kind === 'B' ? 'B' : kind}`;
    kindTag.textContent = kind === 'B' ? '基础' : kind;

    label.append(cb, kindTag, document.createTextNode(name));
    container.appendChild(label);
  });
}

function renderGates() {
  gateListEl.innerHTML = '';
  state.gates.forEach((gate) => {
    const card = document.createElement('div');
    card.className = 'gate';

    /* 门名称 + 类型 */
    const head = document.createElement('div');
    head.className = 'gate-head';

    const typeSel = document.createElement('select');
    typeSel.className = `gate-type ${gate.type}`;
    ['AND', 'OR'].forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t + (t === 'AND' ? ' 门（全部发生）' : ' 门（任一发生）');
      if (t === gate.type) opt.selected = true;
      typeSel.appendChild(opt);
    });
    typeSel.addEventListener('change', () => {
      gate.type = typeSel.value;
      renderAll();
    });

    const nameInput = document.createElement('input');
    nameInput.className = 'input gate-title-input';
    nameInput.placeholder = '门名称，如：供电失效';
    nameInput.value = gate.name;
    nameInput.maxLength = 40;
    nameInput.addEventListener('input', () => {
      const next = nameInput.value.trim();
      renameReferences(gate.name.trim(), next);
      gate.name = nameInput.value;
      updateTopSelectKeep();
    });
    nameInput.addEventListener('blur', renderAll);

    const del = document.createElement('button');
    del.className = 'btn btn-danger-sm';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', () => deleteGate(gate.uid));

    head.append(typeSel, nameInput, del);

    /* 输入引用 */
    const label = document.createElement('p');
    label.className = 'gate-label';
    label.textContent = '该门的输入（可多选，引用基础故障或其他门）：';

    const chips = document.createElement('div');
    chips.className = 'chip-group';
    renderGateInputChips(gate, chips);

    card.append(head, label, chips);
    gateListEl.appendChild(card);
  });
}

function renderTopSelect() {
  const keep = state.topEvent;
  topSelectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '— 请选择顶层故障 —';
  topSelectEl.appendChild(placeholder);

  const appendOpt = (name, tag) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `[${tag}] ${name}`;
    if (name === keep) opt.selected = true;
    topSelectEl.appendChild(opt);
  };
  state.basics.forEach((b) => {
    const name = b.name.trim();
    if (name) appendOpt(name, '基础');
  });
  state.gates.forEach((g) => {
    const name = g.name.trim();
    if (name) appendOpt(name, g.type);
  });

  // 当前选择已不存在（如重命名/删除导致）时回退到空
  if (keep && !topSelectEl.querySelector(`option[value="${CSS.escape(keep)}"]`)) {
    state.topEvent = '';
    topSelectEl.value = '';
  }
}

function updateTopSelectKeep() {
  // 输入过程中仅同步下拉项，不整体重渲染以免抢焦点
  const prev = topSelectEl.value;
  renderTopSelect();
  if (state.topEvent) topSelectEl.value = state.topEvent;
  else if (prev) topSelectEl.value = '';
}

topSelectEl.addEventListener('change', () => {
  state.topEvent = topSelectEl.value;
});

/* ---------------- 分析 ---------------- */

function buildPayload() {
  return {
    basicFaults: state.basics.map((b) => b.name.trim()).filter(Boolean),
    gates: state.gates.map((g) => ({
      id: g.name.trim(),
      type: g.type,
      inputs: [...g.inputs],
    })),
    topEvent: state.topEvent,
  };
}

function hidePanels() {
  errorPanel.hidden = true;
  resultPanel.hidden = true;
  diagPanel.hidden = true;
}

function showErrors(errors) {
  errorList.innerHTML = '';
  errors.forEach((msg) => {
    const li = document.createElement('li');
    li.textContent = msg;
    errorList.appendChild(li);
  });
  errorPanel.hidden = false;
  resultPanel.hidden = true;
  diagPanel.hidden = true;
  errorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showResults(topEvent, combinations) {
  errorPanel.hidden = true;
  diagPanel.hidden = true;
  resultPanel.hidden = false;

  // 页面按「故障数升序、名称（中文）字典序」排序，组合内故障同样按名称排序
  const cn = (a, b) => a.localeCompare(b, 'zh-Hans-CN');
  const sorted = combinations
    .map((c) => [...c].sort(cn))
    .sort((a, b) => (a.length === b.length ? cn(a.join(''), b.join('')) : a.length - b.length));

  resultSummary.textContent =
    `使顶层故障「${topEvent}」发生的最小基础故障组合共 ${sorted.length} 个 ` +
    `（已按故障数、名称排序，且无包含冗余）：`;

  resultList.innerHTML = '';
  if (sorted.length === 0) {
    const li = document.createElement('li');
    li.textContent = '该顶层故障不需要任何基础故障即可发生。';
    resultList.appendChild(li);
    return;
  }

  sorted.forEach((combo) => {
    const li = document.createElement('li');

    const size = document.createElement('span');
    size.className = 'combo-size';
    size.textContent = `${combo.length} 个故障`;

    const chips = document.createElement('span');
    chips.className = 'result-chips';
    combo.forEach((name, i) => {
      if (i > 0) {
        const op = document.createElement('span');
        op.className = 'combo-op';
        op.textContent = '＋';
        chips.appendChild(op);
      }
      const chip = document.createElement('span');
      chip.className = 'fault-chip';
      chip.textContent = name;
      chips.appendChild(chip);
    });

    li.append(size, chips);
    resultList.appendChild(li);
  });

  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function analyze() {
  hidePanels();
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      showErrors(data.errors || ['分析失败，请检查输入。']);
      return;
    }
    showResults(data.topEvent, data.combinations);
  } catch (e) {
    showErrors(['无法连接分析服务，请稍后重试。']);
  }
}

/* ---------------- 现场诊断 ---------------- */

function buildDiagnosisPayload() {
  const priors = {};
  const evidence = {};
  state.basics.forEach((b) => {
    const name = b.name.trim();
    if (!name) return;
    priors[name] = b.prior;      // 字符串原样提交，服务端解析并校验
    evidence[name] = b.status;
  });
  return { ...buildPayload(), priors, evidence };
}

function fmtPct(v) {
  if (!(v > 0)) return '0%';
  if (v >= 1) return '100%';
  const pct = v * 100;
  return pct < 0.01 ? '<0.01%' : `${pct.toFixed(2)}%`;
}

function showDiagnosis(data) {
  errorPanel.hidden = true;
  resultPanel.hidden = true;
  diagPanel.hidden = false;

  diagSummary.textContent =
    `已知顶层故障「${data.topEvent}」确已发生：精确枚举出与现场标记一致的状态组合 ` +
    `${data.stateCount} 个，其中顶层发生 ${data.topStateCount} 个；` +
    `P(现场标记) = ${fmtPct(data.evidenceProbability)}，` +
    `P(顶层发生 ∧ 现场标记) = ${fmtPct(data.topProbability)}。` +
    `以下为各未确认基础故障的后验发生概率（降序）：`;

  if (data.confirmed && data.confirmed.length > 0) {
    diagConfirmed.hidden = false;
    diagConfirmed.textContent =
      '现场标记：' +
      data.confirmed.map((c) => `${c.name}（${c.statusText}）`).join('、');
  } else {
    diagConfirmed.hidden = true;
    diagConfirmed.textContent = '';
  }

  diagList.innerHTML = '';
  if (data.results.length === 0) {
    const li = document.createElement('li');
    li.textContent = '所有基础故障均已在现场确认，没有需要计算后验概率的故障。';
    diagList.appendChild(li);
  } else {
    data.results.forEach((r) => {
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'fault-chip';
      name.textContent = r.name;

      const bar = document.createElement('span');
      bar.className = 'prob-bar';
      const fill = document.createElement('span');
      fill.className = 'prob-fill' + (r.posterior >= 0.5 ? ' high' : '');
      const width = r.posterior > 0 ? Math.max(r.posterior * 100, 2) : 0;
      fill.style.width = `${Math.min(width, 100)}%`;
      bar.appendChild(fill);

      const val = document.createElement('span');
      val.className = 'prob-value';
      val.textContent = fmtPct(r.posterior);

      const prior = document.createElement('span');
      prior.className = 'prior-note';
      prior.textContent = `先验 ${fmtPct(r.prior)}`;

      li.append(name, bar, val, prior);
      diagList.appendChild(li);
    });
  }

  diagPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function diagnose() {
  hidePanels();
  try {
    const resp = await fetch('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDiagnosisPayload()),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      // 409 时 errors 中为「观测与模型矛盾」的说明
      showErrors(data.errors || ['诊断失败，请检查输入。']);
      return;
    }
    showDiagnosis(data);
  } catch (e) {
    showErrors(['无法连接诊断服务，请稍后重试。']);
  }
}

/* ---------------- 示例与清空 ---------------- */

function loadSample() {
  state.basics = [
    { uid: uid('b'), name: '主电源中断', prior: '0.02', status: 'unknown' },
    { uid: uid('b'), name: '备用电源失效', prior: '0.05', status: 'unknown' },
    { uid: uid('b'), name: '冷却泵停转', prior: '0.03', status: 'unknown' },
    { uid: uid('b'), name: '散热风扇损坏', prior: '0.04', status: 'unknown' },
    { uid: uid('b'), name: '人员误操作', prior: '0.01', status: 'unknown' },
  ];
  const gPower = { uid: uid('g'), name: '供电失效', type: 'OR',
    inputs: new Set(['主电源中断', '备用电源失效']) };
  const gCool = { uid: uid('g'), name: '散热失效', type: 'AND',
    inputs: new Set(['冷却泵停转', '散热风扇损坏']) };
  state.gates = [gPower, gCool, {
    uid: uid('g'), name: '设备停机', type: 'OR',
    inputs: new Set(['供电失效', '散热失效', '人员误操作']),
  }];
  state.topEvent = '设备停机';
  renderAll();
  hidePanels();
}

function clearAll() {
  state.basics = [];
  state.gates = [];
  state.topEvent = '';
  renderAll();
  hidePanels();
}

/* ---------------- 初始化 ---------------- */

addBasicBtn.addEventListener('click', () => addBasic());
addGateBtn.addEventListener('click', () => addGate());
analyzeBtn.addEventListener('click', analyze);
diagnoseBtn.addEventListener('click', diagnose);
clearBtn.addEventListener('click', clearAll);
loadSampleBtn.addEventListener('click', loadSample);

addBasic();
addBasic();
renderAll();
