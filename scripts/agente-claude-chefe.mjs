import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import readline from "readline";
import { readFileSync } from "fs";

// Ler arquivo de contexto
let contextoString = "";
try {
  contextoString = readFileSync(
    "/opt/fraga-dashboard/scripts/CONTEXTO-DEEPSEEK.md",
    "utf8"
  );
} catch (e) {
  console.warn("⚠️  Contexto não disponível");
  contextoString = "Contexto não disponível. Usando conhecimento base.";
}

// Ler chave de API
const env = readFileSync("/opt/fraga-dashboard/.env.production", "utf8");
const claudeKey = env
  .split("\n")
  .find((l) => l.startsWith("ANTHROPIC_API_KEY="))
  ?.replace("ANTHROPIC_API_KEY=", "")
  ?.trim();

if (!claudeKey) {
  console.error("❌ ERRO: ANTHROPIC_API_KEY não encontrada em .env.production");
  process.exit(1);
}

const client = new Anthropic();

function cmd(c) {
  if (!c || typeof c !== "string") return "Erro: comando inválido";
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

async function runClaude(msg, hist) {
  hist.push({ role: "user", content: msg });

  const systemPrompt = `Você é CLAUDE, CHEFE DE PROJETO do Fraga Dashboard. Seu papel:

1. 🎯 PLANEJAR: Definir estratégia e tarefas
2. 📋 DELEGAR: Instruir DeepSeek (executor) para executar tarefas
3. ✅ VALIDAR: Revisar resultados e garantir qualidade
4. 📊 RELATAR: Fornecer status e insights

## 📚 CONTEXTO DO PROJETO

${contextoString}

## 🤝 RELAÇÃO COM DEEPSEEK

- DeepSeek é seu executor técnico
- Você planeja, DeepSeek executa
- Sempre valide resultados antes de reportar sucesso
- Delegar tarefas específicas e mensuráveis

## 📋 MODO DE OPERAÇÃO

1. Analise a solicitação
2. Crie um plano claro
3. Delegue ao DeepSeek se necessário
4. Valide a execução
5. Reporte status

## 🛠️ COMO DELEGAR

Use este formato para instruir DeepSeek:

[DELEGAÇÃO PARA DEEPSEEK]
Tarefa: [descrição clara]
Comandos: [comandos específicos]
Validação: [como validar sucesso]
Prioridade: [alta/média/baixa]
[FIM DELEGAÇÃO]

## 📊 ESTRUTURA DE RESPOSTA

- Mantenha respostas profissionais
- Use emojis para legibilidade
- Cite arquivos e rotas específicas
- Sempre valide antes de confirmar sucesso`;

  const response = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 2048,
    system: systemPrompt,
    messages: hist.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const assistantMsg =
    response.content[0].type === "text"
      ? response.content[0].text
      : "Resposta vazia";

  hist.push({ role: "assistant", content: assistantMsg });

  console.log("\n👨‍💼 CLAUDE (Chefe):\n");
  console.log(assistantMsg);

  // Procura por delegações
  const delegacaoMatch = assistantMsg.match(
    /\[DELEGAÇÃO PARA DEEPSEEK\]([\s\S]*?)\[FIM DELEGAÇÃO\]/
  );
  if (delegacaoMatch) {
    console.log("\n📤 Delegação detectada. Executando com DeepSeek...\n");
    const delegacao = delegacaoMatch[1];
    // Aqui seria chamado o DeepSeek (implementar integração)
    console.log("🔄 [DeepSeek executaria: " + delegacao.substring(0, 50) + "...]");
  }

  return hist;
}

// CLI interativo
async function main() {
  console.log("👨‍💼 CLAUDE - CHEFE DE PROJETO");
  console.log("📊 Fraga Dashboard Management");
  console.log(
    "📚 Contexto carregado: " +
      contextoString.split("\n").length +
      " linhas\n"
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
          hist = await runClaude(input, hist);
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
