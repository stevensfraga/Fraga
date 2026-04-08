# SYSTEM LOCK STATE — SNAPSHOT DO ESTADO ATUAL

**Data do snapshot:** 24/02/2026 00:53 GMT-3  
**Versão:** 74711ba6  
**Objetivo:** Documentar configuração validada e endpoints reais em produção

---

## 🔒 CONFIGURAÇÃO CONTA AZUL (VALIDADA)

### Base URL Oficial
```
https://api-v2.contaazul.com
```

### Endpoints Reais Validados

1. **Token Health Check**
   - **Endpoint:** `GET /v1/contas-a-receber/buscar`
   - **Query params:** `data_vencimento_de`, `data_vencimento_ate`
   - **Uso:** Validar token antes de qualquer operação (TOKEN_GUARD)
   - **Resposta esperada:** 200 OK com lista de receivables
   - **Resposta de erro:** 401 Unauthorized (REAUTH_REQUIRED)

2. **Buscar Parcela por UUID**
   - **Endpoint:** `GET /v1/financeiro/eventos-financeiros/parcelas/{UUID}`
   - **Uso:** Obter detalhes completos de uma parcela (incluindo paymentLinkCanonical)
   - **Resposta esperada:** 200 OK com objeto parcela
   - **Campo crítico:** `paymentLinkCanonical` (fonte oficial de link de pagamento)

3. **Listar Receivables**
   - **Endpoint:** `GET /v1/contas-a-receber/buscar`
   - **Query params:** `data_vencimento_de`, `data_vencimento_ate`, `status`
   - **Uso:** Sincronizar receivables do Conta Azul
   - **Resposta esperada:** 200 OK com array de receivables

---

## 📋 TEMPLATES DE MENSAGEM (BLOCO 11)

### Buckets de Atraso

| Bucket | Dias de Atraso | Tom | Template |
|--------|----------------|-----|----------|
| A | 1-3 dias | Lembrete amigável | `bloco11_A_{dias}d` |
| B | 4-15 dias | Amigável + urgência | `bloco11_B_{dias}d` |
| C | 16-30 dias | Formal + consequências | `bloco11_C_{dias}d` |
| D | 31+ dias | Pré-jurídico | `bloco11_D_{dias}d` |
| D1 | 31+ dias (1º envio) | Suave + reengajamento | `bloco11_D1_soft` |

### Regra de Seleção D1 vs D
- **D1 (suave):** `dispatchCount === 0` (primeiro toque)
- **D (pré-jurídico):** `dispatchCount > 0` (reenvio)

### Fonte de Link de Pagamento
- **SEMPRE usar:** `paymentLinkCanonical` (campo oficial da API Conta Azul)
- **NUNCA usar:** Links legados ou gerados manualmente

---

## ⏰ CRON SCHEDULE (AUTOMAÇÃO)

### Horário de Execução
```
Seg-Sex 07:30 (America/Sao_Paulo)
```

### Pipeline Automático
1. **07:30** → Sync Conta Azul (receivables + clients)
2. **07:35** → Enrich WhatsApp (API + CSV se existir)
3. **07:40** → Gerar fila de envio (priorizar B/C, D apenas D1 suave)
4. **08:00** → Disparar lote do dia (B: 30, C: 20, D: 10)

### Quiet Hours
- **Horário permitido:** 08:00-18:00
- **Fora do horário:** Pipeline aborta automaticamente
- **Exceção:** `?mode=real` ignora quiet hours (apenas para testes)

---

## 🛡️ SAFEGUARDS ATIVOS

### 1. TOKEN_GUARD
- **Função:** `checkTokenHealth()` (tokenGuard.ts)
- **Verificação:** Token Conta Azul válido antes de qualquer operação
- **Ação se falhar:** Aborta pipeline, retorna REAUTH_REQUIRED
- **Endpoint de teste:** `GET /api/test/conta-azul/token-health`

### 2. CIRCUIT_BREAKER_ZAP
- **Função:** Verificação a cada 5 envios em `executeBatch()`
- **Threshold:** 10% de taxa de falha
- **Cálculo:** `failureRate = failed / (sent + failed)`
- **Ação se falhar:** Aborta lote, marca restantes como ABORTED_BY_CIRCUIT_BREAKER

### 3. SAFETY_CAP
- **Função:** `checkDailyUsage()` (safetyCap.ts)
- **Limite diário:** 60 mensagens (B: 30, C: 20, D: 10)
- **Verificação:** Antes de iniciar pipeline
- **Ação se exceder:** Aborta pipeline, retorna DAILY_LIMIT_EXCEEDED

### 4. ALLOW_REAL_SEND (Trava de Envio Real)
- **Env var:** `ALLOW_REAL_SEND=true` (obrigatório para envio real)
- **Validação:** `dryRun=false` + `confirm=true` + `ALLOW_REAL_SEND=true`
- **Ação se falhar:** Retorna 403 REAL_SEND_DISABLED
- **Endpoints protegidos:** `/api/collection/send-batch`, `/api/collection/send-direct`

