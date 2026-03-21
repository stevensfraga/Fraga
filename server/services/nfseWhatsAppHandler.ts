/**
 * NFS-e WhatsApp Handler — Fluxo Conversacional Mínimo
 *
 * Fluxo:
 * 1. Cliente envia mensagem com intenção de emitir NFS-e
 * 2. Sistema identifica prestador e tomador (por telefone ou CNPJ)
 * 3. Pergunta apenas o VALOR (dados padrão: Anexo III, sem retenção)
 * 4. Mostra resumo e pergunta "Emitir agora? SIM / NÃO"
 * 5a. SIM → cria emissão e dispara o motor Playwright
 * 5b. NÃO → salva rascunho e cria ticket interno
 *
 * Estados da conversa:
 * - idle: aguardando intenção
 * - awaiting_valor: intenção detectada, aguardando valor
 * - awaiting_confirm: valor recebido, aguardando confirmação SIM/NÃO
 */

import mysql from "mysql2/promise";
import { invokeLLM } from "../_core/llm";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await getConn();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

async function rawExec(sql: string, params: any[] = []): Promise<any> {
  const conn = await getConn();
  try {
    const [result] = await conn.execute(sql, params);
    return result;
  } finally {
    await conn.end();
  }
}

// ─── Helpers de sessão conversacional ─────────────────────────────

async function getSession(phone: string) {
  const now = Date.now();
  const rows = await rawQuery(
    "SELECT * FROM nfse_wpp_sessions WHERE phone = ? AND expires_at > ? ORDER BY updated_at DESC LIMIT 1",
    [phone, now]
  );
  return rows[0] || null;
}

async function createSession(phone: string, configId: number, data: Partial<{
  tomadorId: number | null;
  tomadorNome: string | null;
  tomadorCpfCnpj: string | null;
}>) {
  const now = Date.now();
  const expires = now + 30 * 60 * 1000; // 30 minutos
  await rawExec(
    `INSERT INTO nfse_wpp_sessions (phone, state, config_id, tomador_id, tomador_nome, tomador_cpf_cnpj, created_at, updated_at, expires_at)
     VALUES (?, 'awaiting_valor', ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE state='awaiting_valor', config_id=VALUES(config_id), tomador_id=VALUES(tomador_id),
     tomador_nome=VALUES(tomador_nome), tomador_cpf_cnpj=VALUES(tomador_cpf_cnpj), updated_at=VALUES(updated_at), expires_at=VALUES(expires_at)`,
    [phone, configId, data.tomadorId || null, data.tomadorNome || null, data.tomadorCpfCnpj || null, now, now, expires]
  );
  return getSession(phone);
}

async function updateSession(phone: string, updates: Record<string, any>) {
  const now = Date.now();
  const expires = now + 30 * 60 * 1000;
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(", ");
  const values = Object.values(updates);
  await rawExec(
    `UPDATE nfse_wpp_sessions SET ${fields}, updated_at = ?, expires_at = ? WHERE phone = ?`,
    [...values, now, expires, phone]
  );
}

async function clearSession(phone: string) {
  await rawExec("DELETE FROM nfse_wpp_sessions WHERE phone = ?", [phone]);
}

// ─── Detecção de intenção NFS-e ────────────────────────────────────

const NFSE_KEYWORDS = [
  "nota fiscal",
  "nfs-e",
  "nfse",
  "emitir nota",
  "emissão de nota",
  "nota de serviço",
  "nota de servico",
  "emitir nf",
  "gerar nota",
  "gerar nf",
];

export function isNfseRequest(text: string): boolean {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return NFSE_KEYWORDS.some(kw => {
    const normalizedKw = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return lower.includes(normalizedKw);
  });
}

function isConfirmation(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return ["sim", "s", "yes", "y", "confirmar", "confirma", "ok", "pode", "emitir"].some(w => lower === w || lower.startsWith(w + " "));
}

function isDenial(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return ["não", "nao", "n", "no", "cancelar", "cancela", "cancel", "depois", "rascunho"].some(w => lower === w || lower.startsWith(w + " "));
}

function extractValor(text: string): number | null {
  // Tenta extrair valor monetário da mensagem
  const patterns = [
    /R?\$\s*([\d.,]+)/i,
    /valor\s+(?:de\s+)?R?\$?\s*([\d.,]+)/i,
    /^([\d.,]+)$/,
    /([\d]+(?:[.,][\d]{2})?)(?:\s*reais?)?/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const raw = m[1].replace(/\./g, "").replace(",", ".");
      const v = parseFloat(raw);
      if (!isNaN(v) && v > 0) return v;
    }
  }
  return null;
}

