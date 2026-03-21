import "dotenv/config";
import superjson from "superjson";
import cookieParser from "cookie-parser";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { processReceivedMessage } from "../webhookHandler";
import contaAzulOAuthRouter from "../contaAzulOAuthEndpoint";
import authRestRouter from "../authRestRouter";
import contaAzulPingRouter from "../contaAzulPingRouter";
import oauthRefreshProofRouter from "../oauthRefreshProofRouter";
import apiDataValidationRouter from "../apiDataValidationRouter";
import panelAuthProofRouter from "../panelAuthProofRouter";
import panelSessionProofRouter from "../panelSessionProofRouter";
import panelCookieTestRouter from "../panelCookieTestRouter";
import panelD1ProofRouter from '../panelD1ProofRouter.js';
import panelAuthProofV2Router from '../panelAuthProofV2Router.js';
import sendFromExistingPdfRouter from '../sendFromExistingPdfRouter.js';
// import zapAuthProofRouter from '../zapAuthProofRouter.js'; // Substituído por server/zap/zapAuthProofRouter
import zapEnvDebugRouter from '../zapEnvDebugRouter.js';
import zapAuthHardcodedRouter from '../zapAuthHardcodedRouter.js';
import zapGetSignedUrlRouter from '../zapGetSignedUrlRouter.js';
import planoBE2ERouter from '../planoBE2ERouter.js';
import testPdfAttachmentRouter from '../testPdfAttachmentRouter.js';
import zapPdfFormatDiscoveryRouter from '../zapPdfFormatDiscoveryRouter.js';
import etapa4DiscoveryRouter from '../etapa4DiscoveryRouter.js';
import etapa4ProofRouter from '../etapa4ProofRouter.js';
import sendMultipartProofRouter from '../sendMultipartProofRouter.js';
import etapa4FinalRouter from '../etapa4FinalRouter.js';
import sendExistingFileMultipartRouter from '../sendExistingFileMultipartRouter.js';
import etapa5TestRealRouter from '../etapa5TestRealRouter.js';
import contaAzulAuthUrlRouter from "../contaAzulAuthUrlRouter";
import oauthDbDumpRouter from "../oauthDbDumpRouter";
import contaAzulSyncPublicRouter from "../contaAzulSyncPublicRouter";
import { handleContaAzulCallback } from "../contaAzulCallbackHandler";
import { initializeCacheManager, shutdownCacheManager } from "../cacheManager";
import { initializeSyncDataJob, stopSyncDataJob } from "../syncDataJob";
import { initializeCollectionDayFiveJob, stopCollectionDayFiveJob } from "../collectionDayFiveJob";
import { initializeR7CollectionJob, stopR7CollectionJob } from "../r7GeradorasCollectionJob";
import { iniciarMonitorBoletos, pararMonitorBoletos } from "../r7BoletosMonitor";
import contaAzulWebhookRouter from "../contaAzulWebhook";
import { initCollectionScheduler, stopCollectionScheduler } from "../collectionScheduler";
// O cron novo (contaAzulTokenRefreshCron) não depende de OAUTH_TOKEN_CHECK_ENABLED
import { startTokenRefreshCron as startNewTokenRefreshCron, stopTokenRefreshCron as stopNewTokenRefreshCron } from "../contaAzulTokenRefreshCron";
import { initCertSyncScheduler } from "../jobs/certSyncScheduler.js";
import { initializeCollectionCron } from "../automatedCollectionJob";
import dispatchTestRouter from "../dispatchTestRouter";
// import whatsappDispatchRouter from "../whatsappDispatchRouter"; // DISABLED: Requer Redis
// import { startWhatsappDispatchWorker, stopWhatsappDispatchWorker } from "../workers/whatsappDispatchWorker"; // DISABLED: Requer Redis
import { startSyncPaymentsJob, stopSyncPaymentsJob } from "../syncPaymentsJob";
import nfseRestRouter from "../nfseRestRouter";
import { startSyncScheduler, stopSyncScheduler } from "../syncScheduler";
import { startPricingScheduler } from "../pricingScheduler";
import enrichReceiverableRouter from "../enrichReceiverableRouter";
import oauthBypassRouter from "../oauthBypassRouter";
import diagnosticRouter from "../diagnosticRouter";
import { startPrechargeScheduler, stopPrechargeScheduler } from "../jobs/prechargeScheduler";
import testPrechargeRouter from "../testPrechargeRouter";
import { initReactivationScheduler, stopReactivationScheduler } from "../jobs/reactivationScheduler";
import { initReguaJob, stopReguaJob, executeReguaJob } from "../jobs/reguaCobrancaJob";
import { startAllJobs } from "../jobs/jobScheduler";
import testReactivationRouter from "../testReactivationRouter";
import auditReportRouter from "../auditReportRouter";
import adminWhatsappRouter from "../adminWhatsappRouter";
import adminCertificatesRouter from "../adminCertificatesRouter";
import nfseRealEmissionRouter from "../nfseRealEmissionRouter";
import nfseDiagnosticRouter from "../nfseDiagnosticRouter";
import nfseCancelRouter from "../nfseCancelRouter";
// import nfseAsyncEmissionRouter from "../nfseAsyncEmissionRouter"; // DISABLED: Requer Redis
import { webhookDebugRouter } from "../routes/webhookDebug";
// DISABLED: setor-nota-fiscal desativado para evitar loop duplo
// import { zapcontabilWebhookNfseRouter } from "../routes/zapcontabilWebhookNfse";
import { zapcontabilWebhookTagRouter } from "../routes/zapcontabilWebhookTag";
import { zapcontabilWebhookMessageTagRouter } from "../routes/zapcontabilWebhookMessageTag";
import { zapcontabilWebhookTagSimpleRouter } from "../routes/zapcontabilWebhookTagSimple";
import { zapcontabilWebhookTransferRouter } from "../routes/zapcontabilWebhookTransfer";
// DISABLED: rota NF antiga substituída pelo agente Claude
// import { zapcontabilWebhookMessageNFRouter } from "../routes/zapcontabilWebhookMessageNF";
import { zapcontabilWebhookMessageSetorRouter } from "../routes/zapcontabilWebhookMessageSetor";
import { zapcontabilWebhookAliasesRouter } from "../routes/zapcontabilWebhookAliases";
// DISABLED: máquina de estados antiga substituída pelo agente Claude
import { zapcontabilWebhookMessageRouter } from "../routes/zapcontabilWebhookMessage";
import { testNfseFlowSimulatorRouter } from "../routes/testNfseFlowSimulator";
import nfseEmissionWebhookRouter from "../routes/nfseEmissionWebhook";
import testSchedulerIntegrityRouter from "../testSchedulerIntegrityRouter";
import dataQualityRouter from "../dataQualityRouter";
import dataQualitySanitationRouter from "../dataQualitySanitationRouter";
import dataQualitySyncRouter from "../dataQualitySyncRouter";
import dataQualityResolveRouter from "../dataQualityResolveRouter";
import dataQualityMatchAssistedRouter from "../dataQualityMatchAssistedRouter";
import contaAzulDiagRouter from "../contaAzulDiagRouter";
import resolvePersonIdManualRouter from "../resolvePersonIdManualRouter";
import contaAzulApiTestRouter from "../contaAzulApiTestRouter";
import contaAzulEndpointDiscoveryRouter from "../contaAzulEndpointDiscoveryRouter";
import contaAzulDebugRouter from "../contaAzulDebugRouter";
import contaAzulPessoasSampleRouter from "../contaAzulPessoasSampleRouter";
import contaAzulCreatePersonTestRouter from "../contaAzulCreatePersonTestRouter";
import contaAzulSyncPeopleRouter from "../contaAzulSyncPeopleRouter";
import contaAzulTestCreatePersonRouter from "../contaAzulTestCreatePersonRouter";
import contaAzulGenerateCsvRouter from "../contaAzulGenerateCsvRouter";
import discoverUploadEndpointRouterNoRedis from "../discover-upload-endpoint-no-redis";
import metaEndpointsRouter from "../metaEndpointsRouter";
import discoverUploadEndpointRouter from "../discover-upload-endpoint-router";
import r7AcceptanceRouter from "../r7-acceptance-endpoints-fixed";
import testEmpresaRouter from "../testEmpresaRouter";
import contaAzulParseContractsRouter from "../contaAzulParseContractsRouter";
import dataQualityParseClientsCsvRouter from "../dataQualityParseClientsCsvRouter";
import dataQualityDebugRouter from "../dataQualityDebugRouter";
import contaAzulImportClientsRouter from "../contaAzulImportClientsRouter";
import contaAzulTenantCheckRouter from "../contaAzulTenantCheckRouter";
import debugEnvRouter from "../debugEnvRouter";
import peopleScanRouter from "../peopleScanRouter";
import personDetailRouter from "../personDetailRouter";
import reactivationBatchRouter from "../reactivationBatchRouter";
import contaAzulDiagnosticsRouter from "../contaAzulDiagnosticsRouter";
import contaAzulE2ETestRouter from "../contaAzulE2ETestRouter";
import contaAzulStatusEndpoint from "../contaAzulStatusEndpoint";
import contaAzulCallbackRouter from "../contaAzulCallbackRouter";
import healthCheckRouter from "../healthCheckRouter";
import collectionBatchRouter from "../collection/collectionBatchRouter";
import sendBatchRouter from "../collection/sendBatchRouter";
import cronControlRouter from "../collection/cronControlRouter";
import syncNowRouter from "../collection/syncNowRouter";
import fullSyncRouter from "../fullSyncRouter";
import debugEligibilityRouter from "../collection/debugEligibilityRouter";
import eligibleClientsRouter from "../collection/eligibleClientsRouter";
import pingRouter from "../collection/pingRouter";
import { startCronScheduler, startAlertScheduler, runCatchUpIfNeeded, startCronWatchdog, initCronStateFromDb } from "../collection/cronScheduler";
import { startCertificateWatcher } from "../services/certificateScannerService";
import { restoreCertificatesFromDb } from "../certificateUploadRouter";
import escalationRouter from "../collection/escalationRouter";
import legalRouter from "../collection/legalRouter";
import inboundRouter from "../collection/inboundRouter";
import followupRouter from "../collection/followupRouter";
import zapContabilWebhookRouter from "../webhooks/zapContabilWebhookRouter";
import { logFeatureFlags } from "./featureFlags";
import { apiNotFoundMiddleware } from "../apiNotFoundMiddleware";
import dashboardMetricsRouter from "../dashboardMetricsRouter";
import dashboardMetricsAuditRouter from "../dashboardMetricsAuditRouter";
import contaAzulProbeRouter from "../contaAzulProbeRouter";
import r7DispatchTestEndpoints from "../r7-dispatch-test-endpoints";
import r2SmokeTestRouter from "../r2-smoke-test";
import r7SendRealRouter from "../r7-send-real";
import r7SendWithPdfRouter from "../r7-send-with-pdf";
import r7SendReceivableRouter from "../r7-send-receivable";
import oauthManagementRouter from "../oauthManagementRouter";
import pdfTestRouter from "../pdfTestRouter";
import introspectRouter from "../introspectRouter";
import introspectBoletoRouter from "../introspectBoletoRouter";
import testSalesAndBilletsRouter from "../testSalesAndBilletsRouter";
import provaIgnorDataRouter from "../provaIgnorDataRouter";
import tokenRawRouter from "../tokenRawRouter";
import contaAzulPanelTestRouter from "../contaAzulPanelTestRouter";
import r7SendVenda14464Router from "../r7-send-venda-14464-endpoint";
import provaVenda14464Router from "../prova-venda-14464-endpoint";
import authProofRouter from "../auth-proof-endpoint";
import contaAzulAutoLoginRouter from "../contaAzulAutoLoginRouter";
import contaAzulSyncWithTokenRouter from "../contaAzulSyncWithTokenRouter";
import contaAzulSyncMockRouter from "../contaAzulSyncMockRouter";
import etapa6E2ERouter from "../etapa6E2ERouter";
import etapa7SyncRealRouter from "../etapa7SyncRealRouter";
import etapa7DebugTokenRouter from "../etapa7DebugTokenRouter";
import contaAzulTokenProbeRouter from "../contaAzulTokenProbeRouter";
import contaAzulForceRefreshProbeRouter from "../contaAzulForceRefreshProbeRouter";
import contaAzulPostReauthProbeRouter from "../contaAzulPostReauthProbeRouter";
import etapa7ListReceivablesRouter from "../etapa7ListReceivablesRouter";
import etapa7DownloadPdfRouter from "../etapa7DownloadPdfRouter";
import etapa8ScanPaymentInfoRouter from "../etapa8ScanPaymentInfoRouter";
import etapa8DownloadFirstAvailableRouter from "../etapa8DownloadFirstAvailableRouter";
import etapa8E2ERealRouter from "../etapa8E2ERealRouter";
import zapAuthProofRouter from "../zap/zapAuthProofRouter";
import etapa9ResolvePaymentRouter from "../etapa9/etapa9ResolvePaymentRouter";
import etapa9DownloadPdfRouter from "../etapa9/etapa9DownloadPdfRouter";
import etapa9SendRealPdfRouter from "../etapa9/etapa9SendRealPdfRouter";
import etapa9PanelFetchRouter from "../etapa9/etapa9PanelFetchRouter";
import etapa9PanelDownloadPdfRouter from "../etapa9/etapa9PanelDownloadPdfRouter";
import etapa9PanelLoginSessionRouter from "../etapa9/etapa9PanelLoginSessionRouter";
import etapa9PanelLoginAndFetchRouter from "../etapa9/etapa9PanelLoginAndFetchRouter";
import shieldRouter from "../routers/shieldRouter";
import etapa9PanelSniffRouter from "../etapa9/etapa9PanelSniffRouter";
import etapa9PanelCaptureBoletoPdfRouter from "../etapa9/etapa9PanelCaptureBoletoPdfRouter";
import etapa9PanelLoginAndCaptureRouter from "../etapa9/etapa9PanelLoginAndCaptureRouter";
import etapa92BuscaContasAReceberRouter from "../etapa9/etapa92BuscaContasAReceberRouter";
import etapa92TokenDebugRouter from "../etapa9/etapa92TokenDebugRouter";
import etapa92ForceRefreshRouter from "../etapa9/etapa92ForceRefreshRouter";
import syncContaAzulReceivablesRouter from "../syncContaAzulReceivables";
import contaAzulTokenHealthRouter from "../contaAzulTokenHealthRouter";
import certificateUploadRouter from "../certificateUploadRouter";
import testSiegSyncRouter from "../routes/testSiegSync";
import testSiegReconRouter from "../routes/testSiegRecon";
import adminSiegEnableConsultationRouter from "../routes/adminSiegEnableConsultation";
import adminSiegAtivarConfigSaidaRouter from "../routes/adminSiegAtivarConfigSaida";

