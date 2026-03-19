# ⚡ Quick Start - Agente DeepSeek

## 🚀 Começar em 30 segundos

### 1️⃣ Executar o agente
```bash
node scripts/agente-deep.mjs
```

### 2️⃣ Você verá
```
🚀 Agente DeepSeek - Fraga Dashboard
📚 Contexto carregado de: scripts/CONTEXTO-DEEPSEEK.md (401 linhas)
💬 Digite 'sair' para encerrar

👤 Você: 
```

### 3️⃣ Fazer perguntas
```
👤 Você: Como faço build do projeto?
👤 Você: Qual é o status?
👤 Você: Como restart?
👤 Você: sair
```

---

## 💡 Exemplos de Uso

### Build e Deploy
```
👤 Você: Como faço build e restart da aplicação?
🤖 O agente responderá com:
   - Contexto do projeto
   - Comandos a executar
   - Output dos comandos
```

### Debug
```
👤 Você: Qual foi o último erro?
🤖 O agente checará:
   - Logs da aplicação (PM2)
   - Status do servidor
   - Erros recentes
```

### Status
```
👤 Você: Tudo ok?
🤖 O agente verificará:
   - Processo PM2
   - Banco de dados
   - Saúde geral do projeto
```

---

## 🔐 Requisito: API Key

Verificar que tem em `.env.production`:
```bash
DEEPSEEK_API_KEY=sk-xxx...
```

Se não tiver, contactar admin.

---

## 📚 Documentação Completa

- **Arquitetura:** `scripts/CONTEXTO-DEEPSEEK.md`
- **Como usar:** `scripts/README-AGENTES.md`
- **Mudanças:** `scripts/CHANGES.md`

---

## 🐛 Erro: Contexto não carrega?

```bash
# Verificar arquivo
ls -l scripts/CONTEXTO-DEEPSEEK.md

# Deve existir e ter ~11K de tamanho
```

---

## ⌨️ Comandos Rápidos

| Comando | O que faz |
|---------|----------|
| `npm run build` | Build do projeto |
| `pm2 restart fraga-dashboard` | Reinicia app |
| `pm2 logs fraga-dashboard --lines 50` | Mostra últimos 50 logs |
| `npm run dev` | Modo desenvolvimento |

---

**Pronto! Comece a usar: `node scripts/agente-deep.mjs`**
