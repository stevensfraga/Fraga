import OpenAI from "openai";
import { execSync } from "child_process";
import { readFileSync } from "fs";

// Ler arquivo de contexto
let contextoString = "";
try {
  contextoString = readFileSync(
    "/opt/fraga-dashboard/scripts/CONTEXTO-DEEPSEEK.md",
    "utf8"
  );
} catch (e) {
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
  if (!c || typeof c !== "string") return "Erro: comando inválido";
  try {
    const output = execSync(c, {
      cwd: "/opt/fraga-dashboard",
      timeout: 60000,
      encoding: "utf8",
    });
    return output;
  } catch (e) {
    return "ERRO: " + ((e.stdout || "") + (e.stderr || "") || e.message);
  }
}

export async function executeTask(taskDescription, commands) {
  console.log("\n🤖 DEEPSEEK EXECUTOR");
  console.log("═══════════════════════════════════════════");
  console.log("📋 Tarefa:", taskDescription);
  console.log("═══════════════════════════════════════════\n");

  const systemPrompt = `Você é DEEPSEEK, EXECUTOR TÉCNICO do Fraga Dashboard.

Seu papel:
- 🛠️ EXECUTAR: Realizar tarefas técnicas com precisão
- ✅ VALIDAR: Garantir sucesso da execução
- 📊 REPORTAR: Fornecer feedback claro e objetivo
- ⚡ OTIMIZAR: Usar best practices

## 📚 CONTEXTO DO PROJETO

${contextoString}

## 🎯 MODO DE EXECUÇÃO

1. Receba tarefa do Claude (chefe)
2. Entenda os requisitos
3. Execute os comandos especificados
4. Valide o resultado
5. Reporte sucesso ou erro

## 🛡️ SEGURANÇA

- Nunca execute comandos não validados
- Sempre confirme antes de aplicar mudanças
- Reporte erros completamente
- Backup antes de operações críticas`;

  const messages = [
    {
      role: "user",
      content: `Tarefa delegada: ${taskDescription}\n\nComandos para executar:\n${commands}\n\nExecute com precisão e reporte resultado.`,
    },
  ];

  const response = await client.messages.create({
    model: "deepseek-chat",
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages,
  });

  const assistantMsg =
    response.content[0].type === "text"
      ? response.content[0].text
      : "Resposta vazia";

  console.log("🔍 Análise:", assistantMsg, "\n");

  // Procura por bloco de comandos bash
  const bashMatch = assistantMsg.match(/```bash\n([\s\S]*?)```/);
  if (bashMatch) {
    const bashCode = bashMatch[1].trim();
    console.log("⚙️ Executando:\n");
    console.log(bashCode);
    console.log("\n📤 Output:\n");

    const output = cmd(bashCode);
    console.log(output);

    return {
      success: !output.includes("ERRO"),
      output: output,
      task: taskDescription,
    };
  }

  return {
    success: false,
    output: assistantMsg,
    task: taskDescription,
  };
}

// CLI standalone
async function main() {
  if (process.argv.length < 3) {
    console.log("Uso: agente-deepseek-executor.mjs \"<tarefa>\" \"<comandos>\"");
    console.log('\nExemplo:');
    console.log(
      'node agente-deepseek-executor.mjs "Build do projeto" "npm run build"'
    );
    process.exit(1);
  }

  const task = process.argv[2];
  const commands = process.argv[3] || "";

  try {
    const result = await executeTask(task, commands);
    console.log("\n✅ Resultado:");
    console.log("Sucesso:", result.success);
    console.log("Tarefa:", result.task);
  } catch (e) {
    console.error("❌ Erro:", e.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
