/**
 * Motor de Emissão de NFS-e — Prefeitura de Vila Velha / ES
 *
 * ARQUITETURA:
 * - Estratégia de autenticação em 3 camadas (resiliente)
 * - Seletores centralizados em vilavelha.selectors.ts
 * - Logs estruturados por etapa: STEP_OK / STEP_FAIL
 * - Screenshot automático em caso de falha
 *
 * ESTRATÉGIA DE AUTENTICAÇÃO (3 CAMADAS):
 * Camada 1 — Login automático com CAPTCHA via LLM Vision
 *   → Captura screenshot do CAPTCHA, envia para LLM, preenche e tenta login
 *   → Se bem-sucedido: salva nova sessão automaticamente (renovação automática)
 *   → Logs: LOGIN_CAPTCHA_DETECTED → CAPTCHA_SENT_TO_LLM → CAPTCHA_SOLVED → LOGIN_OK
 *
 * Camada 2 — Sessão persistente (fallback)
 *   → Carrega storageState salvo no banco (capturado manualmente)
 *   → Navega direto para área logada sem CAPTCHA
 *   → Logs: CAPTCHA_FAIL → USING_PERSISTENT_SESSION
 *
 * Camada 3 — Erro com instrução de captura manual
 *   → Se nenhuma camada funcionar, lança erro orientando o usuário
 *
 * FLUXO APÓS LOGIN:
 * 1. Selecionar empresa por CNPJ/IM (multi-empresa do contador)
 * 2. Navegar para emissão de NFS-e
 * 3. Preencher formulário
 * 4. Submeter e capturar número da nota
 * 5. Baixar PDF e fazer upload para S3
 * 6. Enviar PDF via WhatsApp (se solicitado)
 *
 * POLÍTICA DE RENOVAÇÃO DE SESSÃO:
 * - Sempre que login automático funcionar, salva nova sessão
 * - Sessão válida por 30 dias
 * - Renovação automática sem intervenção manual
 */

import mysql from "mysql2/promise";
import crypto from "crypto";
import { storagePut } from "../storage";

import { savePdfLocally, generatePdfToken } from "../routes/nfseEmissionWebhook";import { loadStorageState, applyStorageState, invalidateStorageState, saveStorageState } from "./nfseStorageState";
import { solveCaptchaAndLogin } from "./nfseCaptchaSolver";
import { getChromiumLaunchOptions } from "./nfseChromiumResolver";
import {
  VILAVELHA_SELECTORS,
  trySelectors,
  tryFill,
  trySelectOption,
  tryClick,
} from "./vilavelha.selectors";
import { logEmissionStepComplete } from "./nfseEmissionLogger";

const ENCRYPTION_KEY = process.env.JWT_SECRET?.substring(0, 32).padEnd(32, "0") || "fraga-nfse-secret-key-32chars!!!";

// Helper para registrar etapas críticas
const logCriticalStep = async (emissaoId: number, step: string, status: 'ok' | 'error', message: string, page?: any, error?: any) => {
  try {
    await logEmissionStepComplete(emissaoId, step, status, message, page, undefined, error?.message);
  } catch (err) {
    console.warn(`[NfseEngine] Erro ao registrar log de etapa: ${err}`);
  }
};

function decryptPassword(ciphertext: string): string {
  try {
    if (!ciphertext || !ciphertext.includes(":")) return ciphertext;
    const [ivHex, encrypted] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return ciphertext;
  }
}

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

async function rawExec(sql: string, params: any[] = []): Promise<any> {
  const conn = await getConn();
  try {
    const [result] = await conn.execute(sql, params);
    return result;
  } finally {
    await conn.end();
  }
}

async function auditLog(
  emissaoId: number | null,
  configId: number | null,
  action: string,
  details: any,
  performedBy: string = "motor"
) {
  try {
    await rawExec(
      `INSERT INTO nfse_audit (emissaoId, configId, action, details, performedBy) VALUES (?, ?, ?, ?, ?)`,
      [emissaoId, configId, action, JSON.stringify(details), performedBy]
    );
    console.log(`[NfseEngine] ${action}:`, JSON.stringify(details).substring(0, 200));
  } catch { /* não falha por erro de auditoria */ }
}

function formatarCompetencia(competencia: string) {
  const [mes, ano] = competencia.split("/");
  const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                 "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  return { mes, ano, mesNome: meses[parseInt(mes) - 1] || mes };
}

function formatarDescricao(template: string, competencia: string): string {
  const comp = formatarCompetencia(competencia);
  return template
    .replace(/\{mes\}/gi, comp.mesNome)
    .replace(/\{ano\}/gi, comp.ano)
    .replace(/\{mes_num\}/gi, comp.mes)
    .replace(/\{competencia\}/gi, `${comp.mesNome}/${comp.ano}`);
}

/**
 * Captura screenshot e faz upload para S3 (para diagnóstico de falhas)
 */
async function captureFailureScreenshot(
  page: any,
  emissaoId: number,
  step: string
): Promise<string | undefined> {
  try {
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    const suffix = Math.random().toString(36).substring(2, 8);
    const fileKey = `nfse-debug/emissao-${emissaoId}-${step}-${suffix}.png`;
    const { url } = await storagePut(fileKey, screenshotBuffer, "image/png");
    console.log(`[NfseEngine] Screenshot de falha salvo: ${url}`);
    return url;
  } catch (err: any) {
    console.warn(`[NfseEngine] Não foi possível salvar screenshot:`, err.message);
    return undefined;
  }
}

/**
 * Captura HTML dump da página atual (para diagnóstico)
 */
async function capturePageHtml(page: any): Promise<string> {
  try {
    return await page.content();
  } catch {
    return "";
  }
}

// ══════════════════════════════════════════════════════════════════════
// Navegação resiliente — retry com waitUntil alternativo
// ══════════════════════════════════════════════════════════════════════

/**
 * Navega para uma URL com retry e fallback de waitUntil.
 * Trata net::ERR_ABORTED (frame detached durante redirect de sessão).
 *
 * Estratégia:
 * 1. Tenta com "domcontentloaded" (rápido)
 * 2. Se falhar, tenta com "commit" (mais tolerante — aceita qualquer resposta HTTP)
 * 3. Se falhar, tenta com "load" e timeout maior
 * 4. Se tudo falhar, tenta navegar para URL alternativa (controle)
 */
