import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import readline from "readline";

const client = new Anthropic({apiKey: "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"});

function cmd(c) {
  if (!c || typeof c !== 'string') return 'Erro: comando invalido';
  try {
    return execSync(c, { cwd: "/opt/fraga-dashboard", timeout: 60000, encoding: "utf8" });
  } catch(e) {
    return (e.stdout || '') + (e.stderr || '') || e.message;
  }
}

const tools = [{
  name: "bash",
  description: "Executa comando bash no servidor Ubuntu. Use para ler/editar arquivos, buildar, reiniciar servicos, consultar banco de dados.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string", description: "comando bash a executar" } },
    required: ["command"]
  }
}];

async function run(msg, hist) {
  hist.push({ role: "user", content: msg });
  const sys = "Voce e um agente DevOps do projeto Fraga Dashboard rodando em /opt/fraga-dashboard no Ubuntu. Use a ferramenta bash para executar comandos. Build: npm run build. Restart: pm2 restart fraga-dashboard. Logs: pm2 logs fraga-dashboard --lines 50 --nostream. Execute sem pedir confirmacao. Sempre use a ferramenta bash para executar acoes.";
  let loop = true;
  while(loop) {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: sys,
      tools,
      messages: hist
    });
    hist.push({ role: "assistant", content: res.content });
    for(const b of res.content) {
      if(b.type === "text") console.log("\n🤖 " + b.text);
      if(b.type === "tool_use") {
        const c = b.input && b.input.command ? b.input.command : null;
        if(!c) { console.log("⚠️ Comando vazio"); continue; }
        console.log("\n📟 " + c);
        const out = String(cmd(c)).substring(0, 800);
        console.log("📤 " + out);
        hist.push({ role: "user", content: [{ type: "tool_result", tool_use_id: b.id, content: out }] });
      }
    }
    loop = res.stop_reason === "tool_use";
  }
  return hist;
}

async function main() {
  console.log("✅ Agente Fraga v2 iniciado!\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let hist = [];
  const ask = () => rl.question("Você: ", async (inp) => {
    if(!inp || inp.trim() === "sair") { rl.close(); return; }
    hist = await run(inp.trim(), hist);
    ask();
  });
  ask();
}

main().catch(console.error);