function extractCompetencia(text: string): string {
  const m = text.match(/(\d{2})\/(\d{4})/);
  if (m) return `${m[1]}/${m[2]}`;
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
}

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

// ─── Busca tomador por telefone ou CNPJ ───────────────────────────

async function findTomadorByPhone(phone: string, configId: number) {
  // Tenta encontrar tomador pelo telefone cadastrado
  const phoneLimpo = phone.replace(/\D/g, "");
  const rows = await rawQuery(
    `SELECT * FROM nfse_tomadores WHERE configId = ? AND ativo = 1 
     AND REPLACE(REPLACE(REPLACE(telefone, ' ', ''), '-', ''), '(', '') LIKE ?`,
    [configId, `%${phoneLimpo.slice(-8)}%`]
  );
  return rows[0] || null;
}

async function findTomadorByCnpj(cnpj: string, configId: number) {
  const cnpjLimpo = cnpj.replace(/\D/g, "");
  const rows = await rawQuery(
    `SELECT * FROM nfse_tomadores WHERE configId = ? AND ativo = 1
     AND REPLACE(REPLACE(REPLACE(cpfCnpj, '.', ''), '-', ''), '/', '') = ?`,
    [configId, cnpjLimpo]
  );
  return rows[0] || null;
}

// ─── Handler principal ─────────────────────────────────────────────

