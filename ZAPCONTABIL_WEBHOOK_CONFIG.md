# 🔧 Guia de Configuração de Webhooks no ZapContábil

**Data:** 15 de Março de 2026  
**Ambiente:** Produção  
**Status:** Pronto para configuração

---

## 📋 RESUMO EXECUTIVO

Você vai configurar **2 novos webhooks** para NFS-e no painel do ZapContábil, mantendo o webhook de boleto intacto.

| Webhook | Tipo | URL | Função |
|---------|------|-----|--------|
| **Boleto** (existente) | `messages.create` | `/api/webhook/zap-contabil/messages` | ✅ Não mexer |
| **NFS-e Transfer** (novo) | `tickets.update` | `/api/zapcontabil/setor-nota-fiscal` | Captura transferência para setor |
| **NFS-e Message** (novo) | `messages.create` | `/api/zapcontabil/webhook-message` | Recebe respostas do cliente |

---

## 🎯 WEBHOOK 1: NFS-e Transfer (Novo)

### Quando Usar
Quando um ticket é **transferido para o setor "nota fiscal"** no ZapContábil.

### Configuração no Painel do ZapContábil

**Nome do Webhook:**
```
NFS-e Transfer - Setor Nota Fiscal
```

**Tipo de Evento:**
```
tickets.update
```
*(Ou procure por "Transferência de Setor" / "Ticket Updated" / "Ticket Moved")*

**URL Completa:**
```
https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal
```

**Método HTTP:**
```
POST
```

**Headers Necessários:**
```
Content-Type: application/json
```

**Autenticação:**
```
Nenhuma autenticação necessária
(O webhook é público, mas o ZapContábil envia dados válidos)
```

**Payload Esperado (o que você vai receber):**
```json
{
  "ticketId": 12345,
  "phoneE164": "+5527981657804",
  "clientName": "Cliente Teste",
  "clientDocument": "07838084000186",
  "sector": "nota fiscal",
  "previousSector": "atendimento",
  "subject": "Emissão de NFS-e",
  "description": "Serviços contábeis"
}
```

**Teste Rápido:**
```bash
curl -X POST https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": 12345,
    "phoneE164": "+5527981657804",
    "clientName": "Teste",
    "clientDocument": "07838084000186",
    "sector": "nota fiscal"
  }'
```

**Resposta Esperada:**
```json
{
  "success": true,
  "ticketId": 12345,
  "message": "Ticket criado com sucesso",
  "flowState": "waiting_document"
}
```

---

## 💬 WEBHOOK 2: NFS-e Message (Novo)

### Quando Usar
Quando o **cliente responde uma mensagem no WhatsApp** durante o fluxo de NFS-e.

### Configuração no Painel do ZapContábil

**Nome do Webhook:**
```
NFS-e Message - Respostas do Cliente
```

**Tipo de Evento:**
```
messages.create
```
*(Procure por "Nova Mensagem" / "Message Created" / "Inbound Message")*

**URL Completa:**
```
https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/webhook-message
```

**Método HTTP:**
```
POST
```

**Headers Necessários:**
```
Content-Type: application/json
```

**Autenticação:**
```
Nenhuma autenticação necessária
```

**Payload Esperado (o que você vai receber):**
```json
{
  "ticketId": 12345,
  "phoneE164": "+5527981657804",
  "clientMessage": "12345678901"
}
```

**Teste Rápido:**
```bash
curl -X POST https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/webhook-message \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": 12345,
    "phoneE164": "+5527981657804",
    "clientMessage": "12345678901"
  }'
```

**Resposta Esperada:**
```json
{
  "success": true,
  "ticketId": 12345,
  "nextState": "waiting_name",
  "nextQuestion": "Qual é o seu nome completo?"
}
```

---

## 🚫 WEBHOOK 3: Boleto (Existente - NÃO MEXER)

### Configuração Atual
```
Nome: [Verificar no painel]
Tipo: messages.create
URL: /api/webhook/zap-contabil/messages
Método: POST
```

**⚠️ IMPORTANTE:** Não altere este webhook. Ele continua funcionando normalmente.

---

## 📍 PASSO A PASSO: Configurar no Painel do ZapContábil

