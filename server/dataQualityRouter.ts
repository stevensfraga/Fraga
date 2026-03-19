import { Router } from 'express';
import { generateDataQualityReport } from './services/dataQualityService';

const router = Router();

/**
 * GET /api/test/data-quality/report
 * Retorna relatório completo de qualidade de dados
 * Identifica bloqueios estruturais que impedem envios
 */
router.get('/report', async (req, res) => {
  try {
    const report = await generateDataQualityReport();
    res.json(report);
  } catch (error) {
    console.error('[DataQualityRouter] Error:', error);
    res.status(500).json({ error: 'Failed to generate data quality report' });
  }
});

/**
 * GET /api/test/data-quality/summary
 * Retorna apenas o sumário (sem listas detalhadas)
 */
router.get('/summary', async (req, res) => {
  try {
    const report = await generateDataQualityReport();
    res.json({
      timestamp: new Date().toISOString(),
      summary: report.summary,
      blockedCounts: {
        missingDocument: report.missingDocument.length,
        invalidWhatsappSource: report.invalidWhatsappSource.length,
        invalidReceivableSource: report.invalidReceivableSource.length,
      },
    });
  } catch (error) {
    console.error('[DataQualityRouter] Error:', error);
    res.status(500).json({ error: 'Failed to generate data quality summary' });
  }
});

export default router;
