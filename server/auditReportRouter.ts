import { Router } from 'express';
import { generateAuditReport } from './services/auditReportService';

const router = Router();

// Note: Auth middleware is handled by dispatchTestRouter parent

/**
 * GET /api/test/audit-report
 * Gerar relatório de auditoria (dry-run)
 * Identifica todos os bloqueios sem enviar mensagens
 */
router.get('/audit-report', async (req: any, res: any) => {
  try {
    console.log('[AuditReport] Gerando relatório de auditoria...');
    const report = await generateAuditReport();
    
    console.log('[AuditReport] Relatório gerado:');
    console.log(`  Total receivables: ${report.total_receivables}`);
    console.log(`  Total elegíveis: ${report.total_eligible}`);
    console.log(`  Total bloqueados: ${report.total_blocked}`);
    console.log(`  Bloqueios por motivo:`, report.blocked_breakdown);
    console.log(`  Números duplicados: ${report.top_duplicates.length}`);
    console.log(`  Clientes sem documento: ${report.without_document.length}`);
    console.log(`  Receivables com source inválido: ${report.invalid_source_receivables.length}`);
    
    res.json(report);
  } catch (error: any) {
    console.error(`[AuditReport] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/test/audit-report/summary
 * Resumo executivo do relatório
 */
router.get('/audit-report/summary', async (req: any, res: any) => {
  try {
    const report = await generateAuditReport();
    
    const summary = {
      timestamp: report.timestamp,
      metrics: {
        total_receivables: report.total_receivables,
        total_eligible: report.total_eligible,
        total_blocked: report.total_blocked,
        blocked_percentage: report.total_receivables > 0 
          ? ((report.total_blocked / report.total_receivables) * 100).toFixed(2) + '%'
          : '0%',
      },
      blocked_breakdown: report.blocked_breakdown,
      top_issues: [
        {
          issue: 'Sem documento',
          count: report.blocked_breakdown.no_document,
          affected_clients: report.without_document.length,
        },
        {
          issue: 'Números duplicados',
          count: report.blocked_breakdown.duplicate_phone,
          affected_groups: report.top_duplicates.length,
        },
        {
          issue: 'Source inválido',
          count: report.blocked_breakdown.invalid_source,
          affected_receivables: report.invalid_source_receivables.length,
        },
        {
          issue: 'Opt-out',
          count: report.blocked_breakdown.opt_out,
        },
        {
          issue: 'Sem WhatsApp',
          count: report.blocked_breakdown.no_whatsapp,
        },
        {
          issue: 'Test data',
          count: report.blocked_breakdown.test_data,
        },
      ],
    };
    
    res.json(summary);
  } catch (error: any) {
    console.error(`[AuditReport] Error: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