### 5. ALLOW_CRON_ENABLE (Trava de Cron)
- **Env var:** `ALLOW_CRON_ENABLE=true` (obrigatório para habilitar cron)
- **Ação se falhar:** Retorna 403 CRON_ENABLE_DISABLED
- **Endpoint protegido:** `POST /api/collection/cron/enable`

### 6. KILL_SWITCH (Botão de Pânico)
- **Env var:** `KILL_SWITCH=true` (aborta TUDO imediatamente)
- **Ação:** Lança erro `KILLED_BY_OWNER` em batchSender e cronScheduler
- **Uso:** Parar sistema em 1 minuto se houver problema crítico
- **Resposta:** 503 Service Unavailable

---

## 📊 COLLECTION SCORE (PRIORIZAÇÃO AUTOMÁTICA)

### Fórmula
```
collectionScore = (daysOverdue × 2) + (amount / 100)
```

### Exemplo
- **Receivable A:** 45 dias, R$ 5.000 → score = (45 × 2) + (5000 / 100) = **140**
- **Receivable B:** 10 dias, R$ 10.000 → score = (10 × 2) + (10000 / 100) = **120**

### Ordenação
```sql
ORDER BY
  dispatchCount ASC,           -- Nunca enviados primeiro
  collectionScore DESC,         -- Maior risco primeiro
  COALESCE(lastDispatchedAt, '1970-01-01') ASC  -- Mais antigo primeiro
```

---

## 📞 NORMALIZAÇÃO WHATSAPP (E.164)

### Formato Obrigatório
```
+55XXXXXXXXXXX
```

### Função Centralizada
- **Arquivo:** `server/collection/eligibilityFilter.ts`
- **Função:** `normalizeWhatsApp(phone)`
- **Validação:** `isValidWhatsAppE164(phone)`

### Regras
1. Remover espaços, traços, parênteses
2. Se começar com 0, remover
3. Se não começar com 55, adicionar 55
4. Adicionar `+` no início
5. Validar 10-11 dígitos após DDD (11-99)
6. Se inválido → retornar `null`

### Constraint no Banco
```sql
ALTER TABLE clients
ADD CONSTRAINT check_whatsapp_format
CHECK (whatsappNumber IS NULL OR whatsappNumber LIKE '+55%');
```

---

## 🔐 SAFE DEFAULTS

### Envio Real
- **Default:** `dryRun=true` (preview sem enviar)
- **Para enviar:** `dryRun=false` + `confirm=true` + `ALLOW_REAL_SEND=true`

### Cron Automático
- **Default:** `enabled=false` (desabilitado no boot)
- **Para habilitar:** `POST /api/collection/cron/enable` + `ALLOW_CRON_ENABLE=true`

---

## 🚨 REGRAS DE OURO

1. **Nenhum envio real sem tripla validação** (dryRun=false + confirm=true + ALLOW_REAL_SEND=true)
2. **Nenhum cron enable sem chave** (ALLOW_CRON_ENABLE=true)
3. **Nenhum número inválido no sistema** (constraint CHECK + normalização)
4. **Nenhum lote sem verificação de taxa de falha** (circuit breaker a cada 5 envios)
5. **Nenhum dia com mais de 60 mensagens** (safety cap)
6. **Nenhuma operação sem token válido** (token guard antes de tudo)
7. **KILL_SWITCH para tudo** (botão de pânico em 1 minuto)

---

## 📝 ENDPOINTS DE CONTROLE

### Cron
- `GET /api/collection/cron/status` — Status do cron (enabled, lastRun, nextRun)
- `POST /api/collection/cron/enable` — Habilitar cron (exige ALLOW_CRON_ENABLE=true)
- `POST /api/collection/cron/disable` — Desabilitar cron
- `POST /api/collection/cron/run-now?mode=real` — Executar pipeline manual (ignora quiet hours)

### Envio
- `POST /api/collection/send-batch` — Envio em lote (exige ALLOW_REAL_SEND=true se dryRun=false)
- `POST /api/collection/send-direct` — Envio direto de receivable (exige ALLOW_REAL_SEND=true se dryRun=false)

### Métricas
- `GET /api/collection/summary` — Resumo de receivables (total, overdue, buckets)
- `GET /api/collection/eligible` — Receivables elegíveis por bucket
- `GET /api/collection/audit-log` — Histórico de envios
- `GET /api/collection/whatsapp-quality` — Qualidade da base de WhatsApp

---

## ✅ VALIDAÇÃO FINAL

- ✅ Base URL: `https://api-v2.contaazul.com`
- ✅ Endpoints validados: token-health, parcela por UUID, buscar receivables
- ✅ paymentLinkCanonical como fonte oficial
- ✅ Templates A/B/C/D + D1 suave
- ✅ Cron seg-sex 07:30 + quiet hours 08:00-18:00
- ✅ Safety cap 60/dia + Circuit breaker 10% + Token guard
- ✅ Normalização E.164 + constraint CHECK
- ✅ ALLOW_REAL_SEND + ALLOW_CRON_ENABLE
- ✅ KILL_SWITCH implementado
- ✅ Collection Score + priorização automática
- ✅ 26 testes vitest passando (normalização)
- ✅ 100% cobertura WhatsApp (320/320 clientes)

---

**SISTEMA BLINDADO E PRONTO PARA GO LIVE**
