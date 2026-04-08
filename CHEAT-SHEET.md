# ⚡ CHEAT SHEET - COMANDOS RÁPIDOS

## 🎯 O QUE VOCÊ FALA → O QUE EU FAÇO

### COMANDO: "Status"
```bash
pm2 status && npm list -a
```
**Resultado:** Vejo tudo que está rodando

---

### COMANDO: "Fix [descrição do bug]"
```bash
# Analiso o erro
# Faço o fix
# Testo localmente
# Build & restart
npm run build && pm2 restart fraga-* --update-env
```
**Resultado:** Bug corrigido em prod

---

### COMANDO: "Feature [descrição]"
```bash
# Crio novo arquivo/componente
# Implemento conforme spec
# Adiciono testes
# Build & test
npm run build && npm run test
```
**Resultado:** Nova feature pronta

---

### COMANDO: "Performance audit"
```bash
# Analiso logs de performance
pm2 logs fraga-* --lines 100
# Identifico gargalos
# Sugiro otimizações
```
**Resultado:** Recomendações de melhoria

---

### COMANDO: "Deploy prod"
```bash
# Backup automático
cp -r dist dist.backup

# Build novo
npm run build

# Teste antes de restart
npm run test

# Deploy com zero downtime
pm2 restart fraga-dashboard --update-env
```
**Resultado:** Nova versão em produção

---

### COMANDO: "Rollback"
```bash
# Volta para versão anterior
cp -r dist.backup dist
pm2 restart fraga-dashboard
```
**Resultado:** Versão anterior restaurada

---

## 🔥 COMANDOS ÚTEIS

### Verificar tudo:
```bash
./scripts/project-dashboard.sh
```

### Ver logs em tempo real:
```bash
pm2 logs fraga-dashboard
```

### Restartar tudo:
```bash
pm2 restart all --update-env
```

### Ver variáveis de ambiente:
```bash
pm2 describe fraga-dashboard | grep env
```

### Limpar logs:
```bash
pm2 flush
```

### Parar aplicação:
```bash
pm2 stop fraga-dashboard
```

### Iniciar aplicação:
```bash
pm2 start ecosystem.config.cjs
```

---

## 📋 ORDEM TÍPICA DE TRABALHO

1. **Você:** "DeepSeek, status"
2. **DeepSeek:** [Mostra dashboard de status]
3. **Você:** "DeepSeek, [tarefa específica]"
4. **DeepSeek:** [Executa e reporta]
5. **Você:** "Valida ou pede ajustes"
6. **DeepSeek:** [Ajusta se necessário]
7. **Você:** "Deploy prod"
8. **DeepSeek:** [Faz o deploy]

---

## 🚨 EMERGÊNCIAS

### Se app morrer:
```bash
pm2 restart fraga-* --update-env
pm2 logs fraga-dashboard --lines 50
```

### Se database cair:
```bash
# Verificar conexão
curl -I http://localhost:3000
# Verificar logs
pm2 logs fraga-dashboard
```

### Se memory explodir:
```bash
pm2 restart fraga-* --update-env
# Monitor
watch -n 1 'pm2 status'
```

---

## 📝 NOTAS IMPORTANTES

✅ **SEMPRE** faça `npm run build` antes de restart
✅ **SEMPRE** use `--update-env` ao reiniciar
✅ **SEMPRE** check logs após uma mudança
✅ **NUNCA** delete dist/ sem backup
✅ **NUNCA** modifique .env em produção sem avisar

---

## 🎓 TUDO RESUMIDO

### Você = Chefe (decide)
### DeepSeek = Executor (faz)
### Resultado = Produção 24/7 stable

**Bora avançar! 🚀**

