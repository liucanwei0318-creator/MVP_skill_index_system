import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { experimentRunnerManager } from './src/services/experimentRunnerService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

// API: 获取历史运行所有实验记录列表
app.get('/api/experiment/runs', (req, res) => {
  try {
    const runs = experimentRunnerManager.getHistoryRuns();
    return res.json({ success: true, runs });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 获取指定历史运行实验的完整数据
app.get('/api/experiment/runs/:runId', (req, res) => {
  try {
    const { runId } = req.params;
    const detail = experimentRunnerManager.getRunDetail(runId);
    if (!detail) {
      return res.status(404).json({ success: false, message: '未找到该历史实验记录' });
    }
    return res.json({ success: true, detail });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 更新历史实验记录备注与名称
app.post('/api/experiment/runs/:runId/note', (req, res) => {
  try {
    const { runId } = req.params;
    const { note, name } = req.body;
    const ok = experimentRunnerManager.updateRunNote(runId, note || '', name);
    return res.json({ success: ok });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 删除指定的历史实验记录
app.delete('/api/experiment/runs/:runId', (req, res) => {
  try {
    const { runId } = req.params;
    const ok = experimentRunnerManager.deleteRun(runId);
    return res.json({ success: ok });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 将指定历史实验数据恢复为当前活跃基准
app.post('/api/experiment/runs/:runId/restore', (req, res) => {
  try {
    const { runId } = req.params;
    const ok = experimentRunnerManager.restoreRunAsCurrent(runId);
    return res.json({ success: ok });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 获取实验运行实时状态与进度
app.get('/api/experiment/status', (req, res) => {
  try {
    const progress = experimentRunnerManager.getProgress();
    return res.json({ success: true, progress });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 触发运行新实验
app.post('/api/experiment/run', async (req, res) => {
  try {
    const { name, note, mode, caseIds, iterations, topK, maxDepth } = req.body || {};
    const runId = await experimentRunnerManager.runExperiment({
      name,
      note,
      mode,
      caseIds,
      iterations,
      topK,
      maxDepth,
    });
    return res.json({
      success: true,
      runId,
      message: '实验任务已成功提交并启动',
      progress: experimentRunnerManager.getProgress(),
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// API: 中止正在运行的实验
app.post('/api/experiment/cancel', (req, res) => {
  try {
    const cancelled = experimentRunnerManager.cancelExperiment();
    return res.json({ success: true, cancelled });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 获取最新长对话错误率对比实验数据
app.get('/api/experiment/results', (req, res) => {
  try {
    const summaryPath = path.join(__dirname, 'experiments/results/evaluation_summary.json');
    const tracesPath = path.join(__dirname, 'experiments/results/evaluation_traces.json');
    const reportPath = path.join(__dirname, 'experiments/reports/EXPERIMENT_REPORT_BENCHMARK.md');
    const benchmarkPath = path.join(__dirname, 'experiments/benchmarks/benchmark_dataset.json');

    if (fs.existsSync(summaryPath) && fs.existsSync(tracesPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      const traces = JSON.parse(fs.readFileSync(tracesPath, 'utf8'));
      const reportMarkdown = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
      const benchmark = fs.existsSync(benchmarkPath) ? JSON.parse(fs.readFileSync(benchmarkPath, 'utf8')) : [];
      return res.json({
        success: true,
        summary,
        traces,
        benchmark,
        reportMarkdown,
      });
    } else {
      return res.status(404).json({ success: false, message: '尚未生成实验结果' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// API: 直接下载 Word 文档 (.docx)
app.get('/api/experiment/download/docx', (req, res) => {
  const docxPath = path.join(__dirname, 'experiments/reports/Skill_Index_System_Benchmark_Report.docx');
  if (!fs.existsSync(docxPath)) {
    return res.status(404).json({ error: 'Word 文档尚未生成' });
  }
  res.setHeader('Content-Disposition', 'attachment; filename="Skill_Index_System_Benchmark_Report.docx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return fs.createReadStream(docxPath).pipe(res);
});

// API: 直接下载存储的 JSON 文件
app.get('/api/experiment/download/:fileKey', (req, res) => {
  const { fileKey } = req.params;
  const fileMap: Record<string, { path: string; filename: string }> = {
    summary: {
      path: path.join(__dirname, 'experiments/results/evaluation_summary.json'),
      filename: 'evaluation_summary.json',
    },
    traces: {
      path: path.join(__dirname, 'experiments/results/evaluation_traces.json'),
      filename: 'evaluation_traces.json',
    },
    benchmark: {
      path: path.join(__dirname, 'experiments/benchmarks/benchmark_dataset.json'),
      filename: 'benchmark_dataset.json',
    },
  };

  const fileConfig = fileMap[fileKey];
  if (!fileConfig || !fs.existsSync(fileConfig.path)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${fileConfig.filename}"`);
  res.setHeader('Content-Type', 'application/json');
  return fs.createReadStream(fileConfig.path).pipe(res);
});

// API 路由：智能体对话与技能驱动生成
app.post('/api/agent/chat', async (req, res) => {
  try {
    const { messages, systemInstruction, toolExecutionSummary, model = 'gemini-3.1-flash-lite' } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.json({
        fallback: true,
        message: '系统当前未注入 GEMINI_API_KEY，自动启用内置的高保真 Agent 逻辑引擎。',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const rawMessages = Array.isArray(messages) ? [...messages] : [{ role: 'user', content: String(messages) }];

    const lastUserIdx = rawMessages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx !== -1 && toolExecutionSummary) {
      rawMessages[lastUserIdx] = {
        role: 'user',
        content: `${rawMessages[lastUserIdx].content}\n\n【底层挂载技能真实执行产出 (Verified Tool Outputs)】:\n${toolExecutionSummary}\n\n【指示】：请以专业智能体的口吻，充分结合并直接呈现上述技能工具执行的真实结果，向用户作出详尽、准确、条理清晰的业务汇报与解答。`,
      };
    }

    const contents = rawMessages.map((m: any) => ({
      role: m.role === 'agent' ? 'model' : m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content || m.text || '' }],
    }));

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents,
      config: {
        systemInstruction:
          systemInstruction ||
          '你是一个由 Skill Index System（技能索引系统）赋能的高级智能体。请以专业、可靠、严谨的口吻回答用户提问。',
      },
    });

    return res.json({
      fallback: false,
      message: response.text || '（Agent 已处理指令但无直接文本反馈）',
    });
  } catch (err: any) {
    console.error('Agent chat error:', err);
    return res.json({
      fallback: true,
      error: err.message,
      message: `与底层大模型通信时发生异常（${err.message?.slice(0, 80)}），已回退至本地可信工作流引擎保障业务连续性。`,
    });
  }
});

// 静态资源托管或开发环境 Vite 中间件挂载
  const isProduction = process.env.NODE_ENV === 'production';
  const distDir = path.join(__dirname, 'dist');
  const distIndex = path.join(distDir, 'index.html');

  if (isProduction && fs.existsSync(distIndex)) {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      res.sendFile(distIndex);
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SIS Backend Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
