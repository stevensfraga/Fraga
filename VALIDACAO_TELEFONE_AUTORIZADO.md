# 🔐 Validação de Telefone Autorizado - Documentação

## 📌 Resumo

Foi implementada uma validação de telefone autorizado no arquivo `server/routes/zapcontabilWebhookMessageSetor.ts`. O sistema agora:

1. **Verifica o telefone** do remetente antes de processar qualquer requisição
2. **Consulta a tabela** `nfse_usuarios_autorizados` no banco de dados
3. **Bloqueia usuários não autorizados** com uma mensagem de erro via WhatsApp
4. **Permite prosseguimento** apenas para usuários autorizados

## 🎯 Alterações Implementadas

### 1. Função de Validação (Linha 49-70)
```typescript
async function isPhoneAuthorized(
  connection: mysql.Connection,
  phoneE164: string
): Promise<boolean>
```

**O que faz:**
- Consulta a tabela `nfse_usuarios_autorizados`
- Procura pelo telefone em formato E.164 (ex: +5511999999999)
- Verifica se a coluna `ativo` é 1 (autorizado)
- Retorna `true` se encontrado, `false` caso contrário

### 2. Validação em Transferência de Tickets (Linha 279-295)

**Quando ocorre:** Quando um ticket é transferido para o setor "Nota Fiscal"

**Fluxo:**
```
Cliente envia mensagem
    ↓
Sistema detecta transferência para setor Nota Fiscal
    ↓
Extrai telefone do cliente
    ↓
Valida contra nfse_usuarios_autorizados
    ↓
┌─ SE AUTORIZADO ─────────────────┐
│ ✅ Continua fluxo normal        │
│ - Gera saudação via Claude     │
│ - Cria registro no banco        │
└─────────────────────────────────┘

┌─ SE NÃO AUTORIZADO ────────────────┐
│ ❌ Bloqueia fluxo                  │
│ - Envia msg de erro via WhatsApp  │
│ - Registra no log do servidor      │
│ - Retorna erro na API              │
└────────────────────────────────────┘
```

### 3. Validação em Processamento de Mensagens (Linha 426-442)

**Quando ocorre:** Quando uma mensagem é recebida para processamento

**Fluxo:** Idêntico ao item 2, mas no contexto de mensagens já em conversação.

## 🔧 Configuração

### 1. Criar Tabela no Banco de Dados

```sql
CREATE TABLE IF NOT EXISTS nfse_usuarios_autorizados (
  id INT PRIMARY KEY AUTO_INCREMENT,
  telefone VARCHAR(20) NOT NULL UNIQUE,
  ativo TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_telefone_ativo ON nfse_usuarios_autorizados(telefone, ativo);
```

### 2. Inserir Telefones Autorizados

```sql
INSERT INTO nfse_usuarios_autorizados (telefone, ativo) VALUES
('+5511999999999', 1),   -- São Paulo - Autorizado
('+5521987654321', 1),   -- Rio de Janeiro - Autorizado
('+5585912345678', 1);   -- Ceará - Autorizado
```

### 3. Gerenciar Usuários

**Ativar usuário:**
```sql
UPDATE nfse_usuarios_autorizados SET ativo = 1 WHERE telefone = '+5511999999999';
```

**Desativar usuário:**
```sql
UPDATE nfse_usuarios_autorizados SET ativo = 0 WHERE telefone = '+5511999999999';
```

**Verificar se um telefone está autorizado:**
```sql
SELECT * FROM nfse_usuarios_autorizados 
WHERE telefone = '+5511999999999' AND ativo = 1;
```

## 📞 Comportamento do Sistema

### Usuário Autorizado
- ✅ Fluxo continua normalmente
- ✅ Pode interagir com o bot
- ✅ Mensagens são processadas
- ✅ NFS-e pode ser emitida

### Usuário Não Autorizado
- ❌ Recebe mensagem de erro via WhatsApp
- ❌ Fluxo é interrompido imediatamente
- ❌ Nenhuma operação é realizada
- ❌ Log registra a tentativa de acesso

## 📊 Logs

### Logs de Sucesso
```
[SETOR-NF] 💬 Mensagem | ticketId: xxx | setor: Nota Fiscal | body: "..."
[SETOR-NF] 🎫 Evento de ticket | ticketId: xxx | setor: Nota Fiscal
```

### Logs de Erro - Telefone Não Autorizado
```
[SETOR-NF] 🚫 Telefone não autorizado: +5588987654321
[SETOR-NF] ❌ Erro ao validar telefone: {mensagem de erro específica}
```

## 🧪 Testes

### Teste 1: Telefone Autorizado
1. Inserir seu telefone na tabela
2. Enviar mensagem WhatsApp
3. Verificar se fluxo continua normal

### Teste 2: Telefone Não Autorizado
1. Enviar mensagem de um telefone não cadastrado
2. Verificar se recebe mensagem de erro
3. Verificar logs: `pm2 logs fraga-dashboard`

### Teste 3: Verificar Logs
```bash
pm2 logs fraga-dashboard --lines 50 --nostream | grep "Telefone"
```

## 🔄 Reversão (se necessário)

Se precisar reverter as mudanças:

```bash
# 1. Restaurar arquivo original
cp server/routes/zapcontabilWebhookMessageSetor.ts.backup \
   server/routes/zapcontabilWebhookMessageSetor.ts

# 2. Fazer novo build
npm run build

# 3. Reiniciar aplicação
pm2 restart fraga-dashboard
```

## 📝 Notas Importantes

1. **Formato de Telefone**: Use sempre E.164 (+5511999999999)
   - Inclua o código do país (+55)
   - Inclua DDD (11 para São Paulo, 21 para RJ, etc)
   - Inclua o número com 8 ou 9 dígitos

2. **Campo ativo**:
   - 1 = Autorizado
   - 0 = Bloqueado (funciona como "deletado lógico")

3. **Performance**:
   - Índice criado em (telefone, ativo) para buscas rápidas
   - Uma conexão por validação (otimizado)

4. **Segurança**:
   - Telefone é parametrizado (previne SQL injection)
   - Erros são tratados graciosamente
   - Sem exposição de informações sensíveis

## 🚀 Status Atual

- ✅ Build: Sucesso (✓ built in 9.80s)
- ✅ Deploy: Online (PID 234242)
- ✅ Aplicação: Rodando normalmente
- ✅ Pronto para: Produção

## 📞 Suporte

Para adicionar/remover/atualizar telefones autorizados, utilize os comandos SQL acima ou entre em contato com DevOps.

---

**Data de Implementação:** 2024  
**Versão:** 1.0.0  
**Status:** ✅ Ativo em Produção