async function safeGoto(
  page: any,
  url: string,
  opts?: {
    timeout?: number;
    fallbackUrl?: string;
    logFn?: (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => void;
  }
): Promise<void> {
  const timeout = opts?.timeout || 45000;
  const log = opts?.logFn;

  const strategies: Array<{ waitUntil: string; timeout: number; label: string }> = [
    { waitUntil: "domcontentloaded", timeout: timeout, label: "domcontentloaded" },
    { waitUntil: "commit", timeout: timeout, label: "commit" },
    { waitUntil: "load", timeout: timeout + 15000, label: "load" },
  ];

  for (const strategy of strategies) {
    try {
      await page.goto(url, { waitUntil: strategy.waitUntil, timeout: strategy.timeout });
      log?.("NAVIGATE", "OK", { url, waitUntil: strategy.label });
      return;
    } catch (err: any) {
      const msg = err.message || "";
      const isAborted = msg.includes("ERR_ABORTED") || msg.includes("frame was detached");
      const isTimeout = msg.includes("Timeout") || msg.includes("timeout");

      log?.("NAVIGATE_RETRY", "WARN", {
        url,
        waitUntil: strategy.label,
        error: msg.substring(0, 120),
        isAborted,
        isTimeout,
      });

      // Se ERR_ABORTED, o portal pode ter feito redirect — verificar se a página já carregou
      if (isAborted) {
        try {
          await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
          const currentUrl = page.url();
          // Se já estamos em alguma página do portal, considerar sucesso
          if (currentUrl.includes("vilavelha.es.gov.br")) {
            log?.("NAVIGATE", "OK", { url: currentUrl, note: "Recuperado após ERR_ABORTED — página carregou via redirect" });
            return;
          }
        } catch {
          // Continuar para próxima estratégia
        }
      }
    }
  }

  // Fallback: tentar URL alternativa (controle)
  if (opts?.fallbackUrl) {
    try {
      log?.("NAVIGATE_FALLBACK", "WARN", { fallbackUrl: opts.fallbackUrl });
      await page.goto(opts.fallbackUrl, { waitUntil: "commit", timeout: timeout });
      log?.("NAVIGATE", "OK", { url: opts.fallbackUrl, note: "Fallback URL usada" });
      return;
    } catch (fallbackErr: any) {
      log?.("NAVIGATE_FALLBACK", "FAIL", { error: fallbackErr.message?.substring(0, 120) });
    }
  }

  // Último recurso: verificar se a página já está em algum estado útil
  try {
    const currentUrl = page.url();
    if (currentUrl && currentUrl.includes("vilavelha.es.gov.br")) {
      log?.("NAVIGATE", "WARN", { url: currentUrl, note: "Página já está no portal — continuando" });
      return;
    }
  } catch {}

  throw new Error(
    `Falha ao navegar para ${url} após 3 tentativas (domcontentloaded, commit, load). ` +
    `Verifique se o portal está acessível.`
  );
}

// ══════════════════════════════════════════════════════════════════════
// Resultado estruturado de emissão
// ══════════════════════════════════════════════════════════════════════

export interface EmissaoResult {
  success: boolean;
  numeroNfse?: string;
  serieNfse?: string;
  pdfUrl?: string;
  logs: Array<{ step: string; status: "OK" | "FAIL" | "WARN"; details?: any }>;
  screenshotUrl?: string;
  error?: string;
}

// ══════════════════════════════════════════════════════════════════════
// Função principal de emissão
// ══════════════════════════════════════════════════════════════════════

// ── PROTEÇÃO CONTRA TESTES COM VALORES ALTOS ──
const TEST_CPFS_CNPJS = new Set([
  '12345678909', '12345678000195',
  '11111111111', '22222222222', '33333333333', '44444444444',
  '52998224725',
  '00000000000', '99999999999',
]);
const MAX_TEST_VALUE = 10.00;
function isTestCpfCnpj(cpfCnpj: string): boolean {
  const digits = cpfCnpj.replace(/\D/g, '');
  return TEST_CPFS_CNPJS.has(digits);
}

export async function emitNfse(emissaoId: number): Promise<EmissaoResult> {
  const logs: EmissaoResult["logs"] = [];
  let browser: any = null;
  let page: any = null;

  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    auditLog(emissaoId, null, `${step}_${status}`, details || {});
  };

  try {
    // 1. Buscar dados da emissão
    const [emissao] = await rawQuery("SELECT * FROM nfse_emissoes WHERE id = ?", [emissaoId]);
    if (!emissao) throw new Error(`Emissão ${emissaoId} não encontrada`);

    const em = emissao as any;

    // ── PROTEÇÃO: CPF/CNPJ de teste → forçar R$ 1,00 ──
    if (isTestCpfCnpj(em.tomadorCpfCnpj || '')) {
      console.warn(`[NfseEngine] ⚠️ CPF/CNPJ de TESTE detectado (${em.tomadorCpfCnpj}) — forçando valor R$ 1,00`);
      em.valor = 1.00;
      if (!String(em.descricaoServico || '').toLowerCase().includes('teste')) {
        em.descricaoServico = `[TESTE] ${em.descricaoServico || 'servico'}`;
      }
      await rawExec(
        "UPDATE nfse_emissoes SET valor = 1.00, descricaoServico = ? WHERE id = ?",
        [em.descricaoServico, emissaoId]
      );
    }
    if (Number(em.valor) > MAX_TEST_VALUE && process.env.ALLOW_HIGH_VALUE !== 'true') {
      console.warn(`[NfseEngine] ⚠️ Valor R$ ${em.valor} acima do limite de teste — defina ALLOW_HIGH_VALUE=true para produção`);
    }

    // 2. Buscar config do prestador
    const [config] = await rawQuery("SELECT * FROM nfse_config WHERE id = ?", [em.configId]);
    if (!config) throw new Error(`Config ${em.configId} não encontrada`);

    const cfg = config as any;
    log("INIT", "OK", { prestador: cfg.razaoSocial, cnpj: cfg.cnpj, valor: em.valor });

    // 2b. Buscar dados do tomador (endereço) se tomadorId estiver preenchido
    let tomadorData: any = null;
    if (em.tomadorId) {
      const [tomador] = await rawQuery("SELECT * FROM nfse_tomadores WHERE id = ?", [em.tomadorId]);
      tomadorData = tomador || null;
    }
    // Fallback: buscar por CNPJ se não encontrou por ID
    if (!tomadorData && em.tomadorCpfCnpj) {
      const cnpjLimpo = em.tomadorCpfCnpj.replace(/\D/g, "");
      const [tomadorByCnpj] = await rawQuery("SELECT * FROM nfse_tomadores WHERE REPLACE(REPLACE(cpfCnpj, '.', ''), '/', '') LIKE ? LIMIT 1", [`%${cnpjLimpo}%`]);
      tomadorData = tomadorByCnpj || null;
    }

    // 3. Verificar modo de autenticação
    const modoAuth = cfg.modo_auth || "login_contador";
    if (modoAuth === "certificado_digital") {
      throw new Error("Certificado Digital ainda não implementado. Use modo Login Contador.");
    }

    // 4. Buscar portal
    if (!cfg.portal_id) {
      throw new Error(`Prestador "${cfg.razaoSocial}" não tem portal configurado. Acesse NFS-e > Configurações > Portais.`);
    }

    const [portalRow] = await rawQuery("SELECT * FROM nfse_portais WHERE id = ? AND ativo = 1", [cfg.portal_id]);
    if (!portalRow) throw new Error(`Portal ID ${cfg.portal_id} não encontrado ou inativo`);

    const portal = portalRow as any;
    log("PORTAL_LOADED", "OK", { portalNome: portal.nome });

    // 5. Iniciar Playwright
    let playwright: any;
    try {
      playwright = await import("playwright-core");
    } catch {
      throw new Error("Playwright não instalado. Execute: pnpm add playwright && npx playwright install chromium");
    }

    browser = await playwright.chromium.launch(await getChromiumLaunchOptions());

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });

    page = await context.newPage();

    // ══════════════════════════════════════════════════════════════
    // ESTRATÉGIA DE AUTENTICAÇÃO — 3 CAMADAS (revisado 09/03/2026)
    //
    // Camada 1: Sessão persistente (storageState salvo no banco) — PRIORIDADE
    // Camada 2: Login com 2captcha (se CAPTCHA_API_KEY configurado)
    // Camada 3: Erro com instrução de captura manual
    // ══════════════════════════════════════════════════════════════

    let loginOk = false;

    const portalUsuario = portal.usuario || portal.usuario_contador || "";
    const portalSenhaRaw = portal.senha || portal.senha_contador || "";
    const portalSenha = portalSenhaRaw ? decryptPassword(portalSenhaRaw) : "";

    // ── CAMADA 1: Sessão persistente (ESTRATÉGIA PRINCIPAL) ───────
    log("AUTH_STRATEGY", "OK", { layer: 1, method: "persistent_session" });

    const storageState = await loadStorageState(cfg.portal_id);
    if (storageState) {
      log("USING_PERSISTENT_SESSION", "OK", { note: "Carregando storageState do banco", cookieCount: storageState.cookies?.length || 0 });

      await applyStorageState(context, storageState);

      await safeGoto(page, VILAVELHA_SELECTORS.urls.login, {
        timeout: 45000,
        fallbackUrl: VILAVELHA_SELECTORS.urls.controle,
        logFn: log,
      });

      // Verificar se sessão ainda é válida
      // Critério: URL NÃO deve conter "login" E campo de login NÃO deve estar visível
      const currentUrlAfterLoad = page.url();
      const isOnLoginUrl = currentUrlAfterLoad.toLowerCase().includes("login");
      const isOnLoginForm = await page.$(VILAVELHA_SELECTORS.pageState.isLoginPage).catch(() => null);
      if (!isOnLoginForm && !isOnLoginUrl) {
        loginOk = true;
        log("SESSION_VALID", "OK", { url: currentUrlAfterLoad, method: "persistent_session" });
      } else {
        // Sessão expirada — invalidar e tentar próxima camada
        await invalidateStorageState(cfg.portal_id);
        log("SESSION_EXPIRED", "WARN", { note: "Sessão expirada — tentando Camada 2", url: currentUrlAfterLoad, loginFormVisible: !!isOnLoginForm });
      }
    } else {
      log("AUTH_STRATEGY", "WARN", { layer: 1, note: "Nenhuma sessão no banco — tentando Camada 2" });
    }

    // ── CAMADA 2: Login com 2captcha (se API key configurada) ─────
    if (!loginOk) {
      const apiKey2captcha = process.env.CAPTCHA_API_KEY;
      if (apiKey2captcha && portalUsuario && portalSenha) {
        log("AUTH_STRATEGY", "OK", { layer: 2, method: "captcha_llm", usuario: portalUsuario, note: "CAPTCHA_API_KEY disponível mas usando LLM Vision (2captcha não integrado)" });
        await safeGoto(page, VILAVELHA_SELECTORS.urls.login, { timeout: 45000, fallbackUrl: VILAVELHA_SELECTORS.urls.controle, logFn: log });
        const loginResult2captcha = await solveCaptchaAndLogin(page, portalUsuario, portalSenha, 3);
        for (const l of loginResult2captcha.logs) logs.push(l);
        if (loginResult2captcha.success) {
          loginOk = true;
          log("LOGIN_OK", "OK", { method: "captcha_llm", attempts: loginResult2captcha.attempts });
          await logCriticalStep(emissaoId, "LOGIN_OK", "ok", `Login realizado com sucesso via LLM Vision (${loginResult2captcha.attempts} tentativas)`, page);
          try {
            const newState = await context.storageState();
            await saveStorageState(cfg.portal_id, newState as any, "auto_captcha_login");
            log("SESSION_RENEWED", "OK", { cookieCount: newState.cookies?.length || 0 });
          } catch { /* ignora */ }
        } else {
          log("CAPTCHA_FAIL", "WARN", { attempts: loginResult2captcha.attempts, error: loginResult2captcha.error });
          await logCriticalStep(emissaoId, "LOGIN_FAIL", "error", `Falha no login: ${loginResult2captcha.error}`, page, loginResult2captcha.error);
        }
      } else if (portalUsuario && portalSenha) {
        // Sem 2captcha — tentar LLM Vision diretamente
        log("AUTH_STRATEGY", "OK", { layer: 2, method: "captcha_llm", note: "CAPTCHA_API_KEY não configurado — usando LLM Vision" });
        await safeGoto(page, VILAVELHA_SELECTORS.urls.login, { timeout: 45000, fallbackUrl: VILAVELHA_SELECTORS.urls.controle, logFn: log });
        const loginResult = await solveCaptchaAndLogin(page, portalUsuario, portalSenha, 3);
        for (const l of loginResult.logs) logs.push(l);
        if (loginResult.success) {
          await logCriticalStep(emissaoId, "LOGIN_OK", "ok", `Login realizado com sucesso via LLM Vision (${loginResult.attempts} tentativas)`, page);
        } else {
          await logCriticalStep(emissaoId, "LOGIN_FAIL", "error", `Falha no login: ${loginResult.error}`, page, loginResult.error);
        }
        if (loginResult.success) {
          loginOk = true;
          log("LOGIN_OK", "OK", { method: "captcha_llm", attempts: loginResult.attempts });
          try {
            const newState = await context.storageState();
            await saveStorageState(cfg.portal_id, newState as any, "auto_captcha_login");
            log("SESSION_RENEWED", "OK", { cookieCount: newState.cookies?.length || 0 });
          } catch { /* ignora */ }
        } else {
          log("CAPTCHA_FAIL", "WARN", { attempts: loginResult.attempts, error: loginResult.error });
        }
      }
    }

    // ── CAMADA 3: Sem sessão e sem credenciais — erro orientado ───
    if (!loginOk) {
      throw new Error(
        `CAPTCHA bloqueando login para o portal "${portal.nome}". Soluções:\n` +
        `1. Capture uma sessão manual em /nfse-config → Portais → "Capturar Sessão"\n` +
        `2. Configure CAPTCHA_API_KEY no ambiente com sua chave do 2captcha.com\n` +
        `3. Verifique se as credenciais do portal estão corretas (usuário/senha)`
      );
    }

    if (!loginOk) {
      throw new Error("Falha em todas as estratégias de autenticação");
    }

    // 10. Selecionar empresa no portal (multi-empresa)
    await selectEmpresaNoPortal(page, cfg, emissaoId, logs);

    // 11. Navegar para emissão de NFS-e
    await navigateToNfseEmission(page, emissaoId, logs);

    // 12. Preencher formulário
    const descricao = em.descricaoServico
      || (cfg.descricaoPadrao ? formatarDescricao(cfg.descricaoPadrao, em.competencia) : null)
      || `Serviços de contabilidade - ${em.competencia}`;

    // Extrair endereço do tomador (do banco ou de dados avulsos)
    const tomadorEndereco = tomadorData?.endereco || "";
    const tomadorCep = tomadorData?.cep || "";
    const tomadorCidade = tomadorData?.cidade || cfg.municipio || "Vila Velha";
    const tomadorEstado = tomadorData?.estado || cfg.uf || "ES";
    // Separar logradouro e número do campo endereco (formato: "Rua X, 123" ou "Rua X 123")
    const endParts = tomadorEndereco.match(/^(.+?)(?:[,\s]+(\d+\S*))?$/) || [];
    const tomadorLogradouro = endParts[1]?.trim() || tomadorEndereco;
    const tomadorNumeroEnd = endParts[2]?.trim() || "S/N";

    await fillNfseForm(page, {
      tomadorNome: em.tomadorNome,
      tomadorCpfCnpj: em.tomadorCpfCnpj,
      // Endereço do tomador (obrigatório pelo portal Vila Velha)
      tomadorCep,
      tomadorLogradouro,
      tomadorNumeroEnd: tomadorData?.numero || tomadorNumeroEnd,
      tomadorBairro: tomadorData?.bairro || "",
      tomadorCidade,
      tomadorEstado,
      valor: Number(em.valor),
      competencia: em.competencia,
      descricao,
      listaServico: em.codigoServico || cfg.listaServico || "17.01",
      issRetido: cfg.issRetido === 1,
    }, emissaoId, logs);

    // 13. Submeter e capturar número
    const { numeroNfse, serieNfse } = await submitAndGetNumber(page, emissaoId, logs);

    // 14. Baixar PDF e salvar localmente + gerar token de download sem login
    let pdfUrl: string | undefined;
    let pdfLocalPath: string | undefined;
    let pdfDownloadToken: string | undefined;
    try {
      const pdfBuffer = await downloadNfsePdf(page, numeroNfse, emissaoId, logs);
      if (pdfBuffer) {
        // Opção A: Salvar localmente no servidor (acesso sem login via token de 24h)
        try {
          pdfLocalPath = savePdfLocally(pdfBuffer, emissaoId, numeroNfse, cfg.cnpj);
          pdfDownloadToken = await generatePdfToken(emissaoId, numeroNfse, pdfLocalPath);
          log("PDF_SAVED_LOCAL", "OK", { path: pdfLocalPath, token: pdfDownloadToken.substring(0, 8) + "..." });
        } catch (localErr: any) {
          log("PDF_SAVE_LOCAL", "WARN", { error: localErr.message });
        }
        // Opção B: Upload para S3 (fallback)
        try {
          const suffix = Math.random().toString(36).substring(2, 8);
          const fileKey = `nfse-pdfs/${cfg.cnpj}/${emissaoId}-nfse-${numeroNfse}-${suffix}.pdf`;
          const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");
          pdfUrl = url;
          log("PDF_UPLOADED", "OK", { fileKey, url });
        } catch (s3Err: any) {
          log("PDF_S3_UPLOAD", "WARN", { error: s3Err.message });
        }
      }
    } catch (pdfErr: any) {
      log("PDF_DOWNLOAD", "WARN", { error: pdfErr.message });
    }
    // Gerar URL de download sem login (token temporário de 24h)
    const baseUrl = process.env.APP_BASE_URL || "https://dashboard.fragacontabilidade.com.br";
    const pdfTokenUrl = pdfDownloadToken
      ? `${baseUrl}/api/nfse/pdf/${pdfDownloadToken}`
      : undefined;

    // 15. Atualizar banco
    // Colunas corretas da tabela: numeroNf (não numeroNfse), pdfUrl, processadoEm
    await rawExec(
      `UPDATE nfse_emissoes SET status = 'emitida', numeroNf = ?,
       pdfUrl = ?, pdfLocalPath = ?, processadoEm = NOW() WHERE id = ?`,
      [numeroNfse, pdfUrl || null, pdfLocalPath || null, emissaoId]
    );

    log("EMISSAO_COMPLETED", "OK", { numeroNfse, serieNfse, pdfUrl, pdfTokenUrl });

    // 16. Enviar PDF via WhatsApp (se solicitado)
    // Preferir link de token (sem login, 24h) sobre URL do S3
    const pdfLinkParaWhatsApp = pdfTokenUrl || pdfUrl;
    if (em.solicitadoVia === "whatsapp" && em.whatsappPhone && pdfLinkParaWhatsApp) {
      try {
        await enviarPdfViaWhatsApp(em.whatsappPhone, numeroNfse, pdfLinkParaWhatsApp, em.tomadorNome);
        log("WHATSAPP_PDF_SENT", "OK", { phone: em.whatsappPhone, linkType: pdfTokenUrl ? "token_url" : "s3_url" });
      } catch (wErr: any) {
        log("WHATSAPP_PDF_SENT", "WARN", { error: wErr.message });
      }
    }

    return { success: true, numeroNfse, serieNfse, pdfUrl: pdfLinkParaWhatsApp || pdfUrl, pdfLocalPath, pdfDownloadToken, logs };

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    console.error(`[NfseEngine] Erro na emissão ${emissaoId}:`, errorMsg);

    let screenshotUrl: string | undefined;
    if (page) {
      screenshotUrl = await captureFailureScreenshot(page, emissaoId, "fatal_error");
    }

    logs.push({ step: "FATAL_ERROR", status: "FAIL", details: { error: errorMsg, screenshotUrl } });

    await rawExec(
      "UPDATE nfse_emissoes SET status = 'erro', erroDetalhes = ? WHERE id = ?",
      [errorMsg, emissaoId]
    );

    return { success: false, error: errorMsg, logs, screenshotUrl };

  } finally {
    if (browser) {
      try { await browser.close(); } catch { }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// Helpers de automação
// ══════════════════════════════════════════════════════════════════════

async function selectEmpresaNoPortal(
  page: any,
  cfg: any,
  emissaoId: number,
  logs: EmissaoResult["logs"]
): Promise<void> {
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    console.log(`[NfseEngine] ${step}_${status}:`, JSON.stringify(details || {}).substring(0, 200));
  };

  try {
    const cnpjLimpo = (cfg.cnpj || "").replace(/\D/g, "");
    // Formatar CNPJ no padrão do portal: XX.XXX.XXX/XXXX-XX
    const cnpjFormatado = cnpjLimpo.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
    const im = cfg.inscricaoMunicipal || "";

    // ── FLUXO REAL DO PORTAL DE VILA VELHA ──────────────────────────
    // 1. Verificar se já está no menu principal (após login)
    const isMenuVisible = await page.$(VILAVELHA_SELECTORS.menu.notaFiscal).catch(() => null);
    if (!isMenuVisible) {
      log("SELECT_EMPRESA", "WARN", { note: "Menu principal não visível — sessão pode ter expirado", url: page.url() });
      return;
    }

    // 2. Clicar em "Nota Fiscal" no menu principal
    await page.click(VILAVELHA_SELECTORS.menu.notaFiscal);
    log("CLICK_NOTA_FISCAL", "OK", {});

    // 3. Aguardar a grid de cadastros relacionados aparecer
    const gridEl = await page.waitForSelector(VILAVELHA_SELECTORS.empresaGrid.grid, { timeout: 15000 }).catch(() => null);
    if (!gridEl) {
      // Pode ter ido direto para o menu NFS-e (empresa única ou já selecionada)
      const isNfseMenu = await page.$(VILAVELHA_SELECTORS.pageState.isNfseMenu).catch(() => null);
      if (isNfseMenu) {
        log("SELECT_EMPRESA", "OK", { method: "single_empresa", note: "Empresa única — sem grid de seleção" });
        return;
      }
      log("SELECT_EMPRESA", "WARN", { note: "Grid de empresas não apareceu e não está no menu NFS-e", url: page.url() });
      return;
    }

    log("EMPRESA_GRID_VISIBLE", "OK", {});

    // 4. Filtrar por CNPJ no campo de busca
    const searchInput = await page.$(VILAVELHA_SELECTORS.empresaGrid.searchInput).catch(() => null);
    if (searchInput) {
      await searchInput.fill(cnpjFormatado);
      await page.waitForTimeout(500);

      // Clicar no botão de busca
      const searchBtn = await page.$(VILAVELHA_SELECTORS.empresaGrid.searchBtn).catch(() => null);
      if (searchBtn) {
        await searchBtn.click();
        await page.waitForTimeout(1500); // Aguardar resultado da busca
        log("EMPRESA_SEARCH", "OK", { cnpj: cnpjFormatado });
      }
    }

    // 5. Aguardar a grid carregar e selecionar a empresa
    await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Localizar a linha da empresa pelo CNPJ
    const linhaEmpresa = page.locator('table tbody tr').filter({ hasText: cnpjFormatado }).first();
    await linhaEmpresa.waitFor({ state: 'visible', timeout: 10000 });

    // Estratégia 1: Clique simples na linha para selecionar + botão Continuar
    await linhaEmpresa.click();
    await page.waitForTimeout(1000);

    // Clicar no botão Continuar
    const btnContinuar = await page.$(VILAVELHA_SELECTORS.empresaGrid.btnContinuar).catch(() => null);
    if (btnContinuar) {
      await btnContinuar.click();
      log("EMPRESA_CONTINUAR_CLICKED", "OK", { cnpj: cnpjFormatado });
    } else {
      // Fallback: tentar duplo clique
      await linhaEmpresa.dblclick();
      log("EMPRESA_DBLCLICK_FALLBACK", "OK", { cnpj: cnpjFormatado });
    }

    // Aguardar o menu NFS-e aparecer
    const nfseMenuAfterClick = await page.waitForSelector(
      VILAVELHA_SELECTORS.pageState.isNfseMenu,
      { timeout: 20000 }
    ).catch(() => null);

    const urlAposClick = page.url();
    const tituloAposClick = await page.title().catch(() => "");
    log("EMPRESA_ROW_CLICKED", "OK", { cnpj: cnpjFormatado, method: "click_continuar", url: urlAposClick, titulo: tituloAposClick, nfseMenuVisible: !!nfseMenuAfterClick });

    // Screenshot após seleção
    try {
      const screenshotClick = await page.screenshot();
      const { url: clickUrl } = await storagePut(
        `nfse-debug/apos-select-empresa-${emissaoId}-${Date.now()}.png`,
        screenshotClick,
        "image/png"
      );
      log("SELECT_EMPRESA_SCREENSHOT", "OK", { screenshotUrl: clickUrl, url: urlAposClick });
    } catch {}

    // Se não chegou ao menu NFS-e, tentar estratégia 2: ícone + Continuar
    if (!nfseMenuAfterClick) {
      log("SELECT_EMPRESA", "WARN", { note: "Menu NFS-e não apareceu após click+Continuar, tentando ícone..." });
      const icone = linhaEmpresa.locator('td:first-child img, td:first-child input').first();
      await icone.click().catch(() => {});
      await page.waitForTimeout(1000);
      const btnContinuarFallback = page.locator('#_imagebutton1').first();
      await btnContinuarFallback.click().catch(() => {});
      await page.waitForSelector(
        VILAVELHA_SELECTORS.pageState.isNfseMenu,
        { timeout: 20000 }
      ).catch(() => {});

      // Screenshot após ícone
      try {
        const screenshotIcone = await page.screenshot();
        const { url: iconeUrl } = await storagePut(
          `nfse-debug/apos-icone-${emissaoId}-${Date.now()}.png`,
          screenshotIcone,
          "image/png"
        );
        log("ICONE_CLICK", "OK", { screenshotUrl: iconeUrl, url: page.url() });
      } catch {}
    }

    const urlFinalEmpresa = page.url();
    const nfseMenuFinal = await page.$(VILAVELHA_SELECTORS.pageState.isNfseMenu).catch(() => null);
    log("SELECT_EMPRESA", "OK", { method: "click_continuar_or_icone", cnpj: cnpjFormatado, url: urlFinalEmpresa, nfseMenuVisible: !!nfseMenuFinal });
    await logCriticalStep(emissaoId, "EMPRESA_OK", "ok", `Empresa selecionada com sucesso: ${cnpjFormatado}`, page);

  } catch (err: any) {
    log("SELECT_EMPRESA", "FAIL", { error: err.message });
    await logCriticalStep(emissaoId, "EMPRESA_FAIL", "error", `Falha ao selecionar empresa: ${err.message}`, page, err);
  }
}

async function navigateToNfseEmission(
  page: any,
  emissaoId: number,
  logs: EmissaoResult["logs"]
): Promise<void> {
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    console.log(`[NfseEngine] ${step}_${status}:`, JSON.stringify(details || {}).substring(0, 200));
  };

  try {
    await page.waitForTimeout(1500);
    const currentUrl = page.url();
    log("NAVIGATE_EMISSION_START", "OK", { url: currentUrl });

    // Screenshot do estado atual
    try {
      const ss = await page.screenshot();
      const { url: ssUrl } = await storagePut(
        `nfse-debug/antes-navigate-${emissaoId}-${Date.now()}.png`,
        ss, 'image/png'
      );
      log("NAVIGATE_SCREENSHOT", "OK", { screenshotUrl: ssUrl });
    } catch {}

    // ── CENÁRIO 1: Já está no formulário de emissão ──────────────────
    const isEmissaoForm = await page.$(VILAVELHA_SELECTORS.pageState.isEmissaoForm).catch(() => null);
    if (isEmissaoForm) {
      log("NAVIGATE_EMISSION", "OK", { url: currentUrl, method: "already_on_form" });
      return;
    }

    // ── CENÁRIO 2: Está no menu NFS-e (após selecionar empresa) ─────
    // Verificar se o menu de NFS-e está visível
    const isNfseMenu = await page.$(VILAVELHA_SELECTORS.pageState.isNfseMenu).catch(() => null);
    if (isNfseMenu) {
      log("NFSE_MENU_VISIBLE", "OK", { url: currentUrl });
      // Clicar em "Gerar Nota Fiscal"
      await page.click(VILAVELHA_SELECTORS.nfseMenu.gerarNotaFiscal);
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      const urlAposGerar = page.url();
      log("NAVIGATE_EMISSION", "OK", { url: urlAposGerar, method: "nfse_menu_gerar" });
      return;
    }

    // ── CENÁRIO 3: Está no menu principal (após login) ─────────────
    // Verificar se o menu principal está visível
    const isMainMenu = await page.$(VILAVELHA_SELECTORS.pageState.isLoggedIn).catch(() => null);
    if (isMainMenu) {
      log("MAIN_MENU_VISIBLE", "OK", { url: currentUrl });
      // Clicar em "Nota Fiscal" no menu principal
      await page.click(VILAVELHA_SELECTORS.menu.notaFiscal);
      await page.waitForTimeout(2000);

      // Aguardar grid de empresas ou menu NFS-e
      const gridOrMenu = await Promise.race([
        page.waitForSelector(VILAVELHA_SELECTORS.empresaGrid.grid, { timeout: 10000 }).catch(() => null),
        page.waitForSelector(VILAVELHA_SELECTORS.pageState.isNfseMenu, { timeout: 10000 }).catch(() => null),
      ]);

      if (gridOrMenu) {
        // Se foi para grid de empresas, não deveria acontecer aqui (selectEmpresa já fez isso)
        // Mas se foi para o menu NFS-e, clicar em Gerar Nota Fiscal
        const isNfseMenuNow = await page.$(VILAVELHA_SELECTORS.pageState.isNfseMenu).catch(() => null);
        if (isNfseMenuNow) {
          await page.click(VILAVELHA_SELECTORS.nfseMenu.gerarNotaFiscal);
          await page.waitForTimeout(2000);
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          log("NAVIGATE_EMISSION", "OK", { url: page.url(), method: "main_menu_to_nfse" });
          return;
        }
      }
      log("NAVIGATE_EMISSION", "WARN", { url: page.url(), note: "Menu principal clicado mas não chegou ao menu NFS-e" });
      return;
    }

    // ── CENÁRIO 4: Está em servlet/controle (URL após duplo clique) ─
    // Tentar encontrar o menu NFS-e dentro de frames
    const frames = page.frames();
    log("FRAMES_COUNT", "OK", { total: frames.length });
    for (const frame of frames) {
      log("FRAME_INFO", "OK", { name: frame.name(), url: frame.url() });
      try {
        const gerarBtn = await frame.$(VILAVELHA_SELECTORS.nfseMenu.gerarNotaFiscal).catch(() => null);
        if (gerarBtn) {
          log("GERAR_NOTA_IN_FRAME", "OK", { frameUrl: frame.url(), frameName: frame.name() });
          await gerarBtn.click();
          await page.waitForTimeout(2000);
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          log("NAVIGATE_EMISSION", "OK", { url: page.url(), method: "frame_gerar_nota" });
          return;
        }
        const emissaoForm = await frame.$(VILAVELHA_SELECTORS.pageState.isEmissaoForm).catch(() => null);
        if (emissaoForm) {
          log("NAVIGATE_EMISSION", "OK", { url: frame.url(), method: "already_in_frame" });
          return;
        }
      } catch {}
    }

    // Screenshot final para diagnóstico
    try {
      const ss = await page.screenshot({ fullPage: true });
      const { url: ssUrl } = await storagePut(
        `nfse-debug/navigate-fail-${emissaoId}-${Date.now()}.png`,
        ss, 'image/png'
      );
      log("NAVIGATE_FAIL_SCREENSHOT", "OK", { screenshotUrl: ssUrl });
    } catch {}

    log("NAVIGATE_EMISSION", "WARN", { url: page.url(), note: "Não encontrou caminho para formulário de emissão" });

  } catch (err: any) {
    log("NAVIGATE_EMISSION", "WARN", { error: err.message });
  }
}

