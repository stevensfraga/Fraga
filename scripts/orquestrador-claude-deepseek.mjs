import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { execSync } from "child_process";
import readline from "readline";
import { readFileSync } from "fs";

// Ler contexto
let contextoString = "";
try {
  contextoString = readFileSync(
    "/opt/fraga-dashboard/scripts/CONTEXTO-DEEPSEEK.md",
    "utf8"
  );
} catch (e) {
  contextoString = "Contexto não disponível.";
}

// Ler APIs
const env = readFileSync("/opt/fraga-dashboard/.env.production", "utf8");
const claudeKey = env
  .split("\n")
  .find((l) => l.startsWith("ANTHROPIC_API_KEY="))
  ?.replace("ANTHROPIC_API_KEY=", "")
  ?.trim();

const deepKey = env
  .split("\n")
  .find((l) => l.startsWith("DEEPSEEK_API_KEY="))
  ?.replace("DEEPSEEK_API_KEY=", "")
  ?.trim();

if (!claudeKey || !deepKey) {
  console.error("❌ Faltam chaves de API no .env.production");
  process.exit(1);
}

const claudeClient = new Anthropic();
const deepseekClient = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: deepKey,
});

function cmd(c) {
  try {
    return execSync(c, {
      cwd: "/opt/fraga-dashboard",
      timeout: 60000,
      encoding: "utf8",
    });
  } catch (e) {
    return "ERRO: " + ((e.stdout || "") + (e.stderr || "") || e.message);
  }
}

async function executarComDeepSeek(tarefa, comandos) {
  const response = await deepseekClient.messages.create({
    model: "deepseek-chat",
    max_tokens: 1024,
    system: `Você é DeepSeek, executor técnico. Sua tarefa:
${tarefa}

Contexto: ${contextoString.substring(0, 500)}...`,
    messages: [
      {
        role: "user",
        content: `Execute: ${comandos}`,
      },
    ],
  });

  const msg =
    response.content[0].type === "text"
      ? response.content[0].text
      : "Vazio";

  // Extrair e executar bash
  const bashMatch = msg.match(/```bash\n([\s\S]*?)```/);
  if (bashMatch) {
    const bashCode = bashMatch[1].trim();
    const output = cmd(bashCode);
    return {
      sucesso: !output.includes("ERRO"),
      output: output,
      comando: bashCode,
    };
  }

  return {
    sucesso: false,
    output: msg,
    comando: comandos,
  };
}

async function executarComClaude(msg, historico) {
  historico.push({ role: "user", content: msg });

  const response = await claudeClient.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 2048,
    system: `Você é Claude, CHEFE DE PROJETO do Fraga Dashboard.

Seu papel: Planejar, delegar, validar, reportar.

Contexto: ${contextoString.substring(0, 1000)}...

Ao detectar que DeepSeek deve executar, use este formato:

[TAREFA]
Nome: [nome da tarefa]
Descrição: [descrição]
Comandos: [comandos a executar]
[FIM TAREFA]`,
    messages: historico.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const assistantMsg =
    response.content[0].type === "text"
      ? response.content[0].text
      : "Vazio";

  historico.push({ role: "assistant", content: assistantMsg });

  return {
    mensagem: assistantMsg,
    historico: historico,
  };
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║   🤝 ORQUESTRADOR CLAUDE ↔ DEEPSEEK                     ║");
  console.log("║   Fraga Dashboard - Automação Inteligente                ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  console.log("👨‍💼 CLAUDE: Chefe de Projeto");
  console.log("🤖 DEEPSEEK: Executor Técnico\n");
  console.log("📚 Contexto carregado:", contextoString.split("\n").length, "linhas");
  console.log("💬 Digite 'sair' para encerrar\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let historicoClaude = [];

  const askQuestion = () => {
    rl.question("👤 Você: ", async (input) => {
      if (input.toLowerCase() === "sair") {
        console.log("\n👋 Até logo!");
        rl.close();
        return;
      }

      if (input.trim()) {
        try {
          // Claude (Chefe) analisa
          console.log("\n👨‍💼 CLAUDE analisando...\n");
          const resultado = await executarComClaude(input, historicoClaude);
          historicoClaude = resultado.historico;

          console.log("👨‍💼 CLAUDE (Chefe):");
          console.log(resultado.mensagem);

          // Procura por tarefas delegadas
          const tarefaMatch = resultado.mensagem.match(
            /\[TAREFA\]([\s\S]*?)\[FIM TAREFA\]/
          );
          if (tarefaMatch) {
            const tarefaBloco = tarefaMatch[1];
            const nomeMatch = tarefaBloco.match(/Nome: (.*)/);
            const comandosMatch = tarefaBloco.match(/Comandos: ([\s\S]*?)$/);

            if (nomeMatch && comandosMatch) {
              const nomeTarefa = nomeMatch[1].trim();
              const comandos = comandosMatch[1].trim();

              console.log("\n🤖 DEEPSEEK executando tarefa delegada...\n");
              const execResult = await executarComDeepSeek(
                nomeTarefa,
                comandos
              );

              console.log(
                "🤖 DEEPSEEK (Executor) - Resultado:",
                execResult.sucesso ? "✅ Sucesso" : "❌ Erro"
              );
              console.log("📤 Output:");
              console.log(execResult.output);

              // Claude valida resultado
              console.log("\n👨‍💼 CLAUDE validando resultado...\n");
              const validacao = await executarComClaude(
                `Resultado da execução da tarefa "${nomeTarefa}":\n\n${execResult.output}\n\nValide e reporte se foi bem-sucedida.`,
                historicoClaude
              );
              historicoClaude = validacao.historico;

              console.log("👨‍💼 CLAUDE (Validação):");
              console.log(validacao.mensagem);
            }
          }
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