export async function handleNfseWhatsAppRequest(
  fromPhone: string,
  text: string,
  messageId?: string,
): Promise<{
  handled: boolean;
  emissaoId?: number;
  replyMessage?: string;
}> {
  const textTrimmed = text.trim();

  // ── Verificar sessão ativa ──────────────────────────────────────
  const session = await getSession(fromPhone);

  // ── Estado: aguardando_valor ────────────────────────────────────
  if (session?.state === "awaiting_valor") {
    const valor = extractValor(textTrimmed);
    const competencia = extractCompetencia(textTrimmed);

    if (!valor) {
      return {
        handled: true,
        replyMessage:
          `❓ Não consegui identificar o valor. Por favor, informe apenas o valor:\n\n` +
          `Exemplo: *1500* ou *R$ 1.500,00*`,
      };
    }

    // Buscar config para descrição padrão
    const configs = await rawQuery("SELECT * FROM nfse_config WHERE id = ? AND ativo = 1", [session.config_id]);
    const config = configs[0];

    const descricao = config?.descricaoPadrao
      ?.replace("{mes}", new Date().toLocaleString("pt-BR", { month: "long" }))
      ?.replace("{ano}", String(new Date().getFullYear()))
      ?.replace("{competencia}", competencia)
      || `Prestação de serviços contábeis referente à competência ${competencia}`;

    await updateSession(fromPhone, {
      state: "awaiting_confirm",
      valor,
      competencia,
      descricao_servico: descricao,
    });

    const tomadorInfo = session.tomador_nome
      ? `• Tomador: *${session.tomador_nome}*\n${session.tomador_cpf_cnpj ? `• CPF/CNPJ: ${session.tomador_cpf_cnpj}\n` : ""}`
      : `• Tomador: *Não identificado* _(será preenchido no portal)_\n`;

    const resumo =
      `📋 *Resumo da NFS-e:*\n\n` +
      `• Prestador: *${config?.razaoSocial || "Fraga Contabilidade"}*\n` +
      tomadorInfo +
      `• Valor: *${fmtCurrency(valor)}*\n` +
      `• Competência: *${competencia}*\n` +
      `• Serviço: _${descricao}_\n` +
      `• ISS: Sem retenção (Simples Nacional)\n` +
      `• Anexo: III\n\n` +
      `Deseja emitir agora?\n\n` +
      `✅ *SIM* — emitir\n❌ *NÃO* — salvar rascunho`;

    return { handled: true, replyMessage: resumo };
  }

  // ── Estado: aguardando_confirm ──────────────────────────────────
  if (session?.state === "awaiting_confirm") {
    if (isConfirmation(textTrimmed)) {
      // Criar emissão e disparar motor
      const configs = await rawQuery("SELECT * FROM nfse_config WHERE id = ? AND ativo = 1", [session.config_id]);
      const config = configs[0];

      if (!config) {
        await clearSession(fromPhone);
        return {
          handled: true,
          replyMessage: "⚠️ Configuração do prestador não encontrada. Contate o suporte.",
        };
      }

      const result = await rawExec(
        `INSERT INTO nfse_emissoes (configId, tomadorId, tomadorNome, tomadorCpfCnpj, valor, competencia,
         descricaoServico, status, solicitadoVia, whatsappPhone, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rascunho', 'whatsapp', ?, NOW())`,
        [
          config.id,
          session.tomador_id || null,
          session.tomador_nome || "Não informado",
          session.tomador_cpf_cnpj || null,
          session.valor,
          session.competencia,
          session.descricao_servico || null,
          fromPhone,
        ]
      );

      const emissaoId = result.insertId;

      await rawExec(
        `INSERT INTO nfse_audit (emissaoId, configId, action, details, performedBy) VALUES (?, ?, ?, ?, ?)`,
        [
          emissaoId,
          config.id,
          "created_via_whatsapp_confirmed",
          JSON.stringify({ fromPhone, messageId, valor: session.valor, competencia: session.competencia }),
          "whatsapp-handler",
        ]
      );

      await clearSession(fromPhone);

      // Disparar motor de emissão em background
      setImmediate(async () => {
        try {
          const { emitNfse } = await import("./nfseEmissionEngine");
          await emitNfse(emissaoId);
        } catch (err: any) {
          console.error(`[NfseWhatsApp] Erro ao disparar motor para emissão ${emissaoId}:`, err.message);
        }
      });

      return {
        handled: true,
        emissaoId,
        replyMessage:
          `✅ *NFS-e #${emissaoId} confirmada!*\n\n` +
          `⏳ O motor de emissão está processando sua nota. Você receberá o PDF assim que concluído.\n\n` +
          `_Acompanhe em: Dashboard > NFS-e_`,
      };
    }

    if (isDenial(textTrimmed)) {
      // Salvar como rascunho
      const configs = await rawQuery("SELECT * FROM nfse_config WHERE id = ? AND ativo = 1", [session.config_id]);
      const config = configs[0];

      const result = await rawExec(
        `INSERT INTO nfse_emissoes (configId, tomadorId, tomadorNome, tomadorCpfCnpj, valor, competencia,
         descricaoServico, status, solicitadoVia, whatsappPhone, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rascunho', 'whatsapp', ?, NOW())`,
        [
          config?.id || session.config_id,
          session.tomador_id || null,
          session.tomador_nome || "Não informado",
          session.tomador_cpf_cnpj || null,
          session.valor,
          session.competencia,
          session.descricao_servico || null,
          fromPhone,
        ]
      );

      const emissaoId = result.insertId;
      await clearSession(fromPhone);

      return {
        handled: true,
        emissaoId,
        replyMessage:
          `📌 *Rascunho salvo (#${emissaoId})*\n\n` +
          `A nota foi salva como rascunho. Você pode emiti-la manualmente no dashboard quando quiser.\n\n` +
          `_Dashboard > NFS-e > Rascunhos_`,
      };
    }

    // Resposta não reconhecida
    return {
      handled: true,
      replyMessage:
        `Por favor, responda:\n\n✅ *SIM* para emitir\n❌ *NÃO* para salvar como rascunho`,
    };
  }

  // ── Sem sessão ativa: detectar cancelamento via WhatsApp ────────
  // Padrões: "cancelar nota 12345", "cancelar nfse 12345", "cancela 12345"
  const cancelMatch = textTrimmed.match(/cancel[ae]r?\s+(?:nota|nfse|nfs-e)?\s*#?(\d+)/i);
  if (cancelMatch) {
    const numeroNfse = cancelMatch[1];
    console.log(`[NfseWhatsApp] Solicitação de cancelamento da NFS-e ${numeroNfse} por ${fromPhone}`);

    // Verificar se existe emissão com esse número
    const emissoes = await rawQuery(
      "SELECT e.id, e.status, e.numeroNf, c.cnpj, c.inscricaoMunicipal, c.razaoSocial FROM nfse_emissoes e JOIN nfse_config c ON c.id = e.configId WHERE e.numeroNf = ? AND e.status = 'emitida' LIMIT 1",
      [numeroNfse]
    );

    if (!emissoes.length) {
      return {
        handled: true,
        replyMessage: `❌ NFS-e nº *${numeroNfse}* não encontrada ou já cancelada.\n\nPara cancelar, a nota deve estar com status "Emitida".`,
      };
    }

    const em = emissoes[0] as any;

    // Tentar cancelar via ABRASF
    try {
      const { cancelarViaSoap } = await import("./abrasfService");
      const resultado = await cancelarViaSoap(em.cnpj, em.inscricaoMunicipal, numeroNfse, "2");

      if (resultado.success) {
        await rawExec(
          "UPDATE nfse_emissoes SET status = 'cancelada', erroDetalhes = 'Cancelada via WhatsApp/ABRASF' WHERE id = ?",
          [em.id]
        );
        return {
          handled: true,
          replyMessage:
            `✅ *NFS-e nº ${numeroNfse} cancelada com sucesso!*\n\n` +
            `• Empresa: ${em.razaoSocial}\n` +
            `• Cancelada via: Webservice ABRASF\n\n` +
            `_Nota fiscal cancelada permanentemente na Prefeitura de Vila Velha._`,
        };
      } else {
        return {
          handled: true,
          replyMessage:
            `⚠️ *Cancelamento da NFS-e nº ${numeroNfse} não foi possível via webservice.*\n\n` +
            `Motivo: ${resultado.erro || "Recusado pela prefeitura"}\n\n` +
            `Se o cancelamento for necessário, entre em contato com a prefeitura pessoalmente ` +
            `para solicitar processo administrativo de cancelamento.`,
        };
      }
    } catch (err: any) {
      return {
        handled: true,
        replyMessage: `❌ Erro ao cancelar a NFS-e nº ${numeroNfse}: ${err.message}`,
      };
    }
  }

  // ── Sem sessão ativa: detectar nova intenção ────────────────────
  if (!isNfseRequest(textTrimmed)) {
    return { handled: false };
  }

  console.log(`[NfseWhatsApp] Nova solicitação de NFS-e de ${fromPhone}`);

  // Buscar prestador ativo
  const configs = await rawQuery("SELECT * FROM nfse_config WHERE ativo = 1 ORDER BY id LIMIT 1");
  if (configs.length === 0) {
    return {
      handled: true,
      replyMessage:
        "⚠️ Nenhum prestador configurado para emissão de NFS-e. Configure um prestador no dashboard primeiro.",
    };
  }
  const config = configs[0];

  // Tentar identificar tomador pelo telefone
  const tomador = await findTomadorByPhone(fromPhone, config.id);

  // Verificar se a mensagem já contém o valor
  const valorNaMensagem = extractValor(textTrimmed);

  if (valorNaMensagem) {
    // Mensagem já tem valor — ir direto para confirmação
    const competencia = extractCompetencia(textTrimmed);
    const descricao = config.descricaoPadrao
      ?.replace("{mes}", new Date().toLocaleString("pt-BR", { month: "long" }))
      ?.replace("{ano}", String(new Date().getFullYear()))
      ?.replace("{competencia}", competencia)
      || `Prestação de serviços contábeis referente à competência ${competencia}`;

    await createSession(fromPhone, config.id, {
      tomadorId: tomador?.id || null,
      tomadorNome: tomador?.nome || null,
      tomadorCpfCnpj: tomador?.cpfCnpj || null,
    });
    await updateSession(fromPhone, {
      state: "awaiting_confirm",
      valor: valorNaMensagem,
      competencia,
      descricao_servico: descricao,
    });

    const tomadorInfo = tomador
      ? `• Tomador: *${tomador.nome}*\n• CPF/CNPJ: ${tomador.cpfCnpj}\n`
      : `• Tomador: *Não identificado* _(será preenchido no portal)_\n`;

    const resumo =
      `📋 *Resumo da NFS-e:*\n\n` +
      `• Prestador: *${config.razaoSocial}*\n` +
      tomadorInfo +
      `• Valor: *${fmtCurrency(valorNaMensagem)}*\n` +
      `• Competência: *${competencia}*\n` +
      `• Serviço: _${descricao}_\n` +
      `• ISS: Sem retenção (Simples Nacional)\n` +
      `• Anexo: III\n\n` +
      `Deseja emitir agora?\n\n` +
      `✅ *SIM* — emitir\n❌ *NÃO* — salvar rascunho`;

    return { handled: true, replyMessage: resumo };
  }

  // Sem valor na mensagem — iniciar conversa e perguntar valor
  await createSession(fromPhone, config.id, {
    tomadorId: tomador?.id || null,
    tomadorNome: tomador?.nome || null,
    tomadorCpfCnpj: tomador?.cpfCnpj || null,
  });

  const saudacao = tomador
    ? `Olá! Identificamos você como *${tomador.nome}*. `
    : `Olá! `;

  return {
    handled: true,
    replyMessage:
      `${saudacao}Vou emitir uma NFS-e para *${config.razaoSocial}*.\n\n` +
      `💰 Qual é o *valor* da nota?\n\n` +
      `_Exemplo: R$ 1.500,00 ou apenas 1500_\n\n` +
      `_(Dados padrão: Simples Nacional, Anexo III, sem retenção de ISS)_`,
  };
}
