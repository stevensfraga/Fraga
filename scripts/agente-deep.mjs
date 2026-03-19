import OpenAI from "openai";
import { execSync } from "child_process";
import readline from "readline";
import { readFileSync } from "fs";

const env = readFileSync("/opt/fraga-dashboard/.env.production","utf8");
const deepKey = env.split("\n").find(l=>l.startsWith("DEEPSEEK_API_KEY="))?.replace("DEEPSEEK_API_KEY=","")?.trim();

const client = new OpenAI({baseURL:"https://api.deepseek.com",apiKey:deepKey});

function cmd(c){
  if(!c||typeof c!=="string")return "Erro: comando invalido";
  try{return execSync(c,{cwd:"/opt/fraga-dashboard",timeout:60000,encoding:"utf8"});}
  catch(e){return(e.stdout||"")+(e.stderr||"")||e.message;}
}

async function run(msg,hist){
  hist.push({role:"user",content:msg});
  const sys="Voce e um agente DevOps expert do projeto Fraga Dashboard. CONTEXTO: projeto Node.js TypeScript em /opt/fraga-dashboard. Stack: Express, tRPC, React, MySQL TiDB Cloud. PM2 processo: fraga-dashboard. Build: cd /opt/fraga-dashboard && npm run build. Restart: pm2 restart fraga-dashboard. Logs: pm2 logs fraga-dashboard --lines 50 --nostream. Banco: DATABASE_URL no arquivo /opt/fraga-dashboard/.env.production. Webhook NFS-e: /opt/fraga-dashboard/server/routes/zapcontabilWebhookMessageSetor.ts. Motor emissao: /opt/fraga-dashboard/server/services/nfseEmissionEngine.ts. Frontend: /opt/fraga-dashboard/client/src/pages/. NUNCA pergunte sobre credenciais ou APIs - tudo esta no .env.production. Execute sem pedir confirmacao.";
  const tools=[{type:"function",function:{name:"bash",description:"Executa comando bash",parameters:{type:"object",properties:{command:{type:"string"}},required:["command"]}}}];
  let loop=true;
  while(loop){
    const res=await client.chat.completions.create({model:"deepseek-chat",messages:[{role:"system",content:sys},...hist],tools,tool_choice:"auto"});
    const msg2=res.choices[0].message;
    hist.push(msg2);
    if(msg2.content)console.log("\n🤖 "+msg2.content);
    if(msg2.tool_calls&&msg2.tool_calls.length>0){
      for(const tc of msg2.tool_calls){
        const c=JSON.parse(tc.function.arguments).command;
        console.log("\n📟 "+c);
        const out=String(cmd(c)).substring(0,800);
        console.log("📤 "+out);
        hist.push({role:"tool",tool_call_id:tc.id,content:out});
      }
    }else{loop=false;}
  }
  return hist;
}

async function main(){
  console.log("✅ Agente DeepSeek iniciado!\n");
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  let hist=[];
  const ask=()=>rl.question("Deep: ",async(inp)=>{
    if(!inp||inp.trim()==="sair"){rl.close();return;}
    hist=await run(inp.trim(),hist);
    ask();
  });
  ask();
}

main().catch(console.error);