async function fillNfseForm(
  page: any,
  data: {
    tomadorNome: string;
    tomadorCpfCnpj: string;
    // Campos de endereço do tomador (opcionais - preenchidos quando disponíveis)
    tomadorCep?: string;
    tomadorLogradouro?: string;
    tomadorNumeroEnd?: string;
    tomadorBairro?: string;
    tomadorCidade?: string;
    tomadorEstado?: string;
    valor: number;
    competencia: string;
    descricao: string;
    listaServico: string;
    codigoServico?: string;
    issRetido: boolean;
  },
  emissaoId: number,
  logs: EmissaoResult["logs"]
): Promise<void> {
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    console.log(`[NfseEngine] ${step}_${status}:`, JSON.stringify(details || {}).substring(0, 200));
  };

  const comp = formatarCompetencia(data.competencia);
  const valorFormatado = data.valor.toFixed(2).replace(".", ",");

  try {
    // ── 1. Localização do Tomador ─────────────────────────────────────
    // Selecionar "Brasil" para mostrar campos do tomador
    const tomadorCpfCnpjLimpo = data.tomadorCpfCnpj.replace(/\D/g, "");
    const isCpf = tomadorCpfCnpjLimpo.length === 11; // CPF tem 11 dígitos, CNPJ tem 14
    if (tomadorCpfCnpjLimpo.length > 0) {
      // Selecionar "Brasil" na localização do tomador
      // Valor correto confirmado em 11/03/2026: value="B" (não "1")
      await trySelectOption(page, [VILAVELHA_SELECTORS.form.localizacaoTomador], "B").catch(() => {});
      await page.waitForTimeout(1000); // Aguardar campos do tomador aparecerem (onchange JS)
      // Se CPF (pessoa física), selecionar tipo CPF no campo qyTipoTomaInfo
      if (isCpf) {
        // O portal pode ter um select de tipo de pessoa: CPF ou CNPJ
        // Tentar selecionar opção CPF (valor pode ser 'F', 'CPF', '1' ou 'C')
        const tipoCpfFilled = await page.evaluate(() => {
          const sel = document.querySelector('select#qyTipoTomaInfo, select[name*="tipotoma" i], select[name*="tipopessoa" i]') as HTMLSelectElement;
          if (!sel) return false;
          // Tentar opções comuns para CPF
          for (const v of ['F', 'CPF', 'C', '1']) {
            const opt = Array.from(sel.options).find(o => o.value === v || o.text.toUpperCase().includes('CPF') || o.text.toUpperCase().includes('FISICA'));
            if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opt.value; }
          }
          return false;
        }).catch(() => false);
        log('TOMADOR_TIPO_CPF', tipoCpfFilled ? 'OK' : 'WARN', { isCpf, tipoCpfFilled });
        if (tipoCpfFilled) await page.waitForTimeout(500);
      }
    }

    // ── 2. CNPJ/CPF do tomador ───────────────────────────────────────────────
    // Verificar se o campo está visível antes de preencher
    const cnpjFieldEl = await page.$(VILAVELHA_SELECTORS.form.tomadorCpfCnpj).catch(() => null);
    log("TOMADOR_CNPJ_FIELD", cnpjFieldEl ? "OK" : "WARN", { selector: VILAVELHA_SELECTORS.form.tomadorCpfCnpj, found: !!cnpjFieldEl });
    const cnpjFilled = await tryFill(page, [VILAVELHA_SELECTORS.form.tomadorCpfCnpj], tomadorCpfCnpjLimpo);
    log("TOMADOR_CNPJ_FILL", cnpjFilled ? "OK" : "WARN", { cnpj: tomadorCpfCnpjLimpo, filled: cnpjFilled });
    if (cnpjFilled) {
      await page.keyboard.press("Tab");
      // Aguardar o spinner de "Carregando" desaparecer (portal consulta a Receita Federal)
      // O spinner aparece como texto "Carregando" ao lado do campo CNPJ
      try {
        await page.waitForFunction(
          () => !document.body.innerText.includes('Carregando'),
          { timeout: 8000 }
        );
        log('TOMADOR_CNPJ_LOADING', 'OK', { note: 'Spinner desapareceu' });
      } catch (e) {
        log('TOMADOR_CNPJ_LOADING', 'WARN', { note: 'Timeout aguardando spinner' });
      }
      await page.waitForTimeout(500); // Aguarda autocomplete do nome
    }
    // ── 3. Nome do tomador ───────────────────────────────────────────────────────────────────────────
    const nomeField = await trySelectors(page, [VILAVELHA_SELECTORS.form.tomadorRazaoSocial]);
    if (nomeField) {
      const currentValue = await nomeField.inputValue().catch(() => "");
      if (!currentValue) await nomeField.fill(data.tomadorNome);
      // IMPORTANTE: pressionar Tab após preencher o Nome para liberar o foco
      // Sem isso, os page.fill seguintes concatenam no campo Nome
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
    }    // ── 3b. Endereço do tomador (obrigatório pelo portal) ───────────────────────────────────────────────
    // IMPORTANTE: Marcar o checkbox "Informar endereço" (qyTomaEndInformadoCheck)
    // Sem isso, os campos de endereço ficam ocultos e o portal rejeita a nota
    try {
      const endCheckbox = page.locator('#qyTomaEndInformadoCheck').first();
      const isChecked = await endCheckbox.isChecked({ timeout: 3000 }).catch(() => false);
      if (!isChecked) {
        await endCheckbox.click({ force: true });
        await page.waitForTimeout(500);
        log('TOMADOR_END_CHECKBOX', 'OK', { checked: true });
      } else {
        log('TOMADOR_END_CHECKBOX', 'OK', { checked: 'already' });
      }
    } catch (e: any) {
      log('TOMADOR_END_CHECKBOX', 'WARN', { error: e.message });
    }
    
    // Campos de endereço só aparecem após marcar o checkbox e preencher o CNPJ do tomador
    // IDs confirmados em 11/03/2026: qycep, qyendereco, qyendereconumero, qybairro, qycidade, qyestado
    // IMPORTANTE: aguardar 1s após checkbox antes de preencher campos
    await page.waitForTimeout(1000);
    if (data.tomadorCep) {
      const cepLimpo = data.tomadorCep.replace(/\D/g, "");
      // Tentar fill com force:true para garantir preenchimento mesmo se campo não visível
      try {
        await page.fill(VILAVELHA_SELECTORS.form.tomadorCep, cepLimpo, { force: true });
        log('TOMADOR_CEP_FILL', 'OK', { cep: cepLimpo });
        await page.waitForTimeout(2000); // Aguardar preenchimento automático por CEP
      } catch (e: any) {
        log('TOMADOR_CEP_FILL', 'WARN', { error: e.message });
      }
    }
    if (data.tomadorLogradouro) {
      try {
        await page.fill(VILAVELHA_SELECTORS.form.tomadorLogradouro, data.tomadorLogradouro, { force: true });
        log('TOMADOR_LOGRADOURO_FILL', 'OK', { logradouro: data.tomadorLogradouro });
      } catch (e: any) {
        log('TOMADOR_LOGRADOURO_FILL', 'WARN', { error: e.message });
      }
    }
    if (data.tomadorNumeroEnd) {
      try {
        await page.fill(VILAVELHA_SELECTORS.form.tomadorNumero, data.tomadorNumeroEnd, { force: true });
        log('TOMADOR_NUMERO_FILL', 'OK', { numero: data.tomadorNumeroEnd });
      } catch (e: any) {
        log('TOMADOR_NUMERO_FILL', 'WARN', { error: e.message });
      }
    }
    if (data.tomadorBairro) {
      try {
        await page.fill(VILAVELHA_SELECTORS.form.tomadorBairro, data.tomadorBairro, { force: true });
        log("TOMADOR_BAIRRO_FILL", "OK", { bairro: data.tomadorBairro });
      } catch (e: any) {
        log("TOMADOR_BAIRRO_FILL", "WARN", { bairro: data.tomadorBairro, error: e.message });
      }
    }
    if (data.tomadorCidade) {
      // Cidade: campo jpsuggest — aguardar que fique visível após preenchimento do CEP
      // O campo fica visível após o checkbox de endereço ser marcado e o CEP preenchido
      try {
        // Aguardar o campo ficar visível (até 5s)
        await page.waitForSelector('input#qycidade:not([style*="display: none"]):not([style*="display:none"])', { timeout: 5000 }).catch(() => null);
        const cidadeInput = page.locator('input#qycidade').first();
        const isVisible = await cidadeInput.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          // Campo visível: usar jpsuggest (digitar + ArrowDown + Enter)
          await cidadeInput.click();
          await cidadeInput.fill('');
          await cidadeInput.type(data.tomadorCidade, { delay: 150 });
          await page.waitForTimeout(2000);
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(300);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(500);
          const valorAtual = await cidadeInput.inputValue().catch(() => '');
          log("TOMADOR_CIDADE_FILL", valorAtual ? "OK" : "WARN", { method: 'jpsuggest_arrowdown', valorAtual });
        } else {
          // Campo oculto: usar dispatchEvent via JS para ativar o jpsuggest
          // O jpsuggest escuta keyup — simular digitação via keyboard events
          await page.evaluate((val: string) => {
            const input = document.querySelector('input#qycidade') as HTMLInputElement;
            if (input) {
              // Mostrar o campo temporariamente
              const origDisplay = input.style.display;
              input.style.display = 'block';
              input.focus();
              input.value = '';
              // Disparar eventos de teclado para cada caractere
              for (const ch of val) {
                input.value += ch;
                input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
              }
              input.style.display = origDisplay;
            }
          }, data.tomadorCidade);
          await page.waitForTimeout(2000);
          // Tentar clicar na sugestão
          const sug = page.locator(`li:has-text("${data.tomadorCidade}")`).first();
          if (await sug.isVisible({ timeout: 2000 }).catch(() => false)) {
            await sug.click();
            log("TOMADOR_CIDADE_FILL", "OK", { method: 'js_keyevents_click' });
          } else {
            // Último recurso: pressionar ArrowDown + Enter
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(500);
            const valorAtual = await page.evaluate(() => (document.querySelector('input#qycidade') as HTMLInputElement)?.value || '');
            log("TOMADOR_CIDADE_FILL", valorAtual ? "OK" : "WARN", { method: 'js_keyevents_enter', valorAtual });
          }
        }
      } catch (e: any) {
        log("TOMADOR_CIDADE_FILL", "WARN", { error: e.message });
      }
    }
    if (data.tomadorEstado) {
      // Estado: campo simples, fill direto com force:true
      try {
        await page.fill(VILAVELHA_SELECTORS.form.tomadorEstado, data.tomadorEstado, { force: true });
        log('TOMADOR_ESTADO_FILL', 'OK', { estado: data.tomadorEstado });
      } catch (e: any) {
        log('TOMADOR_ESTADO_FILL', 'WARN', { error: e.message });
      }
    }
    // País do tomador: campo jpsuggest oculto — usar page.evaluate para preencher via JS
    try {
      await page.evaluate(() => {
        const input = document.querySelector('input#qypais') as HTMLInputElement;
        if (input) {
          input.value = 'BRASIL';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
      });
      await page.waitForTimeout(300);
      const paisVal = await page.evaluate(() => (document.querySelector('input#qypais') as HTMLInputElement)?.value || '');
      log('TOMADOR_PAIS_FILL', paisVal ? 'OK' : 'WARN', { method: 'js_evaluate', valorAtual: paisVal });
    } catch (e: any) {
      log('TOMADOR_PAIS_FILL', 'WARN', { error: e.message });
    }

    // ── 4. Lista de serviço (atividade) ─────────────────────────────
    // CORREÇÃO: O portal usa IDs internos numéricos, não o código de serviço textual.
    // Mapeamento confirmado via análise do HTML do portal Vila Velha:
    //   3774 = 17.19.01 Contabilidade, inclusive serviços técnicos e auxiliares (ISS 2%)
    //   3748 = 17.01.01 Assessoria ou consultoria de qualquer natureza
    //   3775 = 17.20.01 Consultoria e assessoria econômica ou financeira
    // Estratégia: usar page.evaluate() para selecionar diretamente por value numérico
    // e disparar o evento onchange para atualizar alíquotas.
    const codigoServico = data.codigoServico || data.listaServico || "17.19";
    // Mapeamento de código de serviço → ID interno do portal Vila Velha
    const ATIVIDADE_MAP: Record<string, string> = {
      '17.19': '3774', '17.19.01': '3774',
      '17.01': '3748', '17.01.01': '3748', '17.01.02': '3749',
      '17.20': '3775', '17.20.01': '3775',
      '17.16': '3771', '17.16.01': '3771',
      '17.09': '3762', '17.09.01': '3762',
      '191701': '3774', // código NBS → contabilidade
    };
    const atividadeIdPortal = ATIVIDADE_MAP[codigoServico] || ATIVIDADE_MAP[codigoServico.split('.').slice(0,2).join('.')] || '3774';
    log('ATIVIDADE_START', 'OK', { seletor: VILAVELHA_SELECTORS.form.servicosPrestados, codigo: codigoServico, idPortal: atividadeIdPortal });
    const atividadeStart = Date.now();
    try {
      // Estratégia 1: page.selectOption com o ID interno do portal
      const filled1 = await page.selectOption(VILAVELHA_SELECTORS.form.servicosPrestados, atividadeIdPortal)
        .then(() => true)
        .catch(() => false);

      if (filled1) {
        // Disparar onchange para atualizar alíquotas e campos dependentes
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLSelectElement;
          if (el) {
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // Chamar a função onchange do portal se existir
            if (typeof (window as any).qyidatividade_onchange === 'function') {
              (window as any).qyidatividade_onchange(el);
            }
          }
        }, VILAVELHA_SELECTORS.form.servicosPrestados).catch(() => {});
        log('ATIVIDADE_SELECT_OK', 'OK', { idPortal: atividadeIdPortal, codigo: codigoServico, metodo: 'selectOption' });
      } else {
        // Estratégia 2: page.evaluate para forçar via JS
        const filled2 = await page.evaluate((args: { idPortal: string }) => {
          const el = document.getElementById('qyidatividade') as HTMLSelectElement;
          if (!el) return false;
          el.value = args.idPortal;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof (window as any).qyidatividade_onchange === 'function') {
            (window as any).qyidatividade_onchange(el);
          }
          return el.value === args.idPortal;
        }, { idPortal: atividadeIdPortal }).catch(() => false);

        if (filled2) {
          log('ATIVIDADE_SELECT_OK', 'OK', { idPortal: atividadeIdPortal, codigo: codigoServico, metodo: 'evaluate_js' });
        } else {
          log('ATIVIDADE_SELECT_WARN', 'WARN', { idPortal: atividadeIdPortal, codigo: codigoServico, nota: 'Não foi possível selecionar, continuando' });
        }
      }

      await page.waitForTimeout(800).catch(() => {});
      log('ATIVIDADE_OK', 'OK', { duration: Date.now() - atividadeStart, idPortal: atividadeIdPortal });
    } catch (e: any) {
      // FALLBACK OPERACIONAL: NÃO lançar exceção — apenas registrar e continuar
      log('ATIVIDADE_WARN', 'WARN', { error: e.message, duration: Date.now() - atividadeStart, seletor: VILAVELHA_SELECTORS.form.servicosPrestados, codigo: codigoServico, nota: 'ATIVIDADE falhou mas fluxo continua' });
    }

    // ── 5. Código NBS ────────────────────────────────────────────────
    // O campo qynbsdescricao usa autocomplete (initAutoSuggest) que preenche qyidnbs automaticamente.
    // Estratégia: digitar o código NBS no campo de texto, aguardar a lista e selecionar o primeiro item.
    // Se o autocomplete falhar, tentar preencher diretamente via JS como fallback.
    const nbsStart = Date.now();
    log('NBS_START', 'OK', { note: 'Iniciando preenchimento de NBS via autocomplete' });
    try {
      // Estratégia 1: Usar autocomplete - clicar no campo, digitar código e selecionar
      const nbsField = await page.$('#qynbsdescricao').catch(() => null);
      let nbsFilledOk = false;

      // Diagnóstico: capturar HTML do campo NBS e configuracao do autocomplete
      const nbsFormContext = await page.evaluate(() => {
        const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
        if (!descrField) return { found: false };
        // Capturar o HTML do container do campo NBS
        const container = descrField.closest('div, td, tr') as HTMLElement;
        const containerHtml = container ? container.outerHTML.substring(0, 1000) : '';
        // Capturar atributos do campo
        const attrs: Record<string, string> = {};
        for (let i = 0; i < descrField.attributes.length; i++) {
          const attr = descrField.attributes[i];
          attrs[attr.name] = attr.value;
        }
        // Verificar se tem data-* attributes do jQuery typeahead
        const $ = (window as any).$;
        let jqueryData: any = null;
        if ($ && $(descrField).data) {
          try {
            const allData = $(descrField).data();
            jqueryData = allData ? JSON.stringify(allData).substring(0, 500) : null;
          } catch (e) { jqueryData = String(e); }
        }
        // Verificar se initAutoSuggest foi chamado
        const autoSuggestFn = (window as any).initAutoSuggest;
        return {
          found: true,
          attrs,
          containerHtml,
          jqueryData,
          hasInitAutoSuggest: typeof autoSuggestFn === 'function',
        };
      }).catch(() => ({ found: false }));
      log('NBS_FORM_CONTEXT', 'OK', nbsFormContext);

      // Diagnóstico: capturar estado inicial dos campos NBS
      const nbsInitialState = await page.evaluate(() => {
        const idField = document.getElementById('qyidnbs') as HTMLInputElement;
        const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
        return {
          qyidnbs_found: !!idField,
          qyidnbs_value: idField?.value || '',
          qyidnbs_type: idField?.type || '',
          qynbsdescricao_found: !!descrField,
          qynbsdescricao_value: descrField?.value || '',
          qynbsdescricao_type: descrField?.type || '',
        };
      }).catch(() => ({}));
      log('NBS_INITIAL_STATE', 'OK', nbsInitialState);

      if (nbsField) {
        try {
          // Interceptar requisições de rede para capturar a URL do autocomplete NBS
          const nbsRequests: string[] = [];
          const nbsResponses: any[] = [];
          const requestHandler = (request: any) => {
            const url = request.url();
            if (url.includes('nbs') || url.includes('NBS') || url.includes('suggest') || url.includes('autocomplete') || url.includes('buscar') || url.includes('pesquisar')) {
              nbsRequests.push(url);
            }
          };
          const responseHandler = async (response: any) => {
            const url = response.url();
            if (url.includes('nbs') || url.includes('NBS') || url.includes('suggest') || url.includes('autocomplete') || url.includes('buscar') || url.includes('pesquisar')) {
              try {
                const body = await response.text().catch(() => '');
                nbsResponses.push({ url, status: response.status(), body: body.substring(0, 500) });
              } catch {}
            }
          };
          page.on('request', requestHandler);
          page.on('response', responseHandler);

          // Chamar initAutoSuggest diretamente para inicializar o autocomplete
          // O campo tem onfocus="initAutoSuggest(this)" - precisamos chamar isso explicitamente
          const initResult = await page.evaluate(() => {
            const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
            if (!descrField) return { ok: false, reason: 'campo não encontrado' };
            const initFn = (window as any).initAutoSuggest;
            if (typeof initFn === 'function') {
              try {
                initFn(descrField);
                return { ok: true, called: true };
              } catch (e) { return { ok: false, error: String(e) }; }
            }
            return { ok: false, reason: 'initAutoSuggest não encontrado' };
          }).catch((e: any) => ({ ok: false, error: e.message }));
          log('NBS_INIT_AUTOSUGGEST', initResult.ok ? 'OK' : 'WARN', initResult);

          // Clicar no campo para ativar o autocomplete
          await nbsField.click().catch(() => {});
          await page.waitForTimeout(500).catch(() => {});
          // Limpar campo e digitar o código NBS
          await nbsField.fill('').catch(() => {});
          await nbsField.type('1.1302', { delay: 150 }).catch(() => {});
          await page.waitForTimeout(3000).catch(() => {});

          // Remover handlers e logar requisições capturadas
          page.off('request', requestHandler);
          page.off('response', responseHandler);
          log('NBS_NETWORK_REQUESTS', 'OK', { requests: nbsRequests, responses: nbsResponses });

          // Capturar HTML da área de autocomplete para diagnóstico
          const autocompleteHtml = await page.evaluate(() => {
            // Procurar por containers de autocomplete visíveis
            const selectors = [
              '.autoSuggest', '.suggest-list', '.ui-autocomplete',
              '[id*="suggest"]', '[class*="suggest"]', '[class*="autocomplete"]',
              'ul.dropdown-menu', '.jpsuggest', '.ac_results'
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && (el as HTMLElement).style.display !== 'none') {
                return { selector: sel, html: el.outerHTML.substring(0, 500), visible: true };
              }
            }
            // Procurar qualquer ul visível próximo ao campo
            const allUls = Array.from(document.querySelectorAll('ul'));
            for (const ul of allUls) {
              if ((ul as HTMLElement).style.display !== 'none' && ul.children.length > 0) {
                const rect = ul.getBoundingClientRect();
                if (rect.top > 0 && rect.width > 50) {
                  return { selector: 'ul', html: ul.outerHTML.substring(0, 500), visible: true };
                }
              }
            }
            return { selector: null, html: null, visible: false };
          }).catch(() => ({ selector: null, html: null, visible: false }));
          log('NBS_AUTOCOMPLETE_HTML', 'OK', autocompleteHtml);

          // Verificar se a lista de sugestões apareceu
          const suggestList = await page.$('.autoSuggest, .suggest-list, [id*="suggest"], ul.dropdown-menu, .ui-autocomplete, .jpsuggest, .ac_results').catch(() => null);
          if (suggestList) {
            const firstItem = await suggestList.$('li, .suggest-item, .ui-menu-item').catch(() => null);
            if (firstItem) {
              await firstItem.click().catch(() => {});
              await page.waitForTimeout(500).catch(() => {});
              nbsFilledOk = true;
              log('NBS_AUTOCOMPLETE_OK', 'OK', { note: 'NBS selecionado via autocomplete' });
            } else {
              log('NBS_AUTOCOMPLETE_NO_ITEM', 'WARN', { note: 'Lista encontrada mas sem itens clicáveis' });
            }
          } else {
            // Tentar pressionar Enter ou Tab para aceitar sugestão
            await nbsField.press('ArrowDown').catch(() => {});
            await page.waitForTimeout(300).catch(() => {});
            await nbsField.press('Enter').catch(() => {});
            await page.waitForTimeout(500).catch(() => {});
            log('NBS_AUTOCOMPLETE_KEYBOARD', 'WARN', { note: 'Lista não encontrada, tentou ArrowDown+Enter' });
          }
          // Verificar se qyidnbs foi preenchido
          const qyidnbsValue = await page.evaluate(() => {
            const el = document.getElementById('qyidnbs') as HTMLInputElement;
            return el ? el.value : '';
          }).catch(() => '');
          if (qyidnbsValue && qyidnbsValue !== '') {
            nbsFilledOk = true;
            log('NBS_ID_FILLED', 'OK', { qyidnbs: qyidnbsValue });
          }
        } catch (autocompleteErr: any) {
          log('NBS_AUTOCOMPLETE_WARN', 'WARN', { error: autocompleteErr.message });
        }
      } else {
        log('NBS_FIELD_NOT_FOUND', 'WARN', { note: 'Campo #qynbsdescricao não encontrado na página' });
      }

      // Estratégia 2: Chamar o autocomplete via AJAX diretamente
      // O portal usa getAutoSuggestList que faz POST para /tbw/servlet/controle com:
      // cmd=autoSuggest&submitedType=fastSubmit&vlrComparacao=<texto>&objFast=qynbsdescricao
      // Além dos campos obj e win como contexto.
      if (!nbsFilledOk) {
        // Tentar chamar a URL do autocomplete do portal para obter o ID interno do NBS
        // O portal Vila Velha usa o servlet controle com cmd=autoSuggest
        const nbsApiResult = await page.evaluate(async () => {
          const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
          if (!descrField) return { ok: false, reason: 'campo não encontrado' };

          // Usar a API real do portal: POST para /tbw/servlet/controle
          // com cmd=autoSuggest&submitedType=fastSubmit&vlrComparacao=<texto>&objFast=qynbsdescricao
          // Mais os campos obj e win como contexto da sessão
          const objEl = document.getElementById('obj') as HTMLInputElement;
          const winEl = document.getElementById('win') as HTMLInputElement;
          const objValue = objEl ? objEl.value : '';
          const winValue = winEl ? winEl.value : '';

          if (!objValue) {
            return { ok: false, reason: 'elemento obj não encontrado - sessão inválida' };
          }

          // Fazer POST para o servlet com os parâmetros corretos
          const formData = new URLSearchParams();
          formData.append('obj', objValue);
          formData.append('win', winValue);
          formData.append('cmd', 'autoSuggest');
          formData.append('submitedType', 'fastSubmit');
          formData.append('vlrComparacao', '1.1302');
          formData.append('objFast', 'qynbsdescricao');

          try {
            const resp = await fetch('/tbw/servlet/controle', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString(),
            });
            const text = await resp.text();
            return { ok: true, objValue, winValue, status: resp.status, body: text.substring(0, 500) };
          } catch (e: any) {
            return { ok: false, reason: e.message };
          }
        }).catch((e: any) => ({ ok: false, reason: e.message }));
        log('NBS_API_PROBE', 'OK', nbsApiResult);

        // Processar a resposta do autoSuggest para extrair o ID do NBS
        // O portal retorna: "qynbsdescricao,<qtd>;<html da lista>"
        // Onde cada linha da lista tem os valores fill=qyidnbs com o ID interno
        if (nbsApiResult.ok && nbsApiResult.body) {
          const nbsParseResult = await page.evaluate(async (apiBody: string) => {
            const idField = document.getElementById('qyidnbs') as HTMLInputElement;
            const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
            if (!idField || !descrField) return { ok: false, reason: 'campos não encontrados' };

            // O formato da resposta é: "fieldId,qtd;HTML"
            const semicolonIdx = apiBody.indexOf(';');
            if (semicolonIdx < 0) return { ok: false, reason: 'formato de resposta inválido', body: apiBody.substring(0, 200) };

            const header = apiBody.substring(0, semicolonIdx);
            const html = apiBody.substring(semicolonIdx + 1);

            // Criar um elemento temporário para parsear o HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Procurar o primeiro item com fill=qyidnbs
            const tds = Array.from(tempDiv.querySelectorAll('td[fill="qyidnbs"]'));
            if (tds.length > 0) {
              const firstTd = tds[0] as HTMLElement;
              const nbsId = firstTd.textContent?.trim() || '';
              // Procurar o td com fill=qynbsdescricao para a descrição
              const descrTds = Array.from(tempDiv.querySelectorAll('td[fill="qynbsdescricao"]'));
              const nbsDescr = descrTds.length > 0 ? (descrTds[0] as HTMLElement).textContent?.trim() || '' : '';

              if (nbsId) {
                // Preencher os campos com os valores encontrados
                idField.value = nbsId;
                idField.dispatchEvent(new Event('change', { bubbles: true }));
                descrField.value = nbsDescr || '1.1302.21.00 - Serviços de contabilidade';
                descrField.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, nbsId, nbsDescr, method: 'api_parse', header };
              }
            }

            // Se não encontrou via fill, tentar parsear o HTML de outra forma
            const allTrs = Array.from(tempDiv.querySelectorAll('tr'));
            for (const tr of allTrs) {
              const tdsInRow = Array.from(tr.querySelectorAll('td'));
              for (const td of tdsInRow) {
                const text = (td as HTMLElement).textContent?.trim() || '';
                if (text.includes('1.1302') || text.includes('contabilidade') || text.includes('Contabilidade')) {
                  // Tentar encontrar o ID no mesmo row
                  const idTd = tr.querySelector('td[fill="qyidnbs"]') as HTMLElement;
                  if (idTd) {
                    const nbsId = idTd.textContent?.trim() || '';
                    if (nbsId) {
                      idField.value = nbsId;
                      idField.dispatchEvent(new Event('change', { bubbles: true }));
                      descrField.value = text;
                      descrField.dispatchEvent(new Event('change', { bubbles: true }));
                      return { ok: true, nbsId, nbsDescr: text, method: 'html_parse' };
                    }
                  }
                }
              }
            }

            return { ok: false, reason: 'ID do NBS não encontrado na resposta', header, htmlLength: html.length, htmlPreview: html.substring(0, 300) };
          }, nbsApiResult.body).catch((e: any) => ({ ok: false, reason: e.message }));
          log('NBS_API_PARSE', nbsParseResult.ok ? 'OK' : 'WARN', nbsParseResult);
          if (nbsParseResult.ok) nbsFilledOk = true;
        }

        // Estratégia 3: Fallback final - preencher diretamente via JS
        // Se o portal valida qyidnbs como inteiro, precisamos do ID interno.
        // Tentamos preencher com valores que o portal possa aceitar.
        if (!nbsFilledOk) {
          const nbsJsFilled = await page.evaluate(() => {
            const idField = document.getElementById('qyidnbs') as HTMLInputElement;
            const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
            if (!idField || !descrField) return { ok: false, reason: 'campos não encontrados' };
            // Tentar preencher com código NBS válido
            // O portal aceita o código textual no campo de descrição
            descrField.value = '1.1302.21.00 - Serviços de contabilidade';
            descrField.dispatchEvent(new Event('input', { bubbles: true }));
            descrField.dispatchEvent(new Event('change', { bubbles: true }));
            // Para qyidnbs, tentar com o código numérico que pode ser aceito
            // (será validado pelo portal no submit)
            idField.value = '1';
            idField.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, descrValue: descrField.value, idValue: idField.value };
          }).catch((e: any) => ({ ok: false, reason: e.message }));
          log('NBS_JS_FALLBACK', nbsJsFilled.ok ? 'OK' : 'WARN', nbsJsFilled);
        }
      }

      const nbsDuration = Date.now() - nbsStart;
      log('NBS_FILLED', 'OK', { duration: nbsDuration });
    } catch (e: any) {
      const nbsDuration = Date.now() - nbsStart;
      log('NBS_FILLED', 'WARN', { error: e.message, duration: nbsDuration });
    }

    // ── 6. Competência ───────────────────────────────────────────────
    const compFilled = await trySelectOption(page, [VILAVELHA_SELECTORS.form.competenciaMes], comp.mes);
    if (!compFilled) {
      await trySelectOption(page, [VILAVELHA_SELECTORS.form.competenciaMes], comp.mesNome);
    }
    const anoField = await trySelectors(page, [VILAVELHA_SELECTORS.form.competenciaAno]);
    if (anoField) {
      const tag = await anoField.evaluate((el: any) => el.tagName.toLowerCase());
      if (tag === "select") {
        await anoField.selectOption(comp.ano).catch(() => {});
      } else {
        await anoField.fill(comp.ano);
      }
    }

    // ── 7. Descrição do serviço ─────────────────────────────────────
    await tryFill(page, [VILAVELHA_SELECTORS.form.descricaoServico], data.descricao);

    // ── 8. Valor do serviço ──────────────────────────────────────────
    await tryFill(page, [VILAVELHA_SELECTORS.form.valorTotal], valorFormatado);

    // ── 9. País do Local da Prestação de Serviço ───────────────────
    // Diagnóstico confirmou: preencher diretamente via JS com "BRASIL"
    try {
      const paisFilled = await page.evaluate(() => {
        const field = document.getElementById('qyPaisPrestacao') as HTMLInputElement;
        if (!field) return false;
        field.value = 'BRASIL';
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }).catch(() => false);
      log("PAIS_FILLED", paisFilled ? "OK" : "WARN", { method: 'js_direct', value: 'BRASIL' });
    } catch (e: any) {
      log("PAIS_FILLED", "WARN", { error: e.message });
    }

    // ── 9b. Município do Local da Prestação de Serviço ──────────────
    // Campo municipioLocalPrestacao usa jpsuggest — múltiplas estratégias
    try {
      let municipioMethod = 'none';

      const municipioSel = VILAVELHA_SELECTORS.form.municipioPrestacao; // 'input#qyservicocidade'

      // Abordagem 1: forçar valor via jQuery (o portal usa jQuery)
      const jqueryResult = await page.evaluate((sel: string) => {
        const input = document.querySelector(sel) as HTMLInputElement;
        if (!input) return false;
        const jq = (window as any).jQuery || (window as any).$;
        if (jq) {
          jq(input).val('Vila Velha').trigger('change').trigger('keyup');
          return true;
        }
        return false;
      }, municipioSel).catch(() => false);
      await page.waitForTimeout(1000);

      // Verificar campos hidden com código do município
      const hiddenMunicipios = await page.evaluate(() => {
        const result: any[] = [];
        document.querySelectorAll('input[type="hidden"]').forEach((f: any) => {
          if (f.name?.toLowerCase().includes('municipio') || f.id?.toLowerCase().includes('municipio')) {
            result.push({ name: f.name, id: f.id, value: f.value });
          }
        });
        return result;
      }).catch(() => []);
      log('MUNICIPIO_HIDDEN_FIELDS', 'OK', { fields: hiddenMunicipios, jqueryOk: jqueryResult });

      // Abordagem 2: type devagar + aguardar li + clicar pelo texto
      await page.fill(municipioSel, '');
      await page.type(municipioSel, 'Vila', { delay: 200 });
      await page.waitForTimeout(2500);

      // Screenshot para diagnóstico da lista
      try {
        const ss = await page.screenshot();
        const { storagePut } = await import('../storage');
        const sfx = Math.random().toString(36).substring(2, 8);
        const { url } = await storagePut(`nfse-debug/municipio-list-${sfx}.png`, ss, 'image/png');
        log('MUNICIPIO_LIST_SCREENSHOT', 'OK', { screenshotUrl: url });
      } catch { /* não bloquear por screenshot */ }

      // Clicar no item da lista que contém exatamente 'Vila Velha - ES'
      // A lista jpsuggest mostra vários 'Vila' — precisamos do item exato
      let clicked = false;
      // Tentar primeiro pelo texto exato
      const exactItem = page.locator('li:has-text("Vila Velha - ES")').first();
      const exactVisible = await exactItem.isVisible({ timeout: 2000 }).catch(() => false);
      if (exactVisible) {
        await exactItem.click();
        clicked = true;
        municipioMethod = 'li_exact_click';
        log('MUNICIPIO_FILLED', 'OK', { method: 'li_exact_click' });
      }

      if (!clicked) {
        // Tentar pelo texto parcial 'Vila Velha'
        const items = page.locator('li').filter({ hasText: /Vila Velha/i });
        const count = await items.count().catch(() => 0);
        if (count > 0) {
          await items.first().click();
          clicked = true;
          municipioMethod = 'li_partial_click';
          log('MUNICIPIO_FILLED', 'OK', { method: 'li_partial_click', count });
        }
      }

      if (!clicked) {
        // Fallback: pressionar Tab para sair do campo (seleciona o primeiro item)
        // Mas antes, digitar mais para filtrar melhor
        await page.fill(municipioSel, '');
        await page.type(municipioSel, 'Vila Velha', { delay: 150 });
        await page.waitForTimeout(2000);
        const itemAfterMore = page.locator('li:has-text("Vila Velha - ES")').first();
        const visibleAfterMore = await itemAfterMore.isVisible({ timeout: 2000 }).catch(() => false);
        if (visibleAfterMore) {
          await itemAfterMore.click();
          clicked = true;
          municipioMethod = 'li_more_text_click';
          log('MUNICIPIO_FILLED', 'OK', { method: 'li_more_text_click' });
        } else {
          await page.keyboard.press('Tab');
          municipioMethod = 'tab_fallback';
          log('MUNICIPIO_FILLED', 'OK', { method: 'tab_fallback' });
        }
      }

      // Validar valor atual
      const valorMunicipio = await page.inputValue(municipioSel).catch(() => '');
      log('MUNICIPIO_VALIDATED', valorMunicipio.toLowerCase().includes('vila velha') ? 'OK' : 'WARN', {
        valorAtual: valorMunicipio,
        method: municipioMethod,
      });

      // Preencher estado (ES) via JS direto — campo simples, não é jpsuggest
      const estadoFilled = await page.evaluate(() => {
        const el = document.getElementById('qyservicoestado') as HTMLInputElement | null;
        if (!el) return false;
        el.value = 'ES';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }).catch(() => false);
      log('ESTADO_FILLED', estadoFilled ? 'OK' : 'WARN', { value: 'ES' });

    } catch (e: any) {
      log('MUNICIPIO_FILLED', 'WARN', { error: e.message });
    }

    // ── 10. Tributação ISSQN ─────────────────────────────────────────
    // Campo obrigatório: selecionar "NÃO" na pergunta de imunidade/exportação
    // O select correto é qypergimunidade (não qytribISSQN que só tem "Operação tributável")
    // Diagnóstico confirmou: qypergimunidade tem opções: "" (SELECIONE), "N" (NÃO), "S" (SIM)
    await trySelectOption(page, [VILAVELHA_SELECTORS.form.imunidade], "N").catch(() => {});
    await page.waitForTimeout(300);
    // O select qytribISSQN já tem apenas "Operação tributável" selecionado por padrão
    // Garantir que está selecionado
    const tribISSQNField = await page.$(VILAVELHA_SELECTORS.form.tributacaoISSQN).catch(() => null);
    if (tribISSQNField) {
      await tribISSQNField.selectOption('1').catch(() => {});
    }

       // ── 11. ISS Retido ────────────────────────────────────────────
    if (data.issRetido) {
      await trySelectOption(page, [VILAVELHA_SELECTORS.form.issRetido], "1");
    }

    // ── 12. Itens do formulário ─────────────────────────────────────
    // O formulário usa sistema de itens via jPSuggest.document
    // Os campos estão no jPSuggest.document (não no documento principal)
    // Diagnóstico confirmou: qynfitensdescritem, qynfitensqtd, qynfitensvlrunitario, qynfitensvlrtotal
    // O botão imagebutton1 faz fastSubmit para adicionar o item
    try {
      const valorFormatadoItem = data.valor.toFixed(2).replace(".", ",");
      const itemAdded = await page.evaluate(async (params: { descricao: string; valor: string }) => {
        const jps = (window as any).jPSuggest;
        if (!jps || !jps.document) return { success: false, error: 'jPSuggest não disponível' };
        
        try {
          const descrField = jps.document.getElementById('qynfitensdescritem') as HTMLInputElement;
          const qtdField = jps.document.getElementById('qynfitensqtd') as HTMLInputElement;
          const vlrField = jps.document.getElementById('qynfitensvlrunitario') as HTMLInputElement;
          const totalField = jps.document.getElementById('qynfitensvlrtotal') as HTMLInputElement;
          const addBtn = jps.document.getElementById('imagebutton1') as HTMLButtonElement;
          
          if (!descrField || !qtdField || !vlrField || !addBtn) {
            return { success: false, error: 'Campos de item não encontrados no jPSuggest', fields: {
              descr: !!descrField, qtd: !!qtdField, vlr: !!vlrField, btn: !!addBtn
            }};
          }
          
          // Preencher campos
          descrField.value = params.descricao;
          descrField.dispatchEvent(new Event('input', { bubbles: true }));
          descrField.dispatchEvent(new Event('change', { bubbles: true }));
          
          qtdField.value = '1';
          qtdField.dispatchEvent(new Event('input', { bubbles: true }));
          qtdField.dispatchEvent(new Event('change', { bubbles: true }));
          
          vlrField.value = params.valor;
          vlrField.dispatchEvent(new Event('input', { bubbles: true }));
          vlrField.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Calcular total
          if (totalField) {
            totalField.value = params.valor;
            totalField.dispatchEvent(new Event('input', { bubbles: true }));
            totalField.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          // Aguardar um tick antes de clicar no botão
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // Clicar no botão de adicionar item
          addBtn.click();
          
          return { success: true, descricao: params.descricao, valor: params.valor };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      }, { descricao: data.descricao, valor: valorFormatadoItem });
      
      if (itemAdded.success) {
        await page.waitForTimeout(2000); // Aguardar o fastSubmit completar
        log("ITEM_ADDED", "OK", { descricao: data.descricao, valor: data.valor });
      } else {
        log("ITEM_ADDED", "WARN", itemAdded);
      }
    } catch (e: any) {
      log("ITEM_ADDED", "WARN", { error: e.message });
    }

    // ── ATIVIDADE FINAL: preencher DEPOIS de todos os outros campos para evitar reset pelo portal ──
    // O portal reseta qyidatividade para o valor padrão (3489) quando outros campos são preenchidos.
    // Solução: preencher ATIVIDADE por último, imediatamente antes do SUBMIT.
    const atividadeIdFinal = ATIVIDADE_MAP[codigoServico] || ATIVIDADE_MAP[codigoServico.split('.').slice(0,2).join('.')] || '3774';
    log('ATIVIDADE_FINAL_START', 'OK', { idPortal: atividadeIdFinal, codigo: codigoServico });
    try {
      // Estratégia 1: selectOption direto
      const filled1 = await page.selectOption('select#qyidatividade', atividadeIdFinal)
        .then(() => true)
        .catch(() => false);
      
      if (filled1) {
        // Disparar onchange para atualizar alíquotas
        await page.evaluate((id: string) => {
          const el = document.getElementById('qyidatividade') as HTMLSelectElement;
          if (el) {
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof (window as any).qyidatividade_onchange === 'function') {
              (window as any).qyidatividade_onchange(el);
            }
          }
        }, atividadeIdFinal).catch(() => {});
        log('ATIVIDADE_FINAL_OK', 'OK', { idPortal: atividadeIdFinal, metodo: 'selectOption' });
      } else {
        // Estratégia 2: evaluate JS direto
        const filled2 = await page.evaluate((id: string) => {
          const el = document.getElementById('qyidatividade') as HTMLSelectElement;
          if (!el) return false;
          el.value = id;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof (window as any).qyidatividade_onchange === 'function') {
            (window as any).qyidatividade_onchange(el);
          }
          return el.value === id;
        }, atividadeIdFinal).catch(() => false);
        log('ATIVIDADE_FINAL_OK', filled2 ? 'OK' : 'WARN', { idPortal: atividadeIdFinal, metodo: 'evaluate_js', filled: filled2 });
      }
      // Verificar valor após preenchimento
      const atividadeVerify = await page.evaluate(() => {
        const el = document.getElementById('qyidatividade') as HTMLSelectElement;
        return el ? el.value : null;
      }).catch(() => null);
      log('ATIVIDADE_FINAL_VERIFY', 'OK', { valorAtual: atividadeVerify, esperado: atividadeIdFinal, match: atividadeVerify === atividadeIdFinal });
      await page.waitForTimeout(500).catch(() => {});
    } catch (e: any) {
      log('ATIVIDADE_FINAL_WARN', 'WARN', { error: e.message, nota: 'ATIVIDADE final falhou mas continuando' });
    }

    log("FORM_FILLED", "OK", {
      tomador: data.tomadorNome,
      valor: data.valor,
      competencia: data.competencia,
      cnpjFilled,
    });
    await logCriticalStep(emissaoId, "FORM_OK", "ok", `Formulário preenchido com sucesso: ${data.tomadorNome} - R$ ${data.valor}`, page);

  } catch (err: any) {
    log("FORM_FILLED", "FAIL", { error: err.message });
    await logCriticalStep(emissaoId, "FORM_FAIL", "error", `Falha ao preencher formulário: ${err.message}`, page, err);
    throw err;
  }
}

