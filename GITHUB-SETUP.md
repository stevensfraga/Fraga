# Configuração GitHub - Fraga Dashboard

## ✅ Próximos Passos

Seu repositório local já está inicializado! Agora você precisa:

### 1️⃣ Criar o repositório no GitHub

1. Acesse [github.com](https://github.com)
2. Clique em **"New repository"**
3. Nome: `fraga-dashboard`
4. Descrição: "Dashboard com Claude AI para análise de emissões"
5. Escolha **Private** (privado)
6. **Não** inicie com README, .gitignore ou licença (já temos)
7. Clique em **"Create repository"**

### 2️⃣ Adicionar Remote e Fazer Push

Execute estes comandos:

```bash
cd /opt/fraga-dashboard

# Adicionar URL do repositório (substitua SEU_USUARIO)
git remote add origin https://github.com/SEU_USUARIO/fraga-dashboard.git

# Renomear branch para main (padrão GitHub)
git branch -M main

# Fazer push
git push -u origin main
```

**Ou com SSH (recomendado):**

```bash
# Adicionar remote SSH
git remote add origin git@github.com:SEU_USUARIO/fraga-dashboard.git

# Push
git push -u origin main
```

### 3️⃣ Configurar Secrets para CI/CD (Opcional)

Se quiser deploy automático via GitHub Actions:

1. Vá para seu repositório no GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Clique em **"New repository secret"**

Adicione:
- **DEPLOY_KEY**: Sua chave SSH privada
- **DEPLOY_HOST**: IP ou hostname do servidor
- **DEPLOY_USER**: Usuário SSH (ex: `fraga`)

### 4️⃣ Verificar GitHub Actions

1. Vá para aba **"Actions"** do seu repositório
2. Você verá o workflow `build-and-deploy.yml` ativo
3. A cada push, ele irá:
   - ✅ Clonar o código
   - ✅ Instalar dependências
   - ✅ Fazer build
   - ✅ Executar testes (se houver)

## 🔄 Workflow de Desenvolvimento

Agora seu fluxo é:

```bash
# 1. Fazer mudanças
nano client/src/App.tsx

# 2. Commitar
git add .
git commit -m "Feature: melhorias no dashboard"

# 3. Fazer push (dispara CI/CD automático)
git push origin main

# 4. GitHub Actions constrói e testa automaticamente
# 5. Você recebe notificação no GitHub
```

## 🚨 Troubleshooting

### Erro: "Authentication failed"
```bash
# Se usar HTTPS, use Personal Access Token:
git remote set-url origin https://TOKEN@github.com/USUARIO/fraga-dashboard.git

# Se usar SSH, gere chave:
ssh-keygen -t ed25519 -C "seu_email@exemplo.com"
cat ~/.ssh/id_ed25519.pub  # Copie e adicione em GitHub → Settings → SSH Keys
```

### Erro: "fatal: remote origin already exists"
```bash
git remote remove origin
# Depois execute o comando de adicionar novamente
```

### Ver URL do remote
```bash
git remote -v
```

## 📊 Monitorando CI/CD

### Via GitHub:
- Actions tab mostra todos os workflows
- Clique no workflow para ver logs detalhados

### Localmente:
```bash
# Ver histórico de commits
git log --oneline -10

# Ver branches
git branch -a

# Ver status
git status
```

## 🎯 Dicas

- ✅ Sempre use branches para features: `git checkout -b feature/nova-feature`
- ✅ Faça commits pequenos e descritivos
- ✅ Use PRs antes de mergear na main
- ✅ Veja os logs do GitHub Actions antes de fazer deploy manual

---

**Precisa de ajuda?** Use `git help COMANDO` ou me avise! 🚀

