# Análise de Webhooks do ZapContábil

## 1. SITUAÇÃO ATUAL

### Webhooks Configurados Hoje

O ZapContábil está configurado com **UM ÚNICO webhook** para boletos:

```
POST /api/webhook/zap-contabil/messages
```

**Localização no código:**
- Arquivo: `/server/webhooks/zapContabilWebhookRouter.ts`
- Rota: `POST /api/webhook/zap-contabil/*` (captura todos os eventos)
- Registrado em: `/server/_core/index.ts` linha 317

**Funcionalidade atual:**
- Recebe eventos de mensagens inbound do WhatsApp
- Processa cobrança automática com IA (aiDebtAssistant)
- Move tickets para fila "Financeiro" quando detecta intenção financeira
- Implementa rate limiting e deduplicação

---

## 2. NOVOS WEBHOOKS PARA NFS-e

Foram criados **DOIS novos routers** mas ainda **NÃO configurados no ZapContábil**:

### Router 1: Captura de Transferência para Setor "Nota Fiscal"
```
POST /api/zapcontabil/setor-nota-fiscal
```

**Arquivo:** `/server/routes/zapcontabilWebhookNfse.ts`
**Funcionalidade:**
- Recebe evento quando ticket é transferido para setor "nota fiscal"
- Identifica cliente automaticamente pelo telefone
- Cria registro em `zapcontabil_tickets` com estado inicial
- Envia primeira pergunta no WhatsApp (CPF/CNPJ)

**Registrado em:** `/server/_core/index.ts` linha 322

---

### Router 2: Recebe Respostas do Cliente no WhatsApp
```
POST /api/zapcontabil/webhook-message
```

**Arquivo:** `/server/routes/zapcontabilWebhookMessage.ts`
**Funcionalidade:**
- Recebe mensagens do cliente durante fluxo de NFS-e
- Implementa state machine para coleta guiada de dados
- Valida CPF/CNPJ, nome, descrição, valor
- Transiciona entre estados: `waiting_document` → `waiting_name` → `waiting_description` → `waiting_value` → `waiting_confirmation` → `ready_to_emit`
- Dispara emissão de NFS-e quando dados estão completos

**Registrado em:** `/server/_core/index.ts` linha 326

---

## 3. CAPACIDADES DO ZAPCONTÁBIL

### Múltiplos Webhooks por Tipo de Evento?

**Resposta: SIM, o ZapContábil aceita múltiplos webhooks por tipo de evento**

Baseado na estrutura do código, o ZapContábil pode enviar eventos para diferentes endpoints:
- Um webhook para `messages.create` (mensagens)
- Um webhook para `tickets.update` (transferência de setor)
- Um webhook para `tickets.create` (novo ticket)

Cada tipo de evento pode ter um endpoint diferente configurado.

---

## 4. RISCO DE SOBRESCRITA

### Pergunta: O webhook atual de boleto seria sobrescrito?

**Resposta: NÃO, não há risco de sobrescrita**

**Motivos:**

1. **Endpoints diferentes:**
   - Boleto: `/api/webhook/zap-contabil/messages` (webhook LEGADO)
   - NFS-e: `/api/zapcontabil/setor-nota-fiscal` (novo webhook)
   - NFS-e: `/api/zapcontabil/webhook-message` (novo webhook)

2. **Tipos de evento diferentes:**
   - Boleto: `messages.create` (mensagens inbound)
   - NFS-e: `tickets.update` (transferência de setor)
   - NFS-e: `messages.create` (mas com contexto diferente)

3. **Routers independentes:**
   - Cada router é registrado separadamente
   - Não compartilham estado ou lógica

---

## 5. ARQUITETURA RECOMENDADA

### Opção A: Manter Separado (ATUAL - Recomendado)

**Vantagens:**
- ✅ Cada fluxo é independente
- ✅ Sem risco de quebra de boletos
- ✅ Fácil de debugar
- ✅ Fácil de desativar um sem afetar o outro

**Desvantagens:**
- ❌ Múltiplos webhooks para configurar no ZapContábil

**Configuração necessária no ZapContábil:**

```
Webhook 1 (Boletos - já existe):
  Tipo: messages.create
  URL: https://fragadash-vfmxmw8q.manus.space/api/webhook/zap-contabil/messages
  
Webhook 2 (NFS-e - novo):
  Tipo: tickets.update
  URL: https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal
  
Webhook 3 (NFS-e - novo):
  Tipo: messages.create (com contexto de NFS-e)
  URL: https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/webhook-message
```

---

### Opção B: Unificar em Endpoint Central (ALTERNATIVA)

Se você preferir ter um único endpoint que roteia por tipo de evento:

**Arquivo a criar:** `/server/routes/zapcontabilUnifiedWebhook.ts`

