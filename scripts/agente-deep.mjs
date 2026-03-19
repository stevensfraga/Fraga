import OpenAI from "openai";
import { execSync } from "child_process";
import readline from "readline";
import { readFileSync } from "fs";
import { resolve } from "path";

// Ler arquivo de contexto
let contextoString = "";
try {
  const contextoPath = resolve("/opt/fraga-dashboard/scripts/CONTEXTO-DEEPSEEK.md");
  contextoString = readFileSync(contextoPath, "utf8");
} catch (e) {
  console.warn("⚠️  Aviso: Não foi possível ler CONTEXTO-DEEPSEEK.md");
  contextoString = "Contexto não disponível. Usando conhecimento base.";
}

// Ler chave de API
const env = readFileSync("/opt/fraga-dashboard/.env.production", "utf8");
const deepKey = env
  .split("\n")
  .find((l) => l.startsWith("DEEPSEEK_API_KEY="))
  ?.replace("DEEPSEEK_API_KEY=", "")
  ?.trim();

if (!deepKey) {
  console.error("❌ ERRO: DEEPSEEK_API_KEY não encontrada em .env.production");
  process.exit(1);
}

const client = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: deepKey,
});

function cmd(c) {
  if (!c || typeof c !== "string") return "Erro: comando invalido";
  try {
    return execSync(c, {
      cwd: "/opt/fraga-dashboard",
      timeout: 60000,
      encoding: "utf8",
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "") || e.message;
  }
}

async function run(msg, hist) {
  hist.push({ role: "user", content: msg });

  const systemPrompt = `Você é um agente DevOps expert do projeto Fraga Dashboard rodando em /opt/fraga-dashboard no Ubuntu.

## 📚 CONTEXTO DO PROJETO

${contextoString}

## 🛠️ INSTRUÇÕES OPERACIONAIS

1. Use bash para executar todos os comandos
2. Build: npm run build
3. Restart: pm2 restart fraga-dashboard
4. Logs: pm2 logs fraga-dashboard --lines 50 --nostream
5. Execute sem pedir confirmação
6. Sempre use a ferramenta bash para executar ações

## 📝 ESTRUTURA DE RESPOSTA

- Mantenha respostas concisas
- Forneça comandos prontos para executar
- Explique o contexto apenas quando necessário
- Use emojis para melhor legibilidade
- Cite arquivos/rotas quando relevante`;

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 2048,
    messages: [{role:"system",content:systemPrompt},...hist],
  });

  const assistantMsg = response.choices[0]?.message?.content || "Resposta vazia";

  hist.push({ role: "assistant", content: assistantMsg });

  // Procura por comandos bash (```bash ... ```)
  const bashMatch = assistantMsg.match(/```bash\n([\s\S]*?)```/);
  if (bashMatch) {
    const bashCode = bashMatch[1].trim();
    console.log("\n🔧 Executando comando sugerido:\n");
    console.log(bashCode);
    console.log("\n📤 Output:\n");
    const output = cmd(bashCode);
    console.log(output);
  } else {
    console.log("\n🤖 Resposta do DeepSeek:\n");
    console.log(assistantMsg);
  }

  return hist;
}

// CLI interativo
async function main() {
  console.log("🚀 Agente DeepSeek - Fraga Dashboard");
  console.log(
    "📚 Contexto carregado de: scripts/CONTEXTO-DEEPSEEK.md (" +
      contextoString.split("\n").length +
      " linhas)"
  );
  console.log("💬 Digite 'sair' para encerrar\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let hist = [];

  const askQuestion = () => {
    rl.question("👤 Você: ", async (input) => {
      if (input.toLowerCase() === "sair") {
        console.log("\n👋 Até logo!");
        rl.close();
        return;
      }

      if (input.trim()) {
        try {
          hist = await run(input, hist);
        } catch (e) {
          console.error("❌ Erro:", e.message);
        }
      }

      askQuestion();
    });
  };

  askQuestion();
}

main();
