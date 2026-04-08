# Fraga Dashboard

Dashboard moderno e integrado com Claude AI para análise de emissões e dados financeiros.

## 🚀 Quick Start

### Instalação
```bash
npm install
```

### Build
```bash
npm run build
```

### Desenvolvimento
```bash
npm run dev
```

### Deploy (PM2)
```bash
pm2 start app --name fraga-dashboard
# ou
pm2 restart fraga-dashboard
```

## 📊 Funcionalidades

- 📈 Dashboard em tempo real
- 🤖 Integração com Claude AI
- 💰 Análise financeira
- 🌱 Rastreamento de emissões
- 📱 Interface responsiva

## 🔧 Tecnologias

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: SQLite
- **AI**: Claude API
- **Deploy**: PM2 + Ubuntu

## 📁 Estrutura

```
fraga-dashboard/
├── client/          # Frontend React
├── server/          # Backend Node.js
├── data/            # Banco de dados e dados
├── certs/           # Certificados SSL
├── backups/         # Backups automáticos
└── .github/         # GitHub Actions CI/CD
```

## 🔒 Variáveis de Ambiente

Criar `.env` ou `.env.local` com:
```
CLAUDE_API_KEY=seu_key_aqui
DATABASE_URL=./data/fraga.db
NODE_ENV=production
```

## 📝 GitHub Actions

Workflows automáticos configurados:
- ✅ Build automático em push
- ✅ Tests no PR
- ✅ Deploy automático na main/master

Configure os secrets no GitHub:
- `DEPLOY_KEY`: Chave SSH privada
- `DEPLOY_HOST`: IP/hostname do servidor
- `DEPLOY_USER`: Usuário SSH

## 👥 Contribuindo

1. Clone o repositório
2. Crie uma branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Proprietary - Fraga Consultoria

## 👨‍💻 DevOps

- Build: `npm run build`
- Restart: `pm2 restart fraga-dashboard`
- Logs: `pm2 logs fraga-dashboard --lines 50 --nostream`
- Git Push: `git push origin master`