```typescript
// Pseudocódigo
router.post('/webhook', async (req, res) => {
  const eventType = detectEventType(req.body);
  
  if (eventType === 'BOLETO_MESSAGE') {
    return handleBoletoMessage(req, res);
  } else if (eventType === 'NFSE_TRANSFER') {
    return handleNfseTransfer(req, res);
  } else if (eventType === 'NFSE_MESSAGE') {
    return handleNfseMessage(req, res);
  }
});
```

**Vantagens:**
- ✅ Um único webhook para configurar
- ✅ Lógica centralizada de roteamento

**Desvantagens:**
- ❌ Mais complexo de debugar
- ❌ Risco de lógica cruzada
- ❌ Difícil de desativar um fluxo sem afetar o outro

---

## 6. RECOMENDAÇÃO FINAL

**Usar Opção A (Manter Separado)** pelos seguintes motivos:

1. **Segurança:** Boletos continuam funcionando sem qualquer mudança
2. **Clareza:** Cada webhook tem responsabilidade única e clara
3. **Manutenibilidade:** Fácil de entender o fluxo de cada tipo
4. **Escalabilidade:** Fácil adicionar novos tipos de evento no futuro
5. **Debugging:** Logs separados para cada fluxo

---

## 7. PRÓXIMOS PASSOS

### Passo 1: Verificar Webhooks Atuais no ZapContábil
Acessar painel do ZapContábil e listar webhooks configurados:
- Qual é a URL atual de boleto?
- Qual é o tipo de evento?
- Há outros webhooks?

### Passo 2: Configurar Novos Webhooks
No painel do ZapContábil, adicionar:
```
Webhook 2:
  Nome: NFS-e Transfer
  Tipo: tickets.update
  URL: https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal
  
Webhook 3:
  Nome: NFS-e Message
  Tipo: messages.create
  URL: https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/webhook-message
```

### Passo 3: Testar Fluxo Completo
1. Transferir ticket real para setor "nota fiscal"
2. Verificar se primeira pergunta chega no WhatsApp
3. Responder com CPF/CNPJ
4. Verificar se fluxo guiado continua
5. Confirmar que boletos ainda funcionam normalmente

### Passo 4: Monitorar Logs
```bash
# Ver logs de boleto
tail -f /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | grep -i "ZapWebhook\|boleto"

# Ver logs de NFS-e
tail -f /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | grep -i "ZapContabilWebhook\|WebhookMessage"
```

---

## 8. ESTRUTURA DE DADOS

### Tabela: `zapcontabil_tickets`
```sql
CREATE TABLE zapcontabil_tickets (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT,
  phone_e164 VARCHAR(20),
  client_name VARCHAR(255),
  client_document VARCHAR(20),
  client_document_type ENUM('cpf', 'cnpj'),
  flow_state VARCHAR(50) DEFAULT 'waiting_document',
  service_description TEXT,
  service_value DECIMAL(10, 2),
  status VARCHAR(20) DEFAULT 'open',
  webhook_payload JSON,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Tabela: `nfse_emissions`
```sql
CREATE TABLE nfse_emissions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  ticket_id INT,
  client_name VARCHAR(255),
  client_document VARCHAR(20),
  service_description TEXT,
  service_value DECIMAL(10, 2),
  status VARCHAR(20),
  nfse_number VARCHAR(20),
  nfse_pdf_url TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

---

## 9. FLUXO VISUAL

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZapContábil (Externo)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
                ▼            ▼            ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ messages.    │ │ tickets.     │ │ messages.    │
        │ create       │ │ update       │ │ create       │
        │ (Boleto)     │ │ (NFS-e)      │ │ (NFS-e)      │
        └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
               │                │                │
               ▼                ▼                ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ /api/webhook │ │ /api/        │ │ /api/        │
        │ /zap-contabil│ │ zapcontabil/ │ │ zapcontabil/ │
        │ /messages    │ │ setor-nota-  │ │ webhook-     │
        │              │ │ fiscal       │ │ message      │
        └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
               │                │                │
               ▼                ▼                ▼
        ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
        │ Boleto       │ │ Criar Ticket │ │ State Machine│
        │ Handler      │ │ NFS-e        │ │ Coleta Dados │
        │ (IA Cobrança)│ │ + Pergunta 1 │ │ + Emissão    │
        └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 10. CHECKLIST DE IMPLEMENTAÇÃO

- [ ] Confirmar URLs dos webhooks atuais no ZapContábil
- [ ] Adicionar Webhook 2 (setor-nota-fiscal) no ZapContábil
- [ ] Adicionar Webhook 3 (webhook-message) no ZapContábil
- [ ] Testar transferência para setor "nota fiscal"
- [ ] Testar fluxo guiado de coleta de dados
- [ ] Testar que boletos continuam funcionando
- [ ] Monitorar logs por 24h
- [ ] Documentar configuração final no ZapContábil
- [ ] Criar runbook de troubleshooting

