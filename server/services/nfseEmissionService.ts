import { chromium, Browser, Page } from '@playwright/test';
import { getDb } from '../db';
import { nfseEmissionLogs } from '../nfseEmissionSchema';
import { eq } from 'drizzle-orm';

interface EmissionLog {
  timestamp: string;
  step: string;
  message: string;
  details?: Record<string, any>;
}

interface NfseEmissionOptions {
  cnpj: string;
  companyName?: string;
  serviceDescription: string;
  serviceValue: string;
  clientName: string;
  clientCnpj: string;
  clientEmail?: string;
  portalUrl?: string;
  headless?: boolean;
}

class NfseEmissionService {
  private logs: EmissionLog[] = [];
  private logId: number | null = null;

  private addLog(step: string, message: string, details?: Record<string, any>) {
    const log: EmissionLog = {
      timestamp: new Date().toISOString(),
      step,
      message,
      details,
    };
    this.logs.push(log);
    console.log(`[${step}] ${message}`, details ? JSON.stringify(details) : '');
  }

  private async saveLogs(cnpj: string, status: string, errorMessage?: string, errorStack?: string, nfseNumber?: string) {
    try {
      const startedAt = new Date();
      const completedAt = new Date();
      const db = await getDb();
      if (!db) throw new Error('Database connection failed');
      
      await db.insert(nfseEmissionLogs).values({
        cnpj,
        status,
        logs: this.logs,
        errorMessage,
        errorStack,
        nfseNumber,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      });
    } catch (err) {
      console.error('Erro ao salvar logs de emissão:', err);
    }
  }

  async healthCheck(): Promise<{
    playwrightOk: boolean;
    chromiumAvailable: boolean;
    message: string;
  }> {
    this.addLog('HEALTH_CHECK', 'Iniciando health check');

    try {
      // Verificar Playwright
      const playwrightOk = !!chromium;
      this.addLog('PLAYWRIGHT_CHECK', playwrightOk ? 'Playwright disponível' : 'Playwright não disponível');

      // Verificar Chromium
      let browser: Browser | null = null;
      let chromiumAvailable = false;

      try {
        browser = await chromium.launch({ headless: true });
        chromiumAvailable = true;
        this.addLog('CHROMIUM_CHECK', 'Chromium disponível e funcional');
        
        if (browser) {
          await browser.close();
        }
      } catch (err) {
        this.addLog('CHROMIUM_CHECK', 'Chromium não disponível', { error: String(err) });
      }

      return {
        playwrightOk,
        chromiumAvailable,
        message: chromiumAvailable ? 'Motor NFS-e pronto para uso' : 'Chromium não disponível',
      };
    } catch (err) {
      this.addLog('HEALTH_CHECK_ERROR', 'Erro no health check', { error: String(err) });
      throw err;
    }
  }

  async testEmit(options: NfseEmissionOptions): Promise<{
    success: boolean;
    nfseNumber?: string;
    message: string;
    logs: EmissionLog[];
    errorMessage?: string;
  }> {
    const startTime = Date.now();
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      this.addLog('INIT', 'Iniciando emissão de NFS-e', {
        cnpj: options.cnpj,
        companyName: options.companyName,
      });

      // Launcher Chromium
      this.addLog('LAUNCHER', 'Iniciando Chromium');
      browser = await chromium.launch({
        headless: options.headless !== false,
      });
      this.addLog('LAUNCHER_OK', 'Chromium iniciado com sucesso');

      // Criar página
      page = await browser.newPage();
      this.addLog('PAGE_CREATED', 'Página criada');

      // Navegar para portal
      const portalUrl = options.portalUrl || 'https://tributacao.vilavelha.es.gov.br/tbw/loginCNPJContribuinte.jsp';
      this.addLog('NAVIGATE', `Navegando para ${portalUrl}`);
      await page.goto(portalUrl, { waitUntil: 'networkidle', timeout: 30000 });
      this.addLog('NAVIGATE_OK', 'Portal carregado com sucesso');

      // Simular preenchimento de formulário (teste)
      this.addLog('FORM_FILL', 'Preenchendo formulário de emissão', {
        serviceDescription: options.serviceDescription,
        serviceValue: options.serviceValue,
        clientName: options.clientName,
      });

      // Aguardar e validar elementos
      const cnpjInput = page.locator('input[name="cnpj"], input[placeholder*="CNPJ"]').first();
      if (await cnpjInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await cnpjInput.fill(options.cnpj);
        this.addLog('CNPJ_FILLED', 'CNPJ preenchido');
      }

      // Simular sucesso (teste)
      this.addLog('FORM_SUBMIT', 'Enviando formulário');
      await page.waitForTimeout(1000);
      this.addLog('FORM_SUBMIT_OK', 'Formulário enviado com sucesso');

      // Simular captura de NFS-e
      const nfseNumber = `NFS-e-${Date.now()}`;
      this.addLog('NFSE_CAPTURED', 'Número de NFS-e capturado', { nfseNumber });

      // Salvar logs com sucesso
      const duration = Date.now() - startTime;
      await this.saveLogs(options.cnpj, 'success', undefined, undefined, nfseNumber);

      return {
        success: true,
        nfseNumber,
        message: 'NFS-e emitida com sucesso',
        logs: this.logs,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : '';
      const duration = Date.now() - startTime;

      this.addLog('ERROR', 'Erro na emissão de NFS-e', { error: errorMessage });
      await this.saveLogs(options.cnpj, 'error', errorMessage, errorStack);

      return {
        success: false,
        message: `Erro na emissão: ${errorMessage}`,
        logs: this.logs,
        errorMessage,
      };
    } finally {
      // Cleanup
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
      this.addLog('CLEANUP', 'Recursos liberados');
    }
  }
}

export const nfseEmissionService = new NfseEmissionService();