### Passo 1: Acessar Painel do ZapContábil
1. Acesse: `https://zapcontabil.com` (ou seu URL customizado)
2. Faça login com suas credenciais
3. Procure por: **Configurações** → **Webhooks** ou **Integrações** → **Webhooks**

### Passo 2: Adicionar Webhook 1 (NFS-e Transfer)
1. Clique em **+ Novo Webhook** ou **Add Webhook**
2. Preencha:
   - **Nome:** `NFS-e Transfer - Setor Nota Fiscal`
   - **Tipo de Evento:** `tickets.update`
   - **URL:** `https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal`
   - **Método:** `POST`
3. Clique em **Salvar** ou **Criar**
4. Se houver opção de teste, clique em **Testar** (veja seção de teste abaixo)

### Passo 3: Adicionar Webhook 2 (NFS-e Message)
1. Clique em **+ Novo Webhook** ou **Add Webhook**
2. Preencha:
   - **Nome:** `NFS-e Message - Respostas do Cliente`
   - **Tipo de Evento:** `messages.create`
   - **URL:** `https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/webhook-message`
   - **Método:** `POST`
3. Clique em **Salvar** ou **Criar**
4. Se houver opção de teste, clique em **Testar**

### Passo 4: Verificar Webhook de Boleto
1. Procure pelo webhook de boleto existente
2. Confirme que:
   - ✅ Está **ativo/habilitado**
   - ✅ URL está correta
   - ✅ Tipo de evento está correto
3. **NÃO altere nada**

### Passo 5: Salvar Configurações
1. Clique em **Salvar Configurações** ou **Aplicar Mudanças** (se houver)
2. Aguarde confirmação

---

## 🧪 TESTE DE FUNCIONAMENTO

### Teste 1: Verificar se Webhooks Estão Ativos
```bash
# No seu terminal, execute:
curl -v https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"ticketId": 999, "phoneE164": "+5527981657804", "sector": "nota fiscal"}'
```

**Resultado esperado:**
- Status: `200 OK`
- Resposta contém `"success": true` ou `"ticketId"`

---

### Teste 2: Simular Transferência para Setor "Nota Fiscal"

**No painel do ZapContábil:**
1. Abra um ticket existente
2. Transfira-o para o setor **"nota fiscal"**
3. Verifique nos logs do servidor se o webhook foi recebido:

```bash
# No servidor, monitore os logs:
tail -f /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | grep -i "ZapContabilWebhook\|setor-nota-fiscal"
```

**Resultado esperado:**
```
[2026-03-15T...] [ZapContabilWebhook] Evento recebido para ticket: 12345, setor: nota fiscal
[2026-03-15T...] [ZapContabilWebhook] Cliente identificado: phone_match (95%) - Fraga Contabilidade
[2026-03-15T...] [SendWhatsApp] Mensagem enviada para +5527981657804
```

---

### Teste 3: Simular Resposta do Cliente no WhatsApp

**No WhatsApp:**
1. Cliente recebe pergunta: **"Qual é o seu CPF ou CNPJ?"**
2. Cliente responde: `12345678901`
3. Verifique nos logs se a resposta foi processada:

```bash
tail -f /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | grep -i "WebhookMessage\|flow_state"
```

**Resultado esperado:**
```
[2026-03-15T...] [WebhookMessage] Recebido: ticketId=12345, phone=+5527981657804, msg="12345678901"
[2026-03-15T...] [WebhookMessage] Estado atual: waiting_document
[2026-03-15T...] [WebhookMessage] Ticket atualizado: estado=waiting_name
[2026-03-15T...] [SendWhatsApp] Mensagem enviada para +5527981657804
```

---

## 🔍 TROUBLESHOOTING

### Problema: Webhook não está sendo chamado

**Solução 1: Verificar se URL está correta**
```bash
# Testar conectividade
curl -I https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal
```
Deve retornar `405 Method Not Allowed` (porque GET não é permitido, apenas POST)

**Solução 2: Verificar se webhook está ativo no ZapContábil**
- Volte ao painel do ZapContábil
- Procure pelo webhook
- Confirme que está com status **"Ativo"** ou **"Enabled"**

**Solução 3: Verificar logs do servidor**
```bash
# Ver últimos 100 linhas de log
tail -100 /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log

# Procurar por erros
grep -i "error\|failed" /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | tail -20
```

---

### Problema: Webhook está sendo chamado mas retorna erro

