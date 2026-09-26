'use strict';

const path = require('path');
const express = require('express');
const { analyzeFaultTree } = require('./faultTree');
const { diagnoseFaultTree } = require('./diagnosis');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查（供容器 HEALTHCHECK / 编排探活使用）
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// 计算顶层故障的最小基础故障组合（最小割集）
app.post('/api/analyze', (req, res) => {
  try {
    const result = analyzeFaultTree(req.body);
    res.json({
      ok: true,
      topEvent: result.topEvent,
      count: result.combinations.length,
      combinations: result.combinations,
    });
  } catch (err) {
    if (err.validationErrors) {
      return res.status(400).json({ ok: false, errors: err.validationErrors });
    }
    console.error(err);
    res.status(500).json({ ok: false, errors: ['服务器内部错误。'] });
  }
});

// 现场诊断：已知顶层故障确已发生，按先验概率与现场标记计算后验概率
app.post('/api/diagnose', (req, res) => {
  try {
    const result = diagnoseFaultTree(req.body);
    res.json({
      ok: true,
      topEvent: result.topEvent,
      evidenceProbability: result.evidenceProbability,
      statesEnumerated: result.statesEnumerated,
      posteriors: result.posteriors,
    });
  } catch (err) {
    if (err.validationErrors) {
      return res.status(400).json({ ok: false, errors: err.validationErrors });
    }
    if (err.contradiction) {
      // 观测与模型矛盾：证据概率为零，无法归一化得到后验
      return res
        .status(422)
        .json({ ok: false, contradiction: true, errors: [err.message] });
    }
    console.error(err);
    res.status(500).json({ ok: false, errors: ['服务器内部错误。'] });
  }
});

app.listen(PORT, () => {
  console.log(`停机原因分析服务已启动: http://localhost:${PORT}`);
});

module.exports = app;
