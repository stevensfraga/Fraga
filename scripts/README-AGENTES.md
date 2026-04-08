# 🤖 Agentes DevOps do Fraga Dashboard

## 📋 Visão Geral

Existem dois agentes disponíveis para automação e assistência no projeto:

1. **agente-deep.mjs** - Agente DeepSeek (Principal)
2. **agente-servidor.mjs** - Agente Servidor (Monitoramento)

---

## 🚀 Agente DeepSeek (agente-deep.mjs)

### O que é?

Agente IA interativo baseado em **DeepSeek API** que fornece assistência DevOps para o projeto Fraga Dashboard.

### ✨ Recursos

- ✅ Carrega automaticamente contexto de `scripts/CONTEXTO-DEEPSEEK.md`
- ✅ Executa comandos bash automaticamente
- ✅ Oferece sugestões de debugging
- ✅ Interface interativa CLI
- ✅ Mantém histórico de conversa
- ✅ Identifica e executa blocos `bash` em respostas

### 📁 Contexto Automático

No inicialização, o agente carrega:
- **Arquivo:** `scripts/CONTEXTO-DEEPSEEK.md` (400+ linhas)
- **Conteúdo:** Arquitetura, stack, comandos, conventions
- **Fallback:** Se arquivo não existir, usa conhecimento base

### 🔧 Como Usar

#### Instalação de Dependências
```bash
npm install openai
```

#### Executar
```bash
node scripts/agente-deep.mjs
```

#### Interação
```
🚀 Agente DeepSeek - Fraga Dashboard
📚 Contexto carregado de: scripts/CONTEXTO-DEEPSEEK.md (400 linhas)
💬 Digite 'sair' para encerrar

👤 Você: Como faço build do projeto?
```

O agente responderá com informações contextualizadas e executará comandos automaticamente.

### 💡 Exemplos de Uso

**1. Build e Deploy**
```
👤 Você: Como faço build e restart?
🤖 Resposta: [Contexto do projeto] + npm run build + pm2 restart
📤 Output: [Resultado dos comandos]
```

**2. Debug de Logs**
```
👤 Você: Qual foi o último erro da aplicação?
🤖 Resposta: [Análise de logs] + pm2 logs fraga-dashboard
📤 Output: [Últimas 50 linhas de log]
```

**3. Verificar Status**
```
👤 Você: Status do projeto?
🤖 Resposta: [Verificação de saúde] + comandos de diagnóstico
📤 Output: [Status da aplicação]
```

### 🔐 Requisitos

- **Variável de Ambiente:** `DEEPSEEK_API_KEY` em `.env.production`
- **Arquivo de Contexto:** `scripts/CONTEXTO-DEEPSEEK.md`
- **Permissões:** Acesso de leitura em arquivos de projeto

### ⚙️ Configuração do System Prompt

O agente usa um system prompt que inclui:

```
Você é um agente DevOps expert do projeto Fraga Dashboard...

## 📚 CONTEXTO DO PROJETO
[Conteúdo completo de CONTEXTO-DEEPSEEK.md]

## 🛠️ INSTRUÇÕES OPERACIONAIS
- Use bash para todos os comandos
- Build: npm run build
- Restart: pm2 restart fraga-dashboard
- Logs: pm2 logs fraga-dashboard --lines 50 --nostream
- Execute sem pedir confirmação
```

---

## 🖥️ Agente Servidor (agente-servidor.mjs)

### O que é?

Agente de monitoramento que verifica saúde e status da aplicação.

### Uso
```bash
node scripts/agente-servidor.mjs
```

---

## 📊 Integração Contínua

### Via Bash Script
```bash
#!/bin/bash
# scripts/run-agent.sh

node /opt/fraga-dashboard/scripts/agente-deep.mjs << EOF
Como está o status do projeto?
sair