**Solução 1: Verificar payload**
- O ZapContábil está enviando os campos corretos?
- Verifique no log qual é o payload recebido

**Solução 2: Verificar banco de dados**
```bash
# Verificar se tabelas existem
mysql -u root -p$DB_PASSWORD -e "SHOW TABLES LIKE 'zapcontabil%';"

# Verificar estrutura da tabela
mysql -u root -p$DB_PASSWORD -e "DESCRIBE zapcontabil_tickets;"
```

**Solução 3: Reiniciar servidor**
```bash
# No Management UI, clique em "Restart Server"
# Ou via shell:
cd /home/ubuntu/fraga-dashboard && pnpm run dev
```

---

## 📊 MONITORAMENTO APÓS CONFIGURAÇÃO

### Verificar Status dos Webhooks

```bash
# Ver quantos eventos foram recebidos
grep -c "ZapContabilWebhook\|WebhookMessage" /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log

# Ver últimos eventos
grep "ZapContabilWebhook\|WebhookMessage" /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | tail -20

# Ver erros
grep -i "error\|failed" /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log | grep -i "webhook\|zapcontabil"
```

### Verificar Dados no Banco

```bash
# Conectar ao banco
mysql -u root -p$DB_PASSWORD fraga_dashboard

# Ver tickets recebidos
SELECT id, ticket_id, phone_e164, flow_state, created_at FROM zapcontabil_tickets ORDER BY created_at DESC LIMIT 10;

# Ver emissões de NFS-e
SELECT id, ticket_id, status, created_at FROM nfse_emissions ORDER BY created_at DESC LIMIT 10;
```

---

## ✅ CHECKLIST DE CONFIGURAÇÃO

- [ ] Acessei o painel do ZapContábil
- [ ] Encontrei a seção de Webhooks
- [ ] Criei Webhook 1 (NFS-e Transfer)
  - [ ] Nome: `NFS-e Transfer - Setor Nota Fiscal`
  - [ ] Tipo: `tickets.update`
  - [ ] URL: `https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal`
  - [ ] Método: `POST`
  - [ ] Status: Ativo
- [ ] Criei Webhook 2 (NFS-e Message)
  - [ ] Nome: `NFS-e Message - Respostas do Cliente`
  - [ ] Tipo: `messages.create`
  - [ ] URL: `https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/webhook-message`
  - [ ] Método: `POST`
  - [ ] Status: Ativo
- [ ] Verifiquei que webhook de boleto continua ativo
- [ ] Testei Webhook 1 (transferência para setor)
- [ ] Testei Webhook 2 (resposta do cliente)
- [ ] Verifiquei logs do servidor
- [ ] Confirmei que boletos continuam funcionando
- [ ] Documentei URLs dos webhooks em local seguro

---

## 📞 SUPORTE

Se encontrar problemas:

1. **Verifique os logs:**
   ```bash
   tail -f /home/ubuntu/fraga-dashboard/.manus-logs/devserver.log
   ```

2. **Teste o endpoint manualmente:**
   ```bash
   curl -X POST https://fragadash-vfmxmw8q.manus.space/api/zapcontabil/setor-nota-fiscal \
     -H "Content-Type: application/json" \
     -d '{"ticketId": 999, "phoneE164": "+5527981657804", "sector": "nota fiscal"}'
   ```

3. **Verifique o banco de dados:**
   ```bash
   mysql -u root -p$DB_PASSWORD -e "SELECT * FROM zapcontabil_tickets LIMIT 5;"
   ```

4. **Reinicie o servidor:**
   - Management UI → Restart Server
   - Ou: `pnpm run dev`

---

## 🎓 REFERÊNCIA RÁPIDA

| Campo | Webhook 1 (Transfer) | Webhook 2 (Message) |
|-------|----------------------|---------------------|
| Nome | NFS-e Transfer | NFS-e Message |
| Tipo | tickets.update | messages.create |
| URL | `/api/zapcontabil/setor-nota-fiscal` | `/api/zapcontabil/webhook-message` |
| Método | POST | POST |
| Auth | Nenhuma | Nenhuma |
| Quando | Ticket transferido | Cliente responde |

---

**Última atualização:** 15 de Março de 2026  
**Versão:** 1.0  
**Status:** Pronto para produção
