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

// 现场诊断：已知顶层故障确已发生时，计算各未确认基础故障的后验概率
app.post('/api/diagnose', (req, res) => {
  try {
    const result = diagnoseFaultTree(req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.validationErrors) {
      return res.status(400).json({ ok: false, errors: err.validationErrors });
    }
    if (err.contradiction) {
      // 证据概率为 0：观测与模型矛盾
      return res
        .status(409)
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
