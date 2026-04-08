export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  ekontrolApiKey: process.env.EKONTROL_API_KEY ?? "",
  ekontrolApiKeyEmpresa: process.env.EKONTROL_API_KEY_EMPRESA ?? "",
  // Régua de cobrança
  reguaEnabled: process.env.REGUA_ENABLED !== 'false', // default: true; defina REGUA_ENABLED=false para desabilitar régua antiga
  allowCronEnable: process.env.ALLOW_CRON_ENABLE === 'true',
  contadorPhone: process.env.CONTADOR_PHONE ?? "",
  // Integrações externas
  siegApiKey: process.env.SIEG_API_KEY ?? "",
  certPasswordDefault: process.env.CERT_PASSWORD_DEFAULT ?? "Abcd@1234",
  certPasswordList: process.env.CERT_PASSWORD_LIST ?? "",
  fragaAdminKey: process.env.FRAGA_ADMIN_KEY ?? "",
  // NFS-e Nacional (ADN) — captura centralizada de notas de serviço
  useNfseNacional: process.env.USE_NFSE_NACIONAL === 'true', // default: false; defina USE_NFSE_NACIONAL=true para habilitar
  // Acessórias
  acessoriasApiToken: process.env.ACESSORIAS_API_TOKEN ?? "",
};