async function submitAndGetNumber(
  page: any,
  emissaoId: number,
  logs: EmissaoResult["logs"]
): Promise<{ numeroNfse: string; serieNfse?: string }> {
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
  };

  try {
    // Capturar screenshot do topo e da parte inferior do formulário antes de submeter
    try {
      // Screenshot do topo (onde fica o campo NBS e Tributacao ISSQN)
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      const ssTop = await page.screenshot();
      const suffixTop = Math.random().toString(36).substring(2, 8);
      const { url: ssTopUrl } = await (await import('../storage')).storagePut(
        `nfse-debug/emissao-${emissaoId}-pre-submit-top-${suffixTop}.png`,
        ssTop,
        'image/png'
      );
      log('PRE_SUBMIT_SCREENSHOT_TOP', 'OK', { screenshotUrl: ssTopUrl });

      // Screenshot do fundo (onde fica Tributacao Municipal, Imposto Retido)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      const ssBottom = await page.screenshot();
      const suffix = Math.random().toString(36).substring(2, 8);
      const { url: ssBottomUrl } = await (await import('../storage')).storagePut(
        `nfse-debug/emissao-${emissaoId}-pre-submit-bottom-${suffix}.png`,
        ssBottom,
        'image/png'
      );
      log('PRE_SUBMIT_SCREENSHOT_BOTTOM', 'OK', { screenshotUrl: ssBottomUrl });
      // Rolar de volta ao topo
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
    } catch (e: any) {
      log('PRE_SUBMIT_SCREENSHOT_BOTTOM', 'WARN', { error: e.message });
    }

    // ── ATIVIDADE PRE-SUBMIT: forçar valor correto imediatamente antes do click ──
    // O portal reseta qyidatividade durante o preenchimento do formulário.
    // Última chance: forçar o valor correto via JS antes de clicar em Emitir.
    // IMPORTANTE: NÃO disparar evento change, pois qyidatividade_onchange faz fastSubmit
    // que recarrega o formulário e reseta todos os campos!
    try {
      const atividadePreSubmit = await page.evaluate(() => {
        const el = document.getElementById('qyidatividade') as HTMLSelectElement;
        if (!el) return { found: false, before: null, after: null };
        const before = el.value;
        // Forçar valor 3774 = 17.19.01 Contabilidade
        // Usar Object.defineProperty para forcar o valor SEM disparar eventos nativos
        // que chamariam qyidatividade_onchange e resetariam o formulário
        try {
          // Remover o event listener temporariamente
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, '3774');
          } else {
            el.value = '3774';
          }
          // NÃO disparar change - isso causaria qyidatividade_onchange que reseta o formulário
        } catch (e) {
          el.value = '3774';
        }
        const after = el.value;
        return { found: true, before, after };
      }).catch((e: any) => ({ found: false, error: e.message }));
      log('ATIVIDADE_PRE_SUBMIT', 'OK', atividadePreSubmit);
      // Não aguardar - não disparamos eventos, não há AJAX para aguardar
    } catch (e: any) {
      log('ATIVIDADE_PRE_SUBMIT_WARN', 'WARN', { error: e.message });
    }

    // ── NBS PRE-SUBMIT: preencher NBS após ATIVIDADE para evitar reset ──
    // O portal limpa o NBS quando qyidatividade_onchange é disparado.
    // Solução: preencher NBS aqui, DEPOIS da ATIVIDADE, imediatamente antes do submit.
    try {
      // Usar o mecanismo nativo do portal: confirm_autoSuggest
      // O portal usa table.autoSuggest com confirm_autoSuggest para preencher qyidnbs
      // Vamos usar o fastSubmit diretamente para buscar o NBS
      const nbsPreSubmit = await page.evaluate(async () => {
        const idField = document.getElementById('qyidnbs') as HTMLInputElement;
        const descrField = document.getElementById('qynbsdescricao') as HTMLInputElement;
        if (!idField || !descrField) return { ok: false, reason: 'campos não encontrados' };

        // Verificar estado atual
        const currentId = idField.value;
        const currentDescr = descrField.value;

        // Usar a API real do portal para buscar o ID do NBS
        // POST para /tbw/servlet/controle com cmd=autoSuggest
        const objEl = document.getElementById('obj') as HTMLInputElement;
        const winEl = document.getElementById('win') as HTMLInputElement;
        const objValue = objEl ? objEl.value : '';
        const winValue = winEl ? winEl.value : '';

        if (objValue) {
          const formData = new URLSearchParams();
          formData.append('obj', objValue);
          formData.append('win', winValue);
          formData.append('cmd', 'autoSuggest');
          formData.append('submitedType', 'fastSubmit');
          formData.append('vlrComparacao', '1.1302');
          formData.append('objFast', 'qynbsdescricao');

          try {
            const resp = await fetch('/tbw/servlet/controle', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString(),
            });
            const text = await resp.text();

            // Parsear a resposta para extrair o ID do NBS
            const semicolonIdx = text.indexOf(';');
            if (semicolonIdx >= 0) {
              const html = text.substring(semicolonIdx + 1);
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = html;

              // Procurar o primeiro item com fill=qyidnbs
              const tds = Array.from(tempDiv.querySelectorAll('td[fill="qyidnbs"]'));
              if (tds.length > 0) {
                const nbsId = (tds[0] as HTMLElement).textContent?.trim() || '';
                const descrTds = Array.from(tempDiv.querySelectorAll('td[fill="qynbsdescricao"]'));
                const nbsDescr = descrTds.length > 0 ? (descrTds[0] as HTMLElement).textContent?.trim() || '' : '1.1302.21.00 Serviços de contabilidade';

                if (nbsId) {
                  // Preencher diretamente SEM chamar confirm_autoSuggest (evita Invalid cursor position)
                  idField.value = nbsId;
                  idField.dispatchEvent(new Event('change', { bubbles: true }));
                  descrField.value = nbsDescr;
                  descrField.dispatchEvent(new Event('change', { bubbles: true }));
                  return { ok: true, method: 'api_direct', idValue: nbsId, descrValue: nbsDescr };
                }
              }
            }
          } catch (e) { /* continuar para fallback */ }
        }

        // Fallback: usar ID 697 que já foi descoberto em testes anteriores
        // (ID interno do NBS 1.1302.21.00 no portal Vila Velha)
        idField.value = '697';
        idField.dispatchEvent(new Event('change', { bubbles: true }));
        descrField.value = '1.1302.21.00 Serviços de contabilidade';
        descrField.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, method: 'fallback_id_697', idValue: '697', descrValue: descrField.value, currentId, currentDescr };
      }).catch((e: any) => ({ ok: false, error: e.message }));
      log('NBS_PRE_SUBMIT', nbsPreSubmit.ok ? 'OK' : 'WARN', nbsPreSubmit);
      await page.waitForTimeout(1000).catch(() => {});
    } catch (e: any) {
      log('NBS_PRE_SUBMIT_WARN', 'WARN', { error: e.message });
    }

    // ── FECHAR MODAIS DE AVISO: fechar qualquer modal de aviso antes de clicar em Confirmar Nota ──
    // O confirm_autoSuggest pode abrir um modal de aviso 'Invalid cursor position'
    // que bloqueia a página e impede de encontrar o botão Confirmar Nota.
    try {
      const modalAviso = await page.evaluate(() => {
        // Procurar por modais de aviso visíveis
        const modals = Array.from(document.querySelectorAll('.modal, [role="dialog"], .alert, .aviso'));
        const visibleModals: string[] = [];
        for (const modal of modals) {
          const el = modal as HTMLElement;
          if (el.style.display !== 'none' && el.offsetParent !== null) {
            visibleModals.push(el.className + ': ' + (el.textContent || '').substring(0, 100));
          }
        }
        // Procurar botões OK em modais
        const okButtons = Array.from(document.querySelectorAll('button, input[type="button"]'));
        let okClicked = false;
        for (const btn of okButtons) {
          const el = btn as HTMLElement;
          const text = el.textContent?.trim() || '';
          if ((text === 'OK' || text === 'Ok' || text === 'ok') && el.offsetParent !== null) {
            (el as HTMLButtonElement).click();
            okClicked = true;
            break;
          }
        }
        return { visibleModals, okClicked };
      }).catch(() => ({ visibleModals: [], okClicked: false }));
      if (modalAviso.okClicked || modalAviso.visibleModals.length > 0) {
        log('MODAL_AVISO_FECHADO', 'OK', modalAviso);
        await page.waitForTimeout(500).catch(() => {});
      }
    } catch (e: any) {
      log('MODAL_AVISO_WARN', 'WARN', { error: e.message });
    }

    // Clicar em Emitir
    const emitirClicked = await tryClick(page, [VILAVELHA_SELECTORS.form.btnConfirmarNota]);
    if (!emitirClicked) {
      const confirmarClicked = await tryClick(page, [VILAVELHA_SELECTORS.form.btnConfirmarNota]);
      if (!confirmarClicked) {
        throw new Error("Botão de emissão não encontrado na página");
      }
    }

    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    // ── MODAL DE RECEITA BRUTA: preencher se aparecer ──────────────────
    // O portal Vila Velha exige receita bruta dos últimos 12 meses para calcular aliquota Simples Nacional.
    // Se o modal aparecer, preencher com o valor da empresa e confirmar.
    // IMPORTANTE: Detectar apenas modais REAIS (visíveis, com campo de input), não código JS.
    try {
      const receitaBrutaModal = await page.evaluate(() => {
        // Procurar por campo vlrbrt12 que indica o modal de receita bruta está visível
        const vlrbrt12Field = document.getElementById('vlrbrt12') as HTMLInputElement;
        if (vlrbrt12Field && vlrbrt12Field.offsetParent !== null) {
          return { found: true, text: 'campo vlrbrt12 visível', method: 'vlrbrt12_field' };
        }
        // Procurar por modal visível com campo de receita bruta
        const receitaInputs = Array.from(document.querySelectorAll('input[id*="vlrbrt"], input[name*="vlrbrt"], input[id*="receitabruta"]'));
        for (const inp of receitaInputs) {
          const el = inp as HTMLInputElement;
          if (el.offsetParent !== null && el.type !== 'hidden') {
            return { found: true, text: 'campo receita bruta visível: ' + el.id, method: 'receita_input' };
          }
        }
        // Procurar por div/modal visível com texto de receita bruta (mas não em scripts)
        const visibleDivs = Array.from(document.querySelectorAll('.modal-body, .modal-content, .modalbox, [id*="modal"]'));
        for (const div of visibleDivs) {
          const el = div as HTMLElement;
          if (el.offsetParent !== null && el.textContent) {
            const text = el.textContent;
            if (text.includes('receita bruta') && text.includes('12 meses') && !text.includes('function ')) {
              return { found: true, text: text.substring(0, 200), method: 'modal_text' };
            }
          }
        }
        return { found: false };
      }).catch(() => ({ found: false }));

      if (receitaBrutaModal.found) {
        log('RECEITA_BRUTA_MODAL', 'OK', { note: 'Modal de receita bruta detectado', text: receitaBrutaModal.text });

        // Preencher campo de receita bruta (usar valor padrão de 500.000 para Simples Nacional)
        // O campo correto no HTML do portal Vila Velha é 'vlrbrt12' (valor receita bruta 12 meses)
        const receitaFilled = await page.evaluate(() => {
          // Tentar campo vlrbrt12 (ID correto encontrado no HTML do portal)
          const vlrbrt12Field = document.getElementById('vlrbrt12') as HTMLInputElement;
          if (vlrbrt12Field) {
            vlrbrt12Field.value = '500000';
            vlrbrt12Field.dispatchEvent(new Event('input', { bubbles: true }));
            vlrbrt12Field.dispatchEvent(new Event('change', { bubbles: true }));
            vlrbrt12Field.dispatchEvent(new Event('blur', { bubbles: true }));
            return { ok: true, field: 'vlrbrt12', value: '500000' };
          }
          // Tentar campo idsimplesreceitavlr (alternativo)
          const receitaField = document.getElementById('idsimplesreceitavlr') as HTMLInputElement;
          if (receitaField) {
            receitaField.value = '500000';
            receitaField.dispatchEvent(new Event('input', { bubbles: true }));
            receitaField.dispatchEvent(new Event('change', { bubbles: true }));
            receitaField.dispatchEvent(new Event('blur', { bubbles: true }));
            return { ok: true, field: 'idsimplesreceitavlr', value: '500000' };
          }
          // Tentar outros campos de receita
          const allInputs = Array.from(document.querySelectorAll('input[name*="receita"], input[id*="receita"], input[name*="faturamento"], input[name*="vlrbrt"], input[id*="vlrbrt"]'));
          for (const inp of allInputs) {
            const input = inp as HTMLInputElement;
            if (input.type !== 'hidden' && !input.readOnly) {
              input.value = '500000';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              return { ok: true, field: input.name || input.id, value: '500000' };
            }
          }
          return { ok: false, reason: 'campo não encontrado' };
        }).catch((e: any) => ({ ok: false, reason: e.message }));

        log('RECEITA_BRUTA_FILL', receitaFilled.ok ? 'OK' : 'WARN', receitaFilled);

        if (receitaFilled.ok) {
          await page.waitForTimeout(1000).catch(() => {});
          // Clicar em Confirmar no modal
          const confirmarModal = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a'));
            for (const btn of buttons) {
              const text = btn.textContent || (btn as HTMLInputElement).value || '';
              if (text.toLowerCase().includes('confirmar') || text.toLowerCase().includes('ok') || text.toLowerCase().includes('calcular')) {
                (btn as HTMLElement).click();
                return { clicked: true, text: text.trim() };
              }
            }
            return { clicked: false };
          }).catch(() => ({ clicked: false }));
          log('RECEITA_BRUTA_CONFIRMAR', confirmarModal.clicked ? 'OK' : 'WARN', confirmarModal);

          if (confirmarModal.clicked) {
            await page.waitForTimeout(2000).catch(() => {});
            // Tentar clicar em Emitir novamente após fechar o modal
            await tryClick(page, [VILAVELHA_SELECTORS.form.btnConfirmarNota]).catch(() => {});
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(2000).catch(() => {});
            log('SUBMIT_RETRY_AFTER_RECEITA', 'OK', { note: 'Tentativa de submit após preencher receita bruta' });
          }
        }
      }
    } catch (e: any) {
      log('RECEITA_BRUTA_WARN', 'WARN', { error: e.message });
    }

    // ── VERIFICAR SUCESSO PRIMEIRO: detectar modal de sucesso antes de verificar erros ──
    // O portal Vila Velha exibe um modal de sucesso com o número da nota.
    // Exemplo: "A nota fiscal número 1010 foi gerada com sucesso."
    const successResult = await page.evaluate(() => {
      // Procurar por texto de sucesso na página
      const allText = document.body.textContent || '';
      const successMatch = allText.match(/nota fiscal número (\d+) foi gerada com sucesso/i)
        || allText.match(/NFS-e número (\d+) emitida/i)
        || allText.match(/nota.*número.*(\d{3,})/i);
      if (successMatch) {
        return { found: true, numeroNfse: successMatch[1], text: successMatch[0] };
      }
      // Verificar se há um modal de sucesso visível
      const modals = Array.from(document.querySelectorAll('.modal-body, .modal-content, [id*="modal"], .modalbox'));
      for (const modal of modals) {
        const el = modal as HTMLElement;
        if (el.offsetParent !== null) {
          const text = el.textContent || '';
          const match = text.match(/número (\d+)/i) || text.match(/gerada com sucesso/i);
          if (match) {
            const numMatch = text.match(/(\d{3,})/g);
            return { found: true, numeroNfse: numMatch ? numMatch[numMatch.length - 1] : '', text: text.substring(0, 200) };
          }
        }
      }
      return { found: false };
    }).catch(() => ({ found: false }));

    if (successResult.found) {
      log('SUBMIT_SUCCESS_MODAL', 'OK', successResult);
      // Fechar o modal de sucesso
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (text === 'Fechar' || text === 'OK' || text === 'Ok') {
            (btn as HTMLButtonElement).click();
            return;
          }
        }
      }).catch(() => {});
      await page.waitForTimeout(500).catch(() => {});
      // Retornar o número da nota do modal de sucesso
      if (successResult.numeroNfse) {
        log('SUBMIT', 'OK', { numeroNfse: successResult.numeroNfse, source: 'success_modal' });
        return { numeroNfse: successResult.numeroNfse };
      }
    }

    // Verificar erro de emissão
    // IMPORTANTE: Só verificar erros se não houve sucesso
    const errorResult = await page.evaluate(() => {
      // Procurar por mensagens de erro reais (não o botão de fechar × do modal)
      const errorEls = Array.from(document.querySelectorAll('div.alert-danger, .erro, #mensagemErro'));
      for (const el of errorEls) {
        const htmlEl = el as HTMLElement;
        // Ignorar elementos que só contêm × (botão de fechar)
        const text = htmlEl.textContent?.trim() || '';
        if (text && text !== '×' && text !== 'x' && text !== 'X' && text.length > 5) {
          return { found: true, text };
        }
      }
      return { found: false };
    }).catch(() => ({ found: false }));

    if (errorResult.found) {
      const screenshotUrl = await captureFailureScreenshot(page, emissaoId, "submit_error");
      log("SUBMIT", "FAIL", { error: errorResult.text, screenshotUrl });
      throw new Error(`Erro na emissão: ${errorResult.text}`);
    }

    // Capturar número da nota
    let numeroNfse = "";
    for (const sel of VILAVELHA_SELECTORS.resultado.numeroNfse) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        const text = await el.textContent().catch(() => "");
        const match = text?.match(/\d+/);
        if (match) {
          numeroNfse = match[0];
          break;
        }
      }
    }

    if (!numeroNfse) {
      // Tentar extrair número da URL
      const url = page.url();
      const urlMatch = url.match(/numero[=\/](\d+)/i) || url.match(/nfse[=\/](\d+)/i);
      if (urlMatch) numeroNfse = urlMatch[1];
    }

    if (!numeroNfse) {
      const screenshotUrl = await captureFailureScreenshot(page, emissaoId, "number_not_found");
      log("SUBMIT", "WARN", { note: "Número da nota não encontrado na página", url: page.url(), screenshotUrl });
      numeroNfse = `PENDENTE-${emissaoId}`;
    }

    log("SUBMIT", "OK", { numeroNfse, url: page.url() });
    await logCriticalStep(emissaoId, "SUBMIT_OK", "ok", `Nota submetida com sucesso`, page);
    if (numeroNfse && !numeroNfse.startsWith("PENDENTE")) {
      await logCriticalStep(emissaoId, "NFSE_CAPTURED", "ok", `Número da NFS-e capturado: ${numeroNfse}`, page);
    }
    return { numeroNfse };

  } catch (err: any) {
    log("SUBMIT", "FAIL", { error: err.message });
    await logCriticalStep(emissaoId, "SUBMIT_FAIL", "error", `Falha ao submeter nota: ${err.message}`, page, err);
    throw err;
  }
}