// REMOVED: findAvailablePort and isPortAvailable
// In production, always use process.env.PORT directly
// Do NOT try to find alternative ports - breaks Manus health check

async function startServer() {
  // 🚨 Feature flags para controlar jobs e schedulers
  const ENABLE_SYNC_JOB = process.env.ENABLE_SYNC_JOB !== "false"; // default true
  const ENABLE_R7_JOB = process.env.ENABLE_R7_JOB === "true"; // default false
  const ENABLE_MONITOR = process.env.ENABLE_MONITOR === "true"; // default false
  const ENABLE_SCHEDULERS = process.env.ENABLE_SCHEDULERS === "true"; // default false
  const ENABLE_DISPATCH = process.env.ENABLE_DISPATCH === "true"; // default false
  const ENABLE_COLLECTION_CRON = process.env.ENABLE_COLLECTION_CRON === "true"; // default false
  const ENABLE_SYNC_PAYMENTS_JOB = process.env.ENABLE_SYNC_PAYMENTS_JOB === "true"; // default false
  const ENABLE_PRECHARGE_SCHEDULER = process.env.ENABLE_PRECHARGE_SCHEDULER !== "false"; // default true
  const ENABLE_REACTIVATION_SCHEDULER = process.env.ENABLE_REACTIVATION_SCHEDULER === "true"; // default false
  
  console.log("[Flags] Configuracao de jobs:");
  console.log(`  ENABLE_SYNC_JOB: ${ENABLE_SYNC_JOB}`);
  console.log(`  ENABLE_R7_JOB: ${ENABLE_R7_JOB}`);
  console.log(`  ENABLE_MONITOR: ${ENABLE_MONITOR}`);
  console.log(`  ENABLE_SCHEDULERS: ${ENABLE_SCHEDULERS}`);
  console.log(`  ENABLE_DISPATCH: ${ENABLE_DISPATCH}`);
  console.log(`  ENABLE_SYNC_PAYMENTS_JOB: ${ENABLE_SYNC_PAYMENTS_JOB}`);
  console.log(`  ENABLE_PRECHARGE_SCHEDULER: ${ENABLE_PRECHARGE_SCHEDULER}`);
  console.log(`  ENABLE_REACTIVATION_SCHEDULER: ${ENABLE_REACTIVATION_SCHEDULER}`);
  
  // Log feature flags para modo seguro
  logFeatureFlags();
  
  const app = express();
  const server = createServer(app);
  
  // Trust proxy (Manus infrastructure uses reverse proxy)
  // Required for req.protocol to return 'https' and for correct IP detection
  app.set('trust proxy', 1);

  // 🔔 PING ENDPOINT FIRST - ANTES DE QUALQUER MIDDLEWARE
  app.get("/api/ping", (req, res) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString(), env: process.env.NODE_ENV || 'unknown' });
  });
  
  // Alias para /ping (Manus health check)
  app.get("/api/health", (req, res) => {
    res.status(200).json({ ok: true, message: "Backend is running" });
  });

  
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // ❤️ Auth REST endpoints
  app.use("/api/auth", authRestRouter);

  // ❤️ Health check endpoint (MUST be FIRST - no auth required)
  app.use("/api", healthCheckRouter);
  
  // ❤️ Health check alias (root level - à prova de proxy)
  app.get("/health", async (req, res) => {
    res.status(200).json({ ok: true, message: "Backend is running" });
  });
  
  // ❤️ Manus health check endpoint (CRITICO: Manus faz probe em /ping)
  app.get("/ping", (req, res) => {
    res.status(200).json({ ok: true, status: "pong" });
  });
  
  // ⚠️ Conta Azul OAuth callback — MUST be registered BEFORE Manus OAuth
  // The Conta Azul app has /api/oauth/callback registered as redirect_uri in their panel.
  // We intercept it here FIRST, detect if state is a Conta Azul state (64-char hex),
  // and process it. If not, we call next() to let Manus OAuth handle it.
  app.get('/api/oauth/callback', (req, res, next) => {
    const state = req.query.state as string | undefined;
    const code = req.query.code as string | undefined;
    
    // Detect Conta Azul state: 64-char hex string (sha256)
    const isContaAzulState = state && /^[0-9a-f]{64}$/i.test(state);
    
    console.log('[OAuth Router] /api/oauth/callback received');
    console.log('[OAuth Router] state:', state ? state.substring(0, 20) + '...' : 'MISSING');
    console.log('[OAuth Router] isContaAzulState:', isContaAzulState);
    console.log('[OAuth Router] code present:', !!code);
    
    if (isContaAzulState) {
      console.log('[OAuth Router] → Routing to Conta Azul handler');
      return handleContaAzulCallback(req, res);
    }
    
    // Not a Conta Azul state — let Manus OAuth handle it
    console.log('[OAuth Router] → Routing to Manus OAuth handler');
    return next();
  });

  // ✅ Manus OAuth callback — registered AFTER Conta Azul interceptor
  // Handles /api/oauth/callback with Manus base64-encoded state params
  registerOAuthRoutes(app);
  
  // Conta Azul OAuth callback handler (additional paths for compatibility)
  app.get('/api/callback', handleContaAzulCallback);
  app.get('/api/oauth/conta-azul/callback', handleContaAzulCallback);

  // Webhook endpoint for Zap Contabil — ALIAS
  // POST /api/webhook/zap-contabil → mesmo handler de /api/webhook/zap-contabil/messages
  // O ZapContábil envia para /api/webhook/zap-contabil (sem /messages)
  // Internamente redireciona para o zapContabilWebhookRouter /messages handler
  app.post("/api/webhook/zap-contabil", (req, res, next) => {
    console.log('[ZapWebhook] 🔀 ALIAS: POST /api/webhook/zap-contabil → rewriting to /messages');
    req.url = '/messages';
    zapContabilWebhookRouter(req, res, next);
  });
  
  // Conta Azul webhook endpoint
  app.use(contaAzulWebhookRouter);
  
  // ZapContabil webhook endpoint (modo seguro com feature flag)
  app.use('/api/webhook', webhookDebugRouter);
  app.use('/api/webhook/zap-contabil', zapContabilWebhookRouter);
  console.log('[BOOT] zapContabilWebhookRouter loaded');
  console.log('[BOOT] ✅ zapContabilWebhookRouter registered at /api/webhook/zap-contabil/*');
  
  // ZapContabil NFS-e webhook endpoint (automacao de emissao)
  // DISABLED: app.use('/api/zapcontabil', zapcontabilWebhookNfseRouter);
  app.use('/api/zapcontabil', zapcontabilWebhookTagRouter);
  app.use('/api/zapcontabil', zapcontabilWebhookMessageTagRouter);
  app.use('/api/zapcontabil', zapcontabilWebhookTagSimpleRouter);
  app.use('/api/zapcontabil', zapcontabilWebhookTransferRouter);
  // DISABLED: app.use('/api/zapcontabil', zapcontabilWebhookMessageNFRouter);
  app.use('/api/zapcontabil', zapcontabilWebhookMessageSetorRouter);
  app.use('/api/zapcontabil', zapcontabilWebhookAliasesRouter);
  console.log('[BOOT] ✅ zapcontabilWebhookAliasesRouter registered at /api/zapcontabil/*');

  console.log('[BOOT] ✅ zapcontabilWebhookMessageSetorRouter registered at /api/zapcontabil/*');
  console.log('[BOOT] ✅ zapcontabilWebhookMessageNFRouter registered at /api/zapcontabil/*');
  console.log('[BOOT] ✅ zapcontabilWebhookTransferRouter registered at /api/zapcontabil/*');
  console.log('[BOOT] ✅ zapcontabilWebhookTagSimpleRouter registered at /api/zapcontabil/*');
  console.log('[BOOT] ✅ zapcontabilWebhookMessageTagRouter registered at /api/zapcontabil/*');
  console.log('[BOOT] ✅ zapcontabilWebhookTagRouter registered at /api/zapcontabil/*');
  // DISABLED: console.log('[BOOT] ✅ zapcontabilWebhookNfseRouter registered at /api/zapcontabil/*');
  
  // ZapContabil WhatsApp message webhook endpoint (parser de dados de NFS-e)
  app.use('/api/zapcontabil', zapcontabilWebhookMessageRouter);
  console.log('[BOOT] ✅ zapcontabilWebhookMessageRouter registered at /api/zapcontabil/*');
  
  // NFS-e emission processor webhook endpoint (processa emissões prontas)
  app.use('/api/nfse', nfseEmissionWebhookRouter);
  console.log('[BOOT] ✅ nfseEmissionWebhookRouter registered at /api/nfse/*');
  
  // 🧪 Test NFS-e flow simulator (simula webhooks para testes)
  app.use('/api/test/nfse-flow-simulator', testNfseFlowSimulatorRouter);
  console.log('[BOOT] ✅ testNfseFlowSimulatorRouter registered at /api/test/nfse-flow-simulator/*');
  
  // ✅ Conta Azul OAuth routes (authorize, callback, token)
  app.use(contaAzulOAuthRouter);
  
  // 💬 Test router for dispatch (development only) - MUST be FIRST to avoid being intercepted
  if (process.env.NODE_ENV === "development") {
    app.use("/api/test", dispatchTestRouter);
  }
  
  // 🔧 Diagnostic router (development only)
  if (process.env.NODE_ENV === "development") {
    app.use("/api/test", diagnosticRouter);
  }
  
  // 🔧 Enrich receivable router (development only) - MUST be before dispatchTestRouter
  if (process.env.NODE_ENV === "development") {
    app.use("/api/test", enrichReceiverableRouter);
  }
  
  // 🔌 Test  // 📄 Audit report router (development only) - BEFORE dispatchTestRouter to avoid auth middleware
  if (process.env.NODE_ENV === "development") {
    app.use("/api/test", auditReportRouter);
  }
  
  // 👤 Admin WhatsApp validation router
  if (process.env.NODE_ENV === "development") {
    app.use("/api/admin", adminWhatsappRouter);
  }
  
  // 🔍 DEBUG - Expor process.env em tempo real (diagnóstico)
  app.get("/api/admin/debug/env", (req, res) => {
    res.json({
      REGUA_ENABLED_raw: process.env.REGUA_ENABLED,
      REGUA_ENABLED_interpreted: process.env.REGUA_ENABLED !== 'false',
      ALLOW_CRON_ENABLE_raw: process.env.ALLOW_CRON_ENABLE,
      ALLOW_CRON_ENABLE_interpreted: process.env.ALLOW_CRON_ENABLE === 'true',
      ENABLE_DISPATCH: process.env.ENABLE_DISPATCH,
      DISPATCH_PROD_ONLY: process.env.DISPATCH_PROD_ONLY,
      NODE_ENV: process.env.NODE_ENV,
      pid: process.pid,
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  // 🎯 Admin Régua de Cobrança - Disparo manual (SEMPRE disponível)
  app.post("/api/admin/regua/execute-now", async (req, res) => {
    try {
      console.log("[REGUA-MANUAL] Iniciando disparo manual da régua de cobrança...");
      const startTime = Date.now();
      await executeReguaJob(false); // false = não é dry-run
      const duration = Date.now() - startTime;
      console.log(`[REGUA-MANUAL] ✅ Disparo concluído em ${duration}ms`);
      res.status(200).json({
        ok: true,
        message: "Régua de cobrança disparada com sucesso",
        duration: `${duration}ms`
      });
    } catch (error: any) {
      console.error("[REGUA-MANUAL] ❌ Erro ao disparar régua:", error.message);
      res.status(500).json({
        ok: false,
        error: error.message || "Erro ao disparar régua"
      });
    }
  });
  
  // 🔧 [DEV ONLY] Endpoint temporário de diagnóstico - força execução da régua ignorando REGUA_ENABLED
  // ATENÇÃO: Este endpoint só existe em development e exige x-admin-key
  // Não altera cron, não altera produção, não altera lógica padrão da régua
  if (process.env.NODE_ENV === "development") {
    app.post("/api/admin/regua/execute-now-force", async (req, res) => {
      const requestId = `force-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const adminKey = req.headers["x-admin-key"];
      const expectedKey = process.env.FRAGA_ADMIN_KEY || process.env.DEV_SECRET || "fraga-dev-2026";

      // Validação de segurança: exige x-admin-key
      if (!adminKey || adminKey !== expectedKey) {
        console.warn(`[FORCED_MANUAL_EXECUTION] ❌ Acesso negado - requestId: ${requestId} - key inválida`);
        return res.status(403).json({ ok: false, error: "x-admin-key inválida ou ausente" });
      }

      const dryRun = req.query.dryRun === "true" || req.body?.dryRun === true;
      const startTime = Date.now();

      console.log("═".repeat(80));
      console.log(`[FORCED_MANUAL_EXECUTION] 🔧 DISPARO FORÇADO INICIADO`);
      console.log(`[FORCED_MANUAL_EXECUTION] requestId: ${requestId}`);
      console.log(`[FORCED_MANUAL_EXECUTION] NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`[FORCED_MANUAL_EXECUTION] REGUA_ENABLED (env): ${process.env.REGUA_ENABLED}`);
      console.log(`[FORCED_MANUAL_EXECUTION] dryRun: ${dryRun}`);
      console.log(`[FORCED_MANUAL_EXECUTION] horário: ${new Date().toISOString()}`);
      console.log(`[FORCED_MANUAL_EXECUTION] ⚠️  IGNORANDO REGUA_ENABLED - execução forçada por admin`);
      console.log("═".repeat(80));

      try {
        // Força REGUA_ENABLED=true apenas para esta execução, sem alterar o env global
        const originalValue = process.env.REGUA_ENABLED;
        process.env.REGUA_ENABLED = "true";

        await executeReguaJob(dryRun);

        // Restaura o valor original imediatamente após execução
        process.env.REGUA_ENABLED = originalValue ?? "false";

        const duration = Date.now() - startTime;
        console.log(`[FORCED_MANUAL_EXECUTION] ✅ Execução concluída em ${duration}ms`);
        console.log(`[FORCED_MANUAL_EXECUTION] REGUA_ENABLED restaurado para: ${process.env.REGUA_ENABLED}`);
        console.log("═".repeat(80));

        res.status(200).json({
          ok: true,
          requestId,
          message: "Régua executada com sucesso (forçado - apenas development)",
          dryRun,
          duration: `${duration}ms`,
          warning: "REGUA_ENABLED foi ignorado apenas nesta execução. Valor restaurado ao original.",
          reguaEnabledEnv: originalValue
        });
      } catch (error: any) {
        const duration = Date.now() - startTime;
        // Restaura o valor original mesmo em caso de erro
        process.env.REGUA_ENABLED = process.env.REGUA_ENABLED === "true" ? process.env.REGUA_ENABLED : "false";
        console.error(`[FORCED_MANUAL_EXECUTION] ❌ Erro após ${duration}ms: ${error.message}`);
        console.log("═".repeat(80));
        res.status(500).json({
          ok: false,
          requestId,
          error: error.message || "Erro ao executar régua",
          duration: `${duration}ms`
        });
      }
    });
    console.log("[BOOT] ✅ [DEV ONLY] /api/admin/regua/execute-now-force registrado");
  }

  // 📜 Admin Certificates router (always available)
  app.use("/api/certificados", adminCertificatesRouter);
  
  // 📋 NFS-e Emission Motor router
  app.use("/api/nfse", nfseRestRouter);
  app.use("/api/nfse", nfseRealEmissionRouter);
  app.use("/api/nfse", nfseDiagnosticRouter);
  app.use("/api/nfse", nfseCancelRouter);
  // app.use("/api/nfse", nfseAsyncEmissionRouter); // DISABLED: Requer Redis
  
  // 🔍 Scheduler integrity check router
  if (process.env.NODE_ENV === "development") {
    app.use('/api/test', testSchedulerIntegrityRouter);
    app.use('/api/test/data-quality', dataQualitySanitationRouter);
    app.use('/api/test/data-quality', dataQualitySyncRouter);
    app.use('/api/test/data-quality', dataQualityResolveRouter);
    app.use('/api/test/data-quality', dataQualityMatchAssistedRouter);
  app.use('/api/test/data-quality', dataQualityParseClientsCsvRouter);
  app.use('/api/test/data-quality', dataQualityDebugRouter);
  }
  app.use('/api/test/conta-azul', contaAzulPingRouter);
  app.use('/api/test/conta-azul', contaAzulSyncPublicRouter);
  app.use('/api/test/conta-azul', contaAzulAutoLoginRouter);
  app.use('/api/test/conta-azul', contaAzulSyncWithTokenRouter);
  app.use('/api/test/conta-azul', contaAzulSyncMockRouter);
  app.use('/api/test/etapa6', etapa6E2ERouter);
  app.use('/api/test/etapa7', etapa7SyncRealRouter);
  app.use('/api/test/etapa7', etapa7DebugTokenRouter);
  app.use('/api/test/conta-azul', contaAzulTokenProbeRouter);
  app.use('/api/test/conta-azul', contaAzulForceRefreshProbeRouter);
  app.use('/api/test/conta-azul', contaAzulPostReauthProbeRouter);
  app.use('/api/test/conta-azul', contaAzulTokenHealthRouter);
  app.use('/api/test/etapa7', etapa7ListReceivablesRouter);
  app.use('/api/test/etapa7', etapa7DownloadPdfRouter);
  app.use('/api/test/etapa8', etapa8ScanPaymentInfoRouter);
  app.use('/api/test/etapa8', etapa8DownloadFirstAvailableRouter);
  app.use('/api/test/etapa8', etapa8E2ERealRouter);
  app.use('/api/test/zap', zapAuthProofRouter);
  app.use('/api/test/etapa9/r7', etapa9ResolvePaymentRouter);
  app.use('/api/test/etapa9/r7', etapa9DownloadPdfRouter);
  app.use('/api/test/etapa9/r7', etapa9SendRealPdfRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelFetchRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelDownloadPdfRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelLoginSessionRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelLoginAndFetchRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelSniffRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelCaptureBoletoPdfRouter);
  app.use('/api/test/etapa9/r7', etapa9PanelLoginAndCaptureRouter);
  app.use('/api/test/etapa9/r7', etapa92BuscaContasAReceberRouter);
  app.use('/api/test/etapa9/r7', etapa92TokenDebugRouter);
  app.use('/api/test/etapa9/r7', etapa92ForceRefreshRouter);
  app.use('/api/test', syncContaAzulReceivablesRouter);
  app.use('/api/test/oauth', oauthRefreshProofRouter);
  app.use('/api/test/oauth', oauthDbDumpRouter);
  app.use('/api/test/api', apiDataValidationRouter);
  app.use('/api/test/panel', panelAuthProofRouter);
  app.use('/api/test/panel', panelSessionProofRouter);
  app.use('/api/test/panel', panelCookieTestRouter);
  app.use('/api/test/panel', panelD1ProofRouter);
  app.use('/api/test/panel', panelAuthProofV2Router);
  app.use('/api/test/r7', sendFromExistingPdfRouter);  app.use('/api/test/zap', zapAuthProofRouter);
  app.use('/api/test/zap', zapAuthHardcodedRouter);
  app.use('/api/test/zap', zapGetSignedUrlRouter);
  app.use('/api/test/zap', zapPdfFormatDiscoveryRouter);
  app.use('/api/etapa4', etapa4DiscoveryRouter);
  app.use('/api/etapa4', etapa4ProofRouter);
  app.use('/api/etapa4', etapa4FinalRouter);
  app.use('/api/test/r7', planoBE2ERouter);
  app.use('/api/test/r7', sendMultipartProofRouter);
  app.use('/api/test/zap', sendExistingFileMultipartRouter);
  app.use('/api/test/etapa5', etapa5TestRealRouter);
  app.use('/api/test', testPdfAttachmentRouter);
  app.use('/api/oauth/conta-azul', contaAzulAuthUrlRouter);
  app.use('/api/oauth/bypass', oauthBypassRouter);
  app.use('/api/test/conta-azul', contaAzulAuthUrlRouter); // Manter para compatibilidade
  app.use('/api/test/conta-azul', contaAzulDiagRouter);
  app.use('/api/test/conta-azul', resolvePersonIdManualRouter);
  app.use('/api/test/conta-azul', contaAzulApiTestRouter);
  app.use('/api/test/conta-azul', contaAzulEndpointDiscoveryRouter);
  app.use('/api/test/conta-azul', contaAzulDebugRouter);
  app.use('/api/test/conta-azul', contaAzulPessoasSampleRouter);
  app.use('/api/test/conta-azul', contaAzulCreatePersonTestRouter);
  app.use('/api/test/conta-azul', contaAzulSyncPeopleRouter);
  app.use('/api/test/conta-azul', contaAzulTestCreatePersonRouter);
  app.use('/api/test/conta-azul', contaAzulGenerateCsvRouter);
  app.use('/api/test/conta-azul', contaAzulParseContractsRouter);
  app.use('/api/test/conta-azul', contaAzulImportClientsRouter);
  app.use('/api/test/conta-azul', contaAzulTenantCheckRouter);
  app.use('/api/test/conta-azul', testEmpresaRouter);
  app.use('/api/test/conta-azul', peopleScanRouter);
  app.use('/api/test/contaazul', pdfTestRouter);
  app.use('/api/test/introspect', introspectRouter);
  app.use(introspectBoletoRouter);
  app.use('/api/test', testSalesAndBilletsRouter);
  app.use('/api/test', provaIgnorDataRouter);
  app.use('/api/test/oauth', tokenRawRouter);
  app.use('/api/discover', discoverUploadEndpointRouter);
  app.use('/api/meta', metaEndpointsRouter);
  app.use('/api/test/r7', r7AcceptanceRouter);
  app.use('/api/test/panel', contaAzulPanelTestRouter);
  app.use('/api/test/panel', provaVenda14464Router);
  app.use('/api/test/panel', authProofRouter);
  app.use('/api/test/conta-azul', personDetailRouter);
  app.use('/api/test/diagnostics', contaAzulDiagnosticsRouter);
  app.use('/api/test/e2e', contaAzulE2ETestRouter);
  app.use('/api/test/e2e', contaAzulStatusEndpoint);
  app.use('/api', contaAzulCallbackRouter);
  
  // ✅ Collection Shield — Validação pós-deploy (read-only)
  app.use('/api/shield', shieldRouter);
  console.log('[BOOT] ✅ Shield router registered at /api/shield/*');
  app.use('/api/test/debug', debugEnvRouter);
  
  // 📊 Dashboard metrics endpoint (real-time data from DB)
  console.log('[BOOT] dashboardMetricsRouter loaded');
  app.use('/api/dashboard', dashboardMetricsRouter);
  console.log('[BOOT] ✅ dashboardMetricsRouter registered at /api/dashboard');
  
  // 📊 Dashboard metrics audit endpoint (with proof of origin)
  console.log('[BOOT] dashboardMetricsAuditRouter loaded');
  app.use('/api/dashboard', dashboardMetricsAuditRouter);
  console.log('[BOOT] ✅ dashboardMetricsAuditRouter registered at /api/dashboard');
  
  // 🔍 Conta Azul probe endpoint (real-time API validation)
  console.log('[BOOT] contaAzulProbeRouter loaded');
  app.use('/api/contaazul', contaAzulProbeRouter);
  console.log('[BOOT] ✅ contaAzulProbeRouter registered at /api/contaazul');
  
  // 🚀 R7 Dispatch Test Endpoints (discovery, PDF, audit)
  console.log('[BOOT] r7DispatchTestEndpoints loaded');
  app.use('/api/test', r7DispatchTestEndpoints);
  console.log('[BOOT] ✅ r7DispatchTestEndpoints registered at /api/test/r7');
  
  // 🔴 R2/Worker Smoke Test
  console.log('[BOOT] r2SmokeTestRouter loaded');
  app.use('/api/test', r2SmokeTestRouter);
  console.log('[BOOT] ✅ r2SmokeTestRouter registered at /api/test/r2');
  
  // 🚀 R7 Send Real (Envio real com PDF)
  console.log('[BOOT] r7SendRealRouter loaded');
  app.use('/api/test', r7SendRealRouter);
  console.log('[BOOT] ✅ r7SendRealRouter registered at /api/test/r7/send-real');
  
  // 🚀 R7 Send with PDF (Workaround com discovery de upload)
  console.log('[BOOT] r7SendWithPdfRouter loaded');
  app.use('/api/test', r7SendWithPdfRouter);
  console.log('[BOOT] ✅ r7SendWithPdfRouter registered at /api/test/r7/send-real-with-pdf');
  
  // 🚀 R7 Send Venda 14464 (Envio real: Conta Azul → PDF → ZapContábil)
  console.log('[BOOT] r7SendVenda14464Router loaded');
  app.use('/api/test/r7', r7SendVenda14464Router);
  console.log('[BOOT] ✅ r7SendVenda14464Router registered at /api/test/r7/send-venda-14464');
  
  // 🚀 R7 Send Receivable (Pipeline completo: identity -> PDF -> ZapContábil)
  console.log('[BOOT] r7SendReceivableRouter loaded');
  app.use('/api/r7', r7SendReceivableRouter);
  app.use('/api/oauth', oauthManagementRouter);
  console.log('[BOOT] ✅ r7SendReceivableRouter registered at /api/r7/send-receivable');
  
  // 🔄 Test router for reactivation scheduler - MUST be BEFORE dispatchTestRouter
  app.use("/api/test/reactivation", reactivationBatchRouter);

  
  // 💬 Test router for precharge scheduler
  app.use("/api/test", testPrechargeRouter);
  
  // 🔐 SIEG Sync Test — Endpoint para execução manual do job de sincronização
  // DEVE ficar ANTES do testReactivationRouter (que usa router.use(devOnly) e intercepta tudo)
  app.use('/api', testSiegSyncRouter);
  console.log('[BOOT] ✅ testSiegSyncRouter registered at /api/test/sieg-sync');

  // 🔄 SIEG Reconciliation endpoint — DEVE ficar ANTES do testReactivationRouter
  app.use('/api/test', testSiegReconRouter);
  console.log('[BOOT] ✅ testSiegReconRouter registered at /api/test/sieg-recon');

  // 📋 Admin SIEG Enable Consultation endpoint
  app.use('/api/admin', adminSiegEnableConsultationRouter);
  console.log('[BOOT] ✅ adminSiegEnableConsultationRouter registered at /api/admin/sieg-enable-consultation-all');

  // 🔄 Admin Cert Sync Status endpoint
  const adminCertSyncStatusRouter = (await import('../routes/adminCertSyncStatus.js')).default;
  app.use('/api/admin/cert-sync-status', adminCertSyncStatusRouter);
  console.log('[BOOT] ✅ adminCertSyncStatusRouter registered at /api/admin/cert-sync-status');

  // 🔄 Admin SIEG Enable Full Fiscal endpoint
  const adminSiegEnableFullFiscalRouter = (await import('../routes/adminSiegEnableFullFiscal.js')).default;
  app.use('/api/admin', adminSiegEnableFullFiscalRouter);
  console.log('[BOOT] ✅ adminSiegEnableFullFiscalRouter registered at /api/admin/sieg-enable-full-fiscal');

  // 🔄 Admin SIEG Ativar Config Saída endpoint
  app.use('/api/admin', adminSiegAtivarConfigSaidaRouter);
  console.log('[BOOT] ✅ adminSiegAtivarConfigSaidaRouter registered at /api/admin/sieg-ativar-config-saida');

  // 🔄 Test router for reactivation scheduler
  app.use("/api/test", testReactivationRouter);
  
  // 💫 WhatsApp dispatch router
  // app.use("/api/dispatch", whatsappDispatchRouter); // DISABLED: Requer Redis
  
  // 🏓 PING — Endpoint simples para health check
  app.use('/api', pingRouter);
  console.log('[BOOT] ✅ pingRouter registered at /api/ping');

  // 📊 BLOCO 11 — Régua de cobrança via WhatsApp (endpoints controlados)
  console.log('[BOOT] collectionBatchRouter loaded');
  app.use('/api/collection', collectionBatchRouter);
  console.log('[BOOT] ✅ collectionBatchRouter registered at /api/collection');
  
  // 📊 BLOCO 11 (C) — Send Batch Router (safe ramp-up com dryRun + confirm)
  console.log('[BOOT] sendBatchRouter loaded');
  app.use('/api/collection', sendBatchRouter);
  console.log('[BOOT] ✅ sendBatchRouter registered at /api/collection/send-batch');
  
  // 📊 BLOCO 11 (D) — Cron Control Router (status, enable, disable)
  console.log('[BOOT] cronControlRouter loaded');
  app.use('/api/collection', cronControlRouter);
  console.log('[BOOT] ✅ cronControlRouter registered at /api/collection/cron/*');
  
  // 📊 SYNC NOW — Endpoint administrativo para popular paymentLinkCanonical
  console.log('[BOOT] syncNowRouter loaded');
  app.use('/api/collection', syncNowRouter);
  console.log('[BOOT] ✅ syncNowRouter registered at /api/collection/sync-now');

  // 🔄 FULL SYNC — Importa títulos novos do Conta Azul (upsert clientes + recebíveis)
  app.use('/api/sync', fullSyncRouter);
  console.log('[BOOT] ✅ fullSyncRouter registered at /api/sync/full');
  
  // 🔍 DEBUG ELIGIBILITY — Endpoint de debug para inspecionar elegibilidade
  console.log('[BOOT] debugEligibilityRouter loaded');
  app.use('/api/collection', debugEligibilityRouter);
  console.log('[BOOT] ✅ debugEligibilityRouter registered at /api/collection/debug-eligibility');
  
  // 🔍 ELIGIBLE CLIENTS — Endpoint debug para clientes consolidados
  console.log('[BOOT] eligibleClientsRouter loaded');
  app.use('/api/collection', eligibleClientsRouter);
  console.log('[BOOT] ✅ eligibleClientsRouter registered at /api/collection/eligible-clients/:bucketCode');
  
  // 🚀 ESCALATION — Régua automática de cobrança
  console.log('[BOOT] escalationRouter loaded');
  app.use('/api/collection', escalationRouter);
  console.log('[BOOT] ✅ escalationRouter registered at /api/collection/escalation/*');

  console.log('[BOOT] legalRouter loaded');
  app.use('/api/legal', legalRouter);
  console.log('[BOOT] ✅ legalRouter registered at /api/legal/*');
  
  console.log('[BOOT] inboundRouter loaded');
  app.use('/api/whatsapp', inboundRouter);
  console.log('[BOOT] ✅ inboundRouter registered at /api/whatsapp/*');
  
  // Follow-up automático (no-response)
  app.use('/api/collection/followup', followupRouter);
  console.log('[BOOT] ✅ followupRouter registered at /api/collection/followup/*');
  
  // ─── Certificados Upload (HTTPS POST sem SFTP) ───────────────────────────────
  app.use('/api/certificados', certificateUploadRouter);
  console.log('[BOOT] ✅ certificateUploadRouter registered at /api/certificados/*');



  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      transformer: superjson,
      createContext,
    })
  );
  
  // 🚨 Fail-fast middleware para /api/* não encontradas (antes de servir frontend)
  app.use(apiNotFoundMiddleware);
  
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }


  // Em produção (Manus), sempre usar porta 3000
  // CRITICO: Sempre usar process.env.PORT exatamente
  // O Manus faz TCP probe na porta definida em process.env.PORT
  // Se o app escolher outra porta, o probe falha
  const port = parseInt(process.env.PORT || "3000");
  console.log(`[Boot] Using port from environment: PORT=${port}`);
  console.log(`[Boot] CRITICAL: Manus will probe GET /ping on 0.0.0.0:${port}`);

  // Variável para armazenar o job de refresh de tokens
  let tokenRefreshJob: any;
  let syncPaymentsHandle: any;
  let prechargeSchedulerTask: any;
  let reactivationSchedulerTask: any;

  console.log("[Boot] starting server…");
  console.log(`[Boot] Listening on 0.0.0.0:${port}`);
  console.log(`[Boot] Health check endpoints: GET /ping, GET /health, GET /api/ping, GET /api/health`);
  console.log(`[Boot] Startup timestamp: ${new Date().toISOString()}`);

  server.listen(port, "0.0.0.0", () => {
    console.log(`[Boot] listening host=0.0.0.0 port=${port}`);
    console.log(`[BOOT] Server running on http://0.0.0.0:${port}/`);
    console.log(`[BOOT] Version: ${process.env.npm_package_version || '1.0.0'}`);
    console.log(`[BOOT] Commit: ${process.env.GIT_COMMIT || 'unknown'}`);
    console.log(`[BOOT] Build: ${process.env.BUILD_AT || 'unknown'}`);
    
    // Inicializar gerenciador de cache
    console.log('[BOOT] Initializing cache manager...');
    initializeCacheManager();
    console.log('[BOOT] ✅ Cache manager initialized');
    
    // Inicializar jobs em background (nao bloquear resposta na porta 3000)
    setImmediate(() => initializeBackgroundJobs());
    
    // Inicializar jobs agendados (condicionado por flags)
    if (ENABLE_SYNC_JOB) {
      console.log("[BOOT] Inicializando sync data job...");
      initializeSyncDataJob();
      console.log("[BOOT] ✅ Sync data job inicializado");
    } else {
      console.log("[BOOT] ⏸️ Sync data job desabilitado (ENABLE_SYNC_JOB=false)");
    }
    
    // Inicializar sync scheduler do Conta Azul (06:50 seg-sex, America/Sao_Paulo)
    console.log("[BOOT] Inicializando sync scheduler do Conta Azul...");
    startSyncScheduler();
    console.log("[BOOT] ✅ Sync scheduler iniciado (06:50 seg-sex, America/Sao_Paulo)");

    // Inicializar cron scheduler de cobrança automática (BLOCO 11 D)
    console.log("[BOOT] Inicializando cron scheduler de cobrança...");
    startCronScheduler();
    const cronAutoEnabled = process.env.ALLOW_CRON_ENABLE === 'true';
    console.log(`[BOOT] ✅ Cron scheduler inicializado (${cronAutoEnabled ? 'AUTO-HABILITADO via ALLOW_CRON_ENABLE=true' : 'desabilitado por padrão, use POST /api/collection/cron/enable'})`);
    
    // Restaurar estado do cron do banco (sobrevive a hibernações do sandbox)
    initCronStateFromDb().catch(err => console.error('[BOOT] Erro ao restaurar estado do cron:', err.message));
    
    // Catch-up: Se o servidor reiniciou após 07:30 e o cron não rodou hoje, executar agora
    console.log('[BOOT] Verificando se catch-up do cron é necessário...');
    runCatchUpIfNeeded().catch(err => console.error('[BOOT] Erro ao executar catch-up:', err.message));
    
    // CronWatchdog: Vigilante periódico que detecta hibernações e executa catch-up
    startCronWatchdog();
    console.log('[BOOT] ✅ CronWatchdog iniciado (07:00-09:00 BRT, a cada hora, seg-sex)');
    
    // Inicializar alerta automático (08:00 BRT, seg-sex)
    startAlertScheduler();
    console.log("[BOOT] ✅ Alert scheduler iniciado (08:00 BRT, seg-sex — alerta WhatsApp se cron não rodou)");
    // Inicializar pricing scheduler (06:40 seg-sex, America/Sao_Paulo)
    console.log("[BOOT] Inicializando pricing scheduler (eKontrol + Precificação)...");
    startPricingScheduler();
    console.log("[BOOT] ✅ Pricing scheduler iniciado (06:40 seg-sex, America/Sao_Paulo)");

    // Restaurar certificados do banco para o disco (sobrevive a deploys/restarts)
    console.log('[BOOT] Restaurando certificados do banco para o disco...');
    restoreCertificatesFromDb()
      .then(restored => {
        console.log(`[BOOT] ✅ ${restored} certificados restaurados do banco para o disco`);
        // Iniciar watcher de certificados digitais (detecta novos PFX automaticamente)
        startCertificateWatcher();
        console.log('[BOOT] ✅ Certificate watcher iniciado (monitorando: ' + (process.env.CERTIFICATES_PATH || '/data/certificados') + ')');
      })
      .catch(err => {
        console.error('[BOOT] ⚠️ Erro ao restaurar certificados:', err.message);
        // Iniciar watcher mesmo se a restauração falhar
        startCertificateWatcher();
        console.log('[BOOT] ✅ Certificate watcher iniciado (monitorando: ' + (process.env.CERTIFICATES_PATH || '/data/certificados') + ')');
      });
    console.log('[BOOT] ✅ Server initialization complete');
    
    if (ENABLE_R7_JOB) {
      console.log("[Jobs] Inicializando R7 collection job...");
      initializeR7CollectionJob();
      console.log("[Jobs] ✅ R7 collection job inicializado");
    } else {
      console.log("[Jobs] ⏸️ R7 collection job desabilitado (ENABLE_R7_JOB=false)");
    }
    
    // Sempre inicializar collection day five job
    console.log('[BOOT] Initializing collection day five job...');
    initializeCollectionDayFiveJob();
    console.log('[BOOT] ✅ Collection day five job initialized');
    
    // Inicializar cron de cobrança automática (07:30 diariamente)
    if (ENABLE_COLLECTION_CRON) {
      console.log("[BOOT] Inicializando automated collection cron...");
      initializeCollectionCron();
      console.log("[BOOT] ✅ Automated collection cron inicializado (07:30 diariamente)");
    } else {
      console.log("[BOOT] ⏸️ Automated collection cron desabilitado (ENABLE_COLLECTION_CRON=false)");
    }
    
    // Inicializar monitor de boletos (condicionado)
    if (ENABLE_MONITOR) {
      console.log("[Monitor] Inicializando monitor de boletos da R7...");
      iniciarMonitorBoletos();
      console.log("[Monitor] ✅ Monitor de boletos iniciado");
    } else {
      console.log("[Monitor] ⏸️ Monitor de boletos desabilitado (ENABLE_MONITOR=false)");
    }
    
    // Inicializar scheduler de cobrança automática (condicionado)
    if (ENABLE_SCHEDULERS && ENABLE_DISPATCH) {
      console.log("[Scheduler] Inicializando scheduler de cobrança...");
      initCollectionScheduler();
      console.log("[Scheduler] ✅ Scheduler de cobrança iniciado");
    } else {
      console.log("[Scheduler] ⏸️ Scheduler de cobrança desabilitado (ENABLE_SCHEDULERS=false ou ENABLE_DISPATCH=false)");
    }
    
    // Inicializar job cron de refresh de tokens OAuth (novo cron resiliente)
    console.log("[OAuthCron] Inicializando job de refresh de tokens (resiliente)...");
    startNewTokenRefreshCron();
    tokenRefreshJob = true; // marca como iniciado para o graceful shutdown
    console.log("[OAuthCron] ✅ Job de refresh de tokens iniciado (a cada 5min, sem dependência de env)");
    
    // ⚠️ REMOVIDO: Sincronização de certificados agora é feita apenas pelo PowerShell do Windows
    // O Rclone não funciona em produção (porta 22 bloqueada)
    // console.log("[CertSync] Inicializando job de sincronização de certificados...");
    // initCertSyncScheduler();
    // console.log("[CertSync] ✅ Job de sincronização iniciado (a cada 10 minutos)");
    // Inicializar worker de WhatsApp dispatch
    // console.log("[Worker] Inicializando worker de WhatsApp dispatch...");
    // startWhatsappDispatchWorker(); // DISABLED: Requer Redis
    // console.log("[Worker] ✅ Worker de WhatsApp dispatch iniciado");
    
    // Inicializar job de sincronizacao de pagamentos (condicionado)
    if (ENABLE_SYNC_PAYMENTS_JOB) {
      console.log("[SyncPayments] Inicializando job de sincronizacao de pagamentos...");
      syncPaymentsHandle = startSyncPaymentsJob();
      console.log("[SyncPayments] ✅ Job de sincronizacao de pagamentos iniciado");
    } else {
      console.log("[SyncPayments] ⏸️ Job de sincronizacao de pagamentos desabilitado (ENABLE_SYNC_PAYMENTS_JOB=false)");
    }
    
    // ⚠️ DESABILITADO NO STARTUP: Scheduler de pré-cobrança
    // Será iniciado manualmente via endpoint /api/admin/start-jobs
    console.log("[PrechargeScheduler] ⏸️ Scheduler de pré-cobrança DESABILITADO no startup (será iniciado via endpoint)");
    
    // Inicializar scheduler de reativação (condicionado)
    if (ENABLE_REACTIVATION_SCHEDULER) {
      console.log("[ReactivationScheduler] Inicializando scheduler de reativação diária...");
      initReactivationScheduler();
      console.log("[ReactivationScheduler] ✅ Scheduler de reativação iniciado (08:05 diariamente)");
    } else {
      console.log("[ReactivationScheduler] ⏸️ Scheduler de reativação desabilitado (ENABLE_REACTIVATION_SCHEDULER=false)");
    }

    // Inicializar Régua de Cobrança (condicionado por ALLOW_CRON_ENABLE + REGUA_ENABLED)
    console.log("[ReguaJob] Inicializando régua de cobrança...");
    initReguaJob();
    console.log("[ReguaJob] ✅ Régua de cobrança inicializada (09:00 e 14:00, seg-sex)");

    // ⚠️ DESABILITADO NO STARTUP: Job Scheduler
    // Será iniciado manualmente via endpoint /api/admin/start-jobs
    console.log('[JobScheduler] ⏸️ Job scheduler DESABILITADO no startup (será iniciado via endpoint)');
  });
  
  // Funcao para inicializar jobs em background
  async function initializeBackgroundJobs() {
    try {
      console.log('[BackgroundJobs] Iniciando jobs em background...');
      
      // Dar um pequeno delay para garantir que o servidor ja esta respondendo
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.log('[BackgroundJobs] ✅ Jobs em background iniciados com sucesso');
    } catch (error) {
      console.error('[BackgroundJobs] Erro ao inicializar jobs em background:', error);
    }
  }
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nEncerrando servidor...');
    shutdownCacheManager();
    stopSyncDataJob();
    stopCollectionDayFiveJob();
    stopReactivationScheduler();
    stopR7CollectionJob();
    pararMonitorBoletos();
    stopCollectionScheduler();
    if (tokenRefreshJob) stopNewTokenRefreshCron();
    stopSyncPaymentsJob(syncPaymentsHandle);
    if (prechargeSchedulerTask) stopPrechargeScheduler(prechargeSchedulerTask);
    stopReguaJob();
    // stopWhatsappDispatchWorker(); // DISABLED: Requer Redis
    server.close(() => {
      console.log('Servidor encerrado');
      process.exit(0);
    });
  });
}

console.log("[Boot] started");
console.log("[Boot] routes: ping registered");

startServer().catch((error) => {
  console.error("[Boot] FATAL ERROR:", error.message);
  console.error("[Boot] Stack:", error.stack);
  process.exit(1);
});
