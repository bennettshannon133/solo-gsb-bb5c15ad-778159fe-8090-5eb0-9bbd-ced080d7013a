'use strict';

/* 故障树编辑器前端：状态保存在内存，分析/诊断时提交给 /api/analyze、/api/diagnose */

const MAX_BASICS = 12;

const state = {
  basics: [],          // { uid, name, prior, mark: 'unknown'|'occurred'|'absent' }
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
const clearBtn = $('#clearBtn');
const loadSampleBtn = $('#loadSampleBtn');
const errorPanel = $('#errorPanel');
const errorList = $('#errorList');
const resultPanel = $('#resultPanel');
const resultList = $('#resultList');
const resultSummary = $('#resultSummary');
const diagListEl = $('#diagList');
const diagnoseBtn = $('#diagnoseBtn');
const diagPanel = $('#diagPanel');
const diagSummary = $('#diagSummary');
const diagResultList = $('#diagResultList');
const contradictionPanel = $('#contradictionPanel');
const contradictionMsg = $('#contradictionMsg');

/* ---------------- 状态操作 ---------------- */

function addBasic(name = '', prior = '') {
  if (state.basics.length >= MAX_BASICS) return;
  state.basics.push({ uid: uid('b'), name, prior, mark: 'unknown' });
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
  renderDiagnosis();
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

    const prior = document.createElement('input');
    prior.className = 'input prior-input';
    prior.type = 'number';
    prior.min = '0';
    prior.max = '1';
    prior.step = '0.01';
    prior.placeholder = '先验 0~1';
    prior.title = '该故障的独立先验发生概率（0～1），用于现场诊断';
    prior.value = b.prior;
    prior.addEventListener('input', () => {
      b.prior = prior.value;
    });
    prior.addEventListener('blur', renderAll);

    const del = document.createElement('button');
    del.className = 'btn btn-danger-sm';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', () => deleteBasic(b.uid));

    row.append(badge, input, prior, del);
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

/* ---------------- 现场诊断（标记录入） ---------------- */

const MARK_OPTIONS = [
  { value: 'unknown', label: '未确认' },
  { value: 'occurred', label: '已确认发生' },
  { value: 'absent', label: '已确认未发生' },
];

function renderDiagnosis() {
  diagListEl.innerHTML = '';
  const named = state.basics.filter((b) => b.name.trim());
  if (named.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'chip-empty';
    empty.textContent = '请先在第 1 步定义基础故障并填写先验概率。';
    diagListEl.appendChild(empty);
    return;
  }

  named.forEach((b) => {
    const row = document.createElement('div');
    row.className = 'diag-row';

    const name = document.createElement('span');
    name.className = 'diag-name';
    name.textContent = b.name.trim();

    const prior = document.createElement('span');
    prior.className = 'diag-prior';
    prior.textContent = `先验 ${b.prior === '' ? '未填' : b.prior}`;

    const seg = document.createElement('div');
    seg.className = 'seg';
    MARK_OPTIONS.forEach(({ value, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      if (b.mark === value) btn.classList.add(`active-${value}`);
      btn.addEventListener('click', () => {
        b.mark = value;
        renderDiagnosis();
      });
      seg.appendChild(btn);
    });

    row.append(name, prior, seg);
    diagListEl.appendChild(row);
  });
}

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
  contradictionPanel.hidden = true;
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
  contradictionPanel.hidden = true;
  errorPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showResults(topEvent, combinations) {
  errorPanel.hidden = true;
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

/* ---------------- 现场诊断（后验概率） ---------------- */

function buildDiagnosePayload() {
  const priors = {};
  const evidence = {};
  state.basics.forEach((b) => {
    const name = b.name.trim();
    if (!name) return;
    // 未填写时传 null，由后端统一报「缺少有效的先验概率」
    priors[name] = b.prior === '' ? null : Number(b.prior);
    if (b.mark === 'occurred') evidence[name] = 'occurred';
    else if (b.mark === 'absent') evidence[name] = 'absent';
  });
  return { ...buildPayload(), priors, evidence };
}

function fmtPct(x, digits = 1) {
  const pct = x * 100;
  if (pct > 0 && pct < 10 ** -digits) return `<${10 ** -digits}%`;
  return `${pct.toFixed(digits)}%`;
}

function showContradiction(errors) {
  errorPanel.hidden = true;
  diagPanel.hidden = true;
  contradictionMsg.textContent = errors.join(' ');
  contradictionPanel.hidden = false;
  contradictionPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showDiagnosis(data) {
  contradictionPanel.hidden = true;
  diagPanel.hidden = false;

  diagSummary.textContent =
    `已知顶层故障「${data.topEvent}」确已发生，且与现场标记一致：` +
    `精确枚举 ${data.statesEnumerated} 个状态组合，` +
    `证据概率 P = ${fmtPct(data.evidenceProbability, 2)}。` +
    `各未确认基础故障的后验发生概率（按概率降序）：`;

  diagResultList.innerHTML = '';
  if (data.posteriors.length === 0) {
    const li = document.createElement('li');
    li.textContent = '所有基础故障均已有现场确认标记，无待诊断项。';
    diagResultList.appendChild(li);
  }

  data.posteriors.forEach(({ name, probability }) => {
    const li = document.createElement('li');

    const chip = document.createElement('span');
    chip.className = 'fault-chip';
    chip.textContent = name;

    const bar = document.createElement('span');
    bar.className = 'prob-bar';
    const fill = document.createElement('span');
    fill.style.width = `${(probability * 100).toFixed(2)}%`;
    bar.appendChild(fill);

    const pct = document.createElement('span');
    pct.className = 'prob-value';
    pct.textContent = fmtPct(probability);

    li.append(chip, bar, pct);
    diagResultList.appendChild(li);
  });

  diagPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function diagnose() {
  hidePanels();
  try {
    const resp = await fetch('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDiagnosePayload()),
    });
    const data = await resp.json();
    if (resp.status === 422 && data.contradiction) {
      showContradiction(data.errors || ['证据概率为零，观测与模型矛盾。']);
      return;
    }
    if (!resp.ok || !data.ok) {
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
    { uid: uid('b'), name: '主电源中断', prior: '0.02', mark: 'unknown' },
    { uid: uid('b'), name: '备用电源失效', prior: '0.05', mark: 'unknown' },
    { uid: uid('b'), name: '冷却泵停转', prior: '0.08', mark: 'unknown' },
    { uid: uid('b'), name: '散热风扇损坏', prior: '0.1', mark: 'unknown' },
    { uid: uid('b'), name: '人员误操作', prior: '0.01', mark: 'unknown' },
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