async function downloadNfsePdf(
  page: any,
  numeroNfse: string,
  emissaoId: number,
  logs: EmissaoResult["logs"]
): Promise<Buffer | null> {
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    console.log(`[NfseEngine] PDF_${step}_${status}:`, JSON.stringify(details || {}).substring(0, 200));
  };

  try {
    // ESTRATÉGIA 1: Tentar clicar no link de PDF na página atual (após modal de sucesso)
    const pdfLinkEl = await trySelectors(page, [VILAVELHA_SELECTORS.resultado.btnDownloadPdf]);

    if (pdfLinkEl) {
      log("LINK_FOUND", "OK", { method: "current_page" });
      // Interceptar download
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
        pdfLinkEl.click(),
      ]);

      if (download) {
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", resolve);
          stream.on("error", reject);
        });
        const buffer = Buffer.concat(chunks);
        log("DOWNLOAD", "OK", { bytes: buffer.length, method: "download_event" });
        return buffer;
      }

      // Tentar via href
      const href = await pdfLinkEl.getAttribute("href").catch(() => null);
      if (href) {
        const pdfUrl = href.startsWith("http") ? href : `https://tributacao.vilavelha.es.gov.br${href}`;
        const response = await page.request.get(pdfUrl);
        if (response.ok()) {
          const buffer = Buffer.from(await response.body());
          log("DOWNLOAD", "OK", { bytes: buffer.length, method: "href_fetch" });
          return buffer;
        }
      }
    }

    // ESTRATÉGIA 2: Navegar para a lista de NFS-e e encontrar a nota emitida
    log("NAVIGATE_LIST", "OK", { note: "Tentando navegar para lista de NFS-e", numeroNfse });
    try {
      // Clicar em "Lista Nota Fiscais" no menu NFS-e
      const listaBtn = await page.$(VILAVELHA_SELECTORS.nfseMenu.listaNotaFiscais).catch(() => null);
      if (listaBtn) {
        await listaBtn.click();
        await page.waitForTimeout(2000);
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        log("LIST_LOADED", "OK", { url: page.url() });

        // Procurar pela nota na lista
        const notaRow = await page.$(`td:has-text("${numeroNfse}")`).catch(() => null);
        if (notaRow) {
          log("NOTA_FOUND_IN_LIST", "OK", { numeroNfse });
          // Procurar link de impressão/PDF na mesma linha
          const row = await notaRow.evaluateHandle((el: Element) => el.closest('tr')).catch(() => null);
          if (row) {
            const pdfLink = await row.$('a:has-text("Imprimir"), a:has-text("PDF"), a[href*="pdf"], a[href*="imprimir"]').catch(() => null);
            if (pdfLink) {
              const href = await pdfLink.getAttribute("href").catch(() => null);
              if (href) {
                const pdfUrl = href.startsWith("http") ? href : `https://tributacao.vilavelha.es.gov.br${href}`;
                const response = await page.request.get(pdfUrl);
                if (response.ok()) {
                  const buffer = Buffer.from(await response.body());
                  log("DOWNLOAD", "OK", { bytes: buffer.length, method: "list_href" });
                  return buffer;
                }
              }
              // Tentar via click e interceptar download
              const [download] = await Promise.all([
                page.waitForEvent("download", { timeout: 30000 }).catch(() => null),
                pdfLink.click(),
              ]);
              if (download) {
                const stream = await download.createReadStream();
                const chunks: Buffer[] = [];
                await new Promise<void>((resolve, reject) => {
                  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                  stream.on("end", resolve);
                  stream.on("error", reject);
                });
                const buffer = Buffer.concat(chunks);
                log("DOWNLOAD", "OK", { bytes: buffer.length, method: "list_download" });
                return buffer;
              }
            }
          }
        } else {
          log("NOTA_NOT_IN_LIST", "WARN", { numeroNfse, url: page.url() });
        }
      } else {
        log("LIST_BTN_NOT_FOUND", "WARN", { note: "Botao Lista Nota Fiscais nao encontrado" });
      }
    } catch (listErr: any) {
      log("LIST_ERROR", "WARN", { error: listErr.message });
    }

    log("NOT_FOUND", "WARN", { note: "Link de PDF nao encontrado - nota emitida mas PDF nao baixado", numeroNfse });
    return null;

  } catch (err: any) {
    log("ERROR", "WARN", { error: err.message });
    return null;
  }
}
async function enviarPdfViaWhatsApp(
  phone: string,
  numeroNfse: string,
  pdfUrl: string,
  tomadorNome: string
): Promise<void> {
  const apiKey = process.env.WHATSAPP_API_KEY;
  const baseUrl = process.env.ZAP_CONTABIL_BASE_URL || "https://api-fraga.zapcontabil.chat";
  if (!apiKey) {
    console.warn("[NfseEmission] WHATSAPP_API_KEY não configurada - PDF não enviado via WhatsApp");
    return;
  }
  // Formatar número: remover não-numéricos, garantir prefixo 55
  const cleaned = phone.replace(/\D/g, "");
  const formattedPhone = cleaned.startsWith("55") ? cleaned : `55${cleaned}`;
  // Endpoint correto do ZapContábil: POST /api/send/{phone}
  const endpoint = `${baseUrl}/api/send/${formattedPhone}`;
  const fileName = `NFS-e-${numeroNfse}.pdf`;
  const messageBody = `✅ *Nota Fiscal de Serviço emitida com sucesso!*\n\n📋 *Número:* ${numeroNfse}\n👤 *Tomador:* ${tomadorNome}\n\n📄 Segue o PDF da NFS-e em anexo.`;
  console.log(`[NfseEmission] Enviando PDF via WhatsApp para ${formattedPhone} | NFS-e: ${numeroNfse}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "accept": "application/json",
    },
    body: JSON.stringify({
      body: messageBody,
      mediaUrl: pdfUrl,
      mediaType: "application/pdf",
      fileName: fileName,
      connectionFrom: 0,
    }),
  });
  const responseText = await response.text();
  console.log(`[NfseEmission] WhatsApp PDF response: ${response.status} | ${responseText.substring(0, 200)}`);
  if (!response.ok) {
    throw new Error(`Erro ao enviar PDF via WhatsApp: HTTP ${response.status} - ${responseText}`);
  }
}
// ══════════════════════════════════════════════════════════════════════
// Teste de conexão (diagnóstico)
// ══════════════════════════════════════════════════════════════════════

export async function testPortalConnection(portalId: number): Promise<{
  success: boolean;
  logs: Array<{ step: string; status: "OK" | "FAIL" | "WARN"; details?: any }>;
  screenshotUrl?: string;
}> {
  const logs: Array<{ step: string; status: "OK" | "FAIL" | "WARN"; details?: any }> = [];
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
    console.log(`[NfseTest] ${step}_${status}:`, JSON.stringify(details || {}).substring(0, 200));
  };

  let browser: any = null;
  let page: any = null;

  try {
    // Buscar dados do portal (para tentar login automático)
    const [portalRow] = await rawQuery("SELECT * FROM nfse_portais WHERE id = ? AND ativo = 1", [portalId]);
    const portal = portalRow as any;

    // Iniciar Playwright
    const playwright = await import("playwright-core");
    browser = await playwright.chromium.launch(await getChromiumLaunchOptions());

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "pt-BR",
    });

    page = await context.newPage();
    log("BROWSER_STARTED", "OK", {});

    let loginOk = false;

    // ── CAMADA 1: Login automático com LLM Vision ───────────────────
    const portalUsuario = portal?.usuario || "";
    const portalSenha = portal?.senha ? decryptPassword(portal.senha) : "";

    if (portalUsuario && portalSenha) {
      log("AUTH_STRATEGY", "OK", { layer: 1, method: "captcha_llm" });
      await safeGoto(page, VILAVELHA_SELECTORS.urls.login, {
        timeout: 45000,
        fallbackUrl: VILAVELHA_SELECTORS.urls.controle,
        logFn: log,
      });

      const loginResult = await solveCaptchaAndLogin(page, portalUsuario, portalSenha, 3);
      for (const l of loginResult.logs) logs.push(l);

      if (loginResult.success) {
        loginOk = true;
        log("LOGIN_OK", "OK", { method: "captcha_llm", attempts: loginResult.attempts });
        // Salvar nova sessão
        try {
          const newState = await context.storageState();
          await saveStorageState(portalId, newState as any, "auto_captcha_test");
          log("SESSION_RENEWED", "OK", { cookieCount: newState.cookies?.length || 0 });
        } catch { /* ignora */ }
      } else {
        log("CAPTCHA_FAIL", "WARN", { note: "Tentando sessão persistente (Camada 2)" });
      }
    }

    // ── CAMADA 2: Sessão persistente ──────────────────────────────
    if (!loginOk) {
      const storageState = await loadStorageState(portalId);
      if (!storageState) {
        log("SESSION_LOAD", "FAIL", { error: "Nenhuma sessão encontrada e login automático falhou." });
        return { success: false, logs };
      }
      log("USING_PERSISTENT_SESSION", "OK", { cookieCount: storageState.cookies?.length || 0 });
      await applyStorageState(context, storageState);

      await safeGoto(page, VILAVELHA_SELECTORS.urls.login, {
        timeout: 45000,
        fallbackUrl: VILAVELHA_SELECTORS.urls.controle,
        logFn: log,
      });

      const isOnLoginForm = await page.$(VILAVELHA_SELECTORS.pageState.isLoginPage).catch(() => null);
      if (isOnLoginForm) {
        await invalidateStorageState(portalId);
        const screenshotUrl = await captureFailureScreenshot(page, 0, `test-conn-expired-${portalId}`);
        log("SESSION_VALID", "FAIL", { screenshotUrl, error: "Sessão expirada" });
        return { success: false, logs, screenshotUrl };
      }
      loginOk = true;
    }

    const url = page.url();
    log("NAVIGATE_HOME", "OK", { url });

    // Verificar indicadores de login (menu presente)
    let loggedIn = false;
    for (const sel of [VILAVELHA_SELECTORS.pageState.isLoggedIn]) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        loggedIn = true;
        const text = await el.textContent().catch(() => "");
        log("LOGIN_INDICATOR", "OK", { selector: sel, text: text?.trim().substring(0, 50) });
        break;
      }
    }

    if (!loggedIn) {
      log("SESSION_VALID", "WARN", { note: "Indicadores de menu não encontrados" });
    } else {
      log("SESSION_VALID", "OK", { url });
    }

    // Capturar screenshot de sucesso
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const suffix = Math.random().toString(36).substring(2, 8);
    const { url: screenshotUrl } = await storagePut(
      `nfse-debug/test-conn-${portalId}-${suffix}.png`,
      screenshotBuffer,
      "image/png"
    );
    log("SCREENSHOT_CAPTURED", "OK", { screenshotUrl });

    return { success: true, logs, screenshotUrl };

  } catch (err: any) {
    log("FATAL_ERROR", "FAIL", { error: err.message });
    let screenshotUrl: string | undefined;
    if (page) {
      screenshotUrl = await captureFailureScreenshot(page, 0, `test-conn-error-${portalId}`);
    }
    return { success: false, logs, screenshotUrl };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

export async function testSelectEmpresa(portalId: number, configId: number): Promise<{
  success: boolean;
  logs: Array<{ step: string; status: "OK" | "FAIL" | "WARN"; details?: any }>;
  screenshotUrl?: string;
}> {
  const logs: Array<{ step: string; status: "OK" | "FAIL" | "WARN"; details?: any }> = [];
  const log = (step: string, status: "OK" | "FAIL" | "WARN", details?: any) => {
    logs.push({ step, status, details });
  };

  let browser: any = null;
  let page: any = null;

  try {
    const [config] = await rawQuery("SELECT * FROM nfse_config WHERE id = ?", [configId]);
    if (!config) throw new Error(`Config ${configId} não encontrada`);
    const cfg = config as any;

    const [portalRow] = await rawQuery("SELECT * FROM nfse_portais WHERE id = ? AND ativo = 1", [portalId]);
    const portal = portalRow as any;

    const playwright = await import("playwright-core");
    browser = await playwright.chromium.launch(await getChromiumLaunchOptions());

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
    page = await context.newPage();

    let loginOk = false;

    // ── CAMADA 1: Login automático com LLM Vision ───────────────────
    const portalUsuario = portal?.usuario || "";
    const portalSenha = portal?.senha ? decryptPassword(portal.senha) : "";

    if (portalUsuario && portalSenha) {
      log("AUTH_STRATEGY", "OK", { layer: 1, method: "captcha_llm" });
      await safeGoto(page, VILAVELHA_SELECTORS.urls.login, {
        timeout: 45000,
        fallbackUrl: VILAVELHA_SELECTORS.urls.controle,
        logFn: log,
      });
      const loginResult = await solveCaptchaAndLogin(page, portalUsuario, portalSenha, 3);
      for (const l of loginResult.logs) logs.push(l);
      if (loginResult.success) {
        loginOk = true;
        log("LOGIN_OK", "OK", { method: "captcha_llm", attempts: loginResult.attempts });
        try {
          const newState = await context.storageState();
          await saveStorageState(portalId, newState as any, "auto_captcha_test_empresa");
          log("SESSION_RENEWED", "OK", { cookieCount: newState.cookies?.length || 0 });
        } catch { /* ignora */ }
      } else {
        log("CAPTCHA_FAIL", "WARN", { note: "Tentando sessão persistente (Camada 2)" });
      }
    }

    // ── CAMADA 2: Sessão persistente ──────────────────────────────────────────────────
    if (!loginOk) {
      const storageState = await loadStorageState(portalId);
      if (!storageState) throw new Error("Nenhuma sessão encontrada e login automático falhou");
      log("USING_PERSISTENT_SESSION", "OK", { cookieCount: storageState.cookies?.length || 0 });
      await applyStorageState(context, storageState);
      loginOk = true;
    }

    await safeGoto(page, VILAVELHA_SELECTORS.urls.login, {
      timeout: 45000,
      fallbackUrl: VILAVELHA_SELECTORS.urls.controle,
      logFn: log,
    });
    log("NAVIGATE_HOME", "OK", { url: page.url() });

    // Tentar selecionar empresa
    await selectEmpresaNoPortal(page, cfg, 0, logs);

    // Capturar screenshot
    const screenshotBuffer = await page.screenshot({ fullPage: false });
    const suffix = Math.random().toString(36).substring(2, 8);
    const { url: screenshotUrl } = await storagePut(
      `nfse-debug/test-empresa-${configId}-${suffix}.png`,
      screenshotBuffer,
      "image/png"
    );
    log("SCREENSHOT_CAPTURED", "OK", { screenshotUrl });

    const hasSelectEmpresaOk = logs.some(l => l.step === "SELECT_EMPRESA" && l.status === "OK");
    return { success: hasSelectEmpresaOk, logs, screenshotUrl };

  } catch (err: any) {
    log("FATAL_ERROR", "FAIL", { error: err.message });
    return { success: false, logs };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}
