# ⚡ Comandos Úteis - Agente DeepSeek

## 🚀 Iniciar Agente

```bash
node scripts/agente-deep.mjs
```

## 📚 Ver Documentação

```bash
# Começar rápido
cat scripts/QUICK-START.md

# Contexto completo
cat scripts/CONTEXTO-DEEPSEEK.md

# Como usar agentes
cat scripts/README-AGENTES.md

# O que mudou
cat scripts/CHANGES.md

# Navegação
cat scripts/INDEX.md

# Resumo completo
cat scripts/RESUMO-FINAL.txt
```

## 🔍 Verificar Arquivos

```bash
# Ver todos os arquivos de documentação
ls -lh scripts/*.md scripts/*.txt scripts/*.mjs | grep -E "CONTEXTO|agente-deep|README|CHANGES|QUICK|INDEX|RESUMO"

# Contar linhas do contexto
wc -l scripts/CONTEXTO-DEEPSEEK.md

# Ver tamanho total
du -sh scripts/
```

## 🧪 Testar Agente

```bash
# Teste rápido (30 segundos)
echo "sair" | node scripts/agente-deep.mjs

# Teste com pergunta
(echo "Como faço build do projeto?"; sleep 2; echo "sair") | timeout 5 node scripts/agente-deep.mjs

# Ver se contexto é carregado
timeout 1 node scripts/agente-deep.mjs 2>&1 | grep "Contexto carregado"
```

## 📝 Atualizar Contexto

```bash
# Editar arquivo de contexto
nano scripts/CONTEXTO-DEEPSEEK.md

# Agente carregará nova versão automaticamente na próxima execução
node scripts/agente-deep.mjs
```

## 🔧 Troubleshooting

```bash
# Verificar permissões
ls -la scripts/agente-deep.mjs
chmod +x scripts/agente-deep.mjs  # Se necessário

# Verificar API Key
grep DEEPSEEK_API_KEY .env.production

# Verificar contexto
[ -f scripts/CONTEXTO-DEEPSEEK.md ] && echo "✅ Contexto existe" || echo "❌ Contexto não encontrado"

# Ver última entrada de erro
pm2 logs fraga-dashboard --lines 50 --nostream
```

## 🎓 Exemplos de Perguntas

```
"Como faço build do projeto?"
"Qual é o status da aplicação?"
"Como faço restart?"
"Qual é o stack tecnológico?"
"Como configuro o banco de dados?"
"Quais são as variáveis de ambiente necessárias?"
"Qual é a arquitetura do projeto?"
"Como faço debug?"
"O que é Drizzle ORM?"
"Como integro uma nova rota tRPC?"
```

## 📊 Integração em Scripts

```bash
#!/bin/bash
# Usar agente em script automático

node /opt/fraga-dashboard/scripts/agente-deep.mjs << EOF
Como está o status do projeto?
sair
