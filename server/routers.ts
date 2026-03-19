import { authRouter } from "./auth-router";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { collectionRouter, sentimentRouter } from "./collectionRouter";
import { collectionAgentRouter } from "./collectionAgentRouter";
import { performanceMetricsRouter } from "./performanceMetricsRouter";
import { phoneNumberRouter } from "./phoneNumberRouter";
// import { followUpRouter } from "./followUpRouter";
import { webhookRouter } from "./webhookRouter";
import { contaAzulRouter } from "./contaAzulRouter";
import { contaAzulOAuthRouter } from "./contaAzulOAuthRouter";
import { webhookPaymentRouter } from "./webhookPaymentRouter";
import { emailRouter } from "./emailRouter";
import { acessoriasRouter } from "./acessoriasRouter";
import { acessoriasDetailRouter } from "./acessoriasDetailRouter";
import { r7GeradorasRouter } from "./r7GeradorasRouter";
import { realBoletoRouter } from "./realBoletoRouter";
import { whatsappRouter } from "./whatsappRouter";
import { auditRouter } from "./auditRouter";
import { finalDispatchRouter } from "./finalDispatchRouter";
import { systemAuditRouter } from "./systemAuditRouter";
import { firstBoletoRouter } from "./firstBoletoRouter";
import { contaAzulSyncRouter } from "./contaAzulSyncRouter";
import { realDispatchRouter } from "./realDispatchRouter";
import { collectionMetricsRouter } from "./collectionMetricsRouter";
import { reguaRouter } from "./routers/reguaRouter";
import { dashboard2Router } from "./routers/dashboard2Router";
import { clienteDossieRouter } from "./routers/clienteDossieRouter";
import { clientsManagerRouter } from "./routers/clientsManagerRouter";
import { contactsRouter } from "./routers/contactsRouter";
import { reguaPipelineRouter } from "./routers/reguaPipelineRouter";
import { paymentsRouter } from "./routers/paymentsRouter";
import { syncScheduleRouter } from "./routers/syncScheduleRouter";
import { pricingRouter } from "./routers/pricingRouter";
import { nfseRouter } from "./routers/nfseRouter";
import { usersAdminRouter } from "./routers/usersAdminRouter";
import { certificatesRouter } from "./routers/certificatesRouter";
import { integrationStatusRouter } from "./routers/integrationStatusRouter";
// import { effectivenessRouter } from "./effectivenessRouter";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: authRouter,
  collection: collectionRouter,
  agent: collectionAgentRouter,
  metrics: performanceMetricsRouter,
  phoneNumber: phoneNumberRouter,
  // followUp: followUpRouter,
  sentiment: sentimentRouter,
  webhook: webhookRouter,
  webhookPayment: webhookPaymentRouter,
  email: emailRouter,
  contaAzul: contaAzulRouter,
  contaAzulOAuth: contaAzulOAuthRouter,
  acessorias: acessoriasRouter,
  acessoriasDetail: acessoriasDetailRouter,
  r7Geradores: r7GeradorasRouter,
  realBoleto: realBoletoRouter,
  whatsapp: whatsappRouter,
  audit: auditRouter,
  finalDispatch: finalDispatchRouter,
  systemAudit: systemAuditRouter,
  firstBoleto: firstBoletoRouter,
  contaAzulSync: contaAzulSyncRouter,
  realDispatch: realDispatchRouter,
  collectionMetrics: collectionMetricsRouter,
  regua: reguaRouter,
  dashboard2: dashboard2Router,
  clienteDossie: clienteDossieRouter,
  clientsManager: clientsManagerRouter,
  contacts: contactsRouter,
  reguaPipeline: reguaPipelineRouter,
  payments: paymentsRouter,
  syncSchedule: syncScheduleRouter,
  pricing: pricingRouter,
  nfse: nfseRouter,
  usersAdmin: usersAdminRouter,
  certificates: certificatesRouter,
  integrationStatus: integrationStatusRouter,
  // effectiveness: effectivenessRouter,
});

export type AppRouter = typeof appRouter;


