/**
 * NFS-e Router — endpoints tRPC para emissão de Nota Fiscal de Serviço
 *
 * Arquitetura multi-empresa:
 * - nfse_portais: credencial master do contador por portal/município (1 por prefeitura)
 * - nfse_config: dados do prestador por empresa (CNPJ, IM, regime, etc.) — sem senha
 * - nfse_tomadores: tomadores de serviço vinculados ao prestador
 * - nfse_emissoes: emissões de NFS-e
 * - nfse_audit: auditoria de todas as ações
 *
 * Fluxo de emissão: login contador (portal) → selecionar empresa por CNPJ/IM → emitir NFS-e
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { nfseEmissionService } from "../services/nfseEmissionService";
import mysql from "mysql2/promise";
import crypto from "crypto";
import { audit } from "../_core/auditHelper";

// ══════════════════════════════════════════════════════════════════════
// Helpers de banco de dados
// ══════════════════════════════════════════════════════════════════════

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

async function auditLog(
  emissaoId: number | null,
  configId: number | null,
  action: string,
  details: any,
  performedBy: string
) {
  await rawExec(
    `INSERT INTO nfse_audit (emissaoId, configId, action, details, performedBy) VALUES (?, ?, ?, ?, ?)`,
    [emissaoId, configId, action, JSON.stringify(details), performedBy]
  );
}

// Criptografia simples para senhas (AES-256-GCM)
const ENCRYPTION_KEY = process.env.JWT_SECRET?.substring(0, 32).padEnd(32, "0") || "fraga-nfse-secret-key-32chars!!!";

function encryptPassword(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptPassword(ciphertext: string): string {
  try {
    const [ivHex, encrypted] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return ciphertext; // fallback se não estiver criptografado
  }
}

// ══════════════════════════════════════════════════════════════════════
// Health Check & Test Emit Router — Motor de emissão NFS-e
// ══════════════════════════════════════════════════════════════════════

const healthCheckRouter = router({
  check: publicProcedure.query(async () => {
    return await nfseEmissionService.healthCheck();
  }),
});

const testEmitRouter = router({
  emit: protectedProcedure
    .input(
      z.object({
        cnpj: z.string().min(14).max(14),
        companyName: z.string().optional(),
        serviceDescription: z.string(),
        serviceValue: z.string(),
        clientName: z.string(),
        clientCnpj: z.string(),
        clientEmail: z.string().email().optional(),
        portalUrl: z.string().url().optional(),
        headless: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await nfseEmissionService.testEmit(input);
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Portais Router — Credencial master do contador por portal/município
// ══════════════════════════════════════════════════════════════════════

const portaisRouter = router({
  list: publicProcedure.query(async () => {
    const rows = await rawQuery(
      `SELECT id, nome, municipio, uf, url_portal, usuario_contador,
              CASE WHEN senha_contador IS NOT NULL AND senha_contador != '' AND senha_contador != 'CONFIGURAR_SENHA' THEN 1 ELSE 0 END as senhaConfigurada,
              ativo, observacoes, created_at, updated_at
       FROM nfse_portais ORDER BY nome`
    );
    // Nunca expor a senha no frontend — retorna apenas flag booleana
    return rows.map((r: any) => ({
      ...r,
      senhaConfigurada: !!(r.senhaConfigurada),
    }));
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await rawQuery(
        `SELECT id, nome, municipio, uf, url_portal, usuario_contador, ativo, observacoes, created_at, updated_at
         FROM nfse_portais WHERE id = ?`,
        [input.id]
      );
      if (!row) return null;
      return {
        ...row,
        senhaConfigurada: true, // se chegou aqui, existe
      };
    }),

  create: publicProcedure
    .input(z.object({
      nome: z.string().min(2),
      municipio: z.string().default("Vila Velha"),
      uf: z.string().length(2).default("ES"),
      urlPortal: z.string().optional(),
      usuarioContador: z.string().min(1),
      senhaContador: z.string().min(1),
      observacoes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const senhaCriptografada = encryptPassword(input.senhaContador);
      const result = await rawExec(
        `INSERT INTO nfse_portais (nome, municipio, uf, url_portal, usuario_contador, senha_contador, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.nome, input.municipio, input.uf,
          input.urlPortal || null,
          input.usuarioContador, senhaCriptografada,
          input.observacoes || null,
        ]
      );
      await auditLog(null, null, "portal_created", { nome: input.nome, municipio: input.municipio }, ctx.user?.name || "admin");
      return { id: result.insertId, success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().optional(),
      municipio: z.string().optional(),
      uf: z.string().optional(),
      urlPortal: z.string().optional(),
      usuarioContador: z.string().optional(),
      senhaContador: z.string().optional(),
      ativo: z.boolean().optional(),
      observacoes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fields: string[] = [];
      const values: any[] = [];

      if (input.nome !== undefined) { fields.push("nome = ?"); values.push(input.nome); }
      if (input.municipio !== undefined) { fields.push("municipio = ?"); values.push(input.municipio); }
      if (input.uf !== undefined) { fields.push("uf = ?"); values.push(input.uf); }
      if (input.urlPortal !== undefined) { fields.push("url_portal = ?"); values.push(input.urlPortal); }
      if (input.usuarioContador !== undefined) { fields.push("usuario_contador = ?"); values.push(input.usuarioContador); }
      if (input.senhaContador !== undefined) {
        fields.push("senha_contador = ?");
        values.push(encryptPassword(input.senhaContador));
      }
      if (input.ativo !== undefined) { fields.push("ativo = ?"); values.push(input.ativo ? 1 : 0); }
      if (input.observacoes !== undefined) { fields.push("observacoes = ?"); values.push(input.observacoes); }

      if (fields.length === 0) return { success: true };

      values.push(input.id);
      await rawExec(`UPDATE nfse_portais SET ${fields.join(", ")} WHERE id = ?`, values);
      await auditLog(null, null, "portal_updated", { id: input.id }, ctx.user?.name || "admin");
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await rawExec("UPDATE nfse_portais SET ativo = 0 WHERE id = ?", [input.id]);
      await auditLog(null, null, "portal_deleted", { id: input.id }, ctx.user?.name || "admin");
      return { success: true };
    }),

  // Retorna credenciais descriptografadas — uso EXCLUSIVO do motor de emissão (server-side)
  getCredentials: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await rawQuery(
        `SELECT id, nome, municipio, uf, url_portal, usuario_contador, senha_contador
         FROM nfse_portais WHERE id = ? AND ativo = 1`,
        [input.id]
      );
      if (!row) return null;
      return {
        id: (row as any).id,
        nome: (row as any).nome,
        municipio: (row as any).municipio,
        uf: (row as any).uf,
        urlPortal: (row as any).url_portal,
        usuarioContador: (row as any).usuario_contador,
        senhaContador: decryptPassword((row as any).senha_contador),
      };
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Config Router — Dados do prestador por empresa (sem credenciais)
// ══════════════════════════════════════════════════════════════════════

const configRouter = router({
  list: publicProcedure.query(async () => {
    return rawQuery(
      `SELECT c.id, c.cnpj, c.inscricaoMunicipal, c.razaoSocial, c.municipio, c.uf, c.regime,
              c.issRetido, c.listaServico, c.cnaePrincipal, c.descricaoPadrao, c.emailPadrao,
              c.ativo, c.portal_id, c.modo_auth, c.cert_tipo,
              p.nome as portalNome, p.municipio as portalMunicipio,
              c.createdAt, c.updatedAt
       FROM nfse_config c
       LEFT JOIN nfse_portais p ON p.id = c.portal_id
       ORDER BY c.razaoSocial`
    );
  }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await rawQuery(
        `SELECT c.*, p.nome as portalNome
         FROM nfse_config c
         LEFT JOIN nfse_portais p ON p.id = c.portal_id
         WHERE c.id = ?`,
        [input.id]
      );
      return row || null;
    }),

  create: publicProcedure
    .input(z.object({
      cnpj: z.string().min(11),
      inscricaoMunicipal: z.string().optional(),
      razaoSocial: z.string().min(2),
      portalId: z.number().optional(),
      municipio: z.string().default("Vila Velha"),
      uf: z.string().default("ES"),
      regime: z.string().default("Simples Nacional"),
      issRetido: z.boolean().default(false),
      listaServico: z.string().optional(),
      cnaePrincipal: z.string().optional(),
      descricaoPadrao: z.string().optional(),
      emailPadrao: z.string().optional(),
      modoAuth: z.enum(["login_contador", "certificado_digital"]).default("login_contador"),
      certTipo: z.enum(["A1", "A3"]).optional(),
      certA3Info: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await rawExec(
        `INSERT INTO nfse_config (cnpj, inscricaoMunicipal, razaoSocial, portal_id,
         municipio, uf, regime, issRetido, listaServico, cnaePrincipal, descricaoPadrao, emailPadrao,
         modo_auth, cert_tipo, cert_a3_info)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.cnpj.replace(/\D/g, ""), input.inscricaoMunicipal || null, input.razaoSocial,
          input.portalId || null,
          input.municipio, input.uf, input.regime, input.issRetido ? 1 : 0,
          input.listaServico || null, input.cnaePrincipal || null,
          input.descricaoPadrao || null, input.emailPadrao || null,
          input.modoAuth, input.certTipo || null, input.certA3Info || null,
        ]
      );
      await auditLog(null, result.insertId, "config_created", { razaoSocial: input.razaoSocial }, ctx.user?.name || "admin");
      return { id: result.insertId, success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      cnpj: z.string().optional(),
      inscricaoMunicipal: z.string().optional(),
      razaoSocial: z.string().optional(),
      portalId: z.number().nullable().optional(),
      municipio: z.string().optional(),
      uf: z.string().optional(),
      regime: z.string().optional(),
      issRetido: z.boolean().optional(),
      listaServico: z.string().optional(),
      cnaePrincipal: z.string().optional(),
      descricaoPadrao: z.string().optional(),
      emailPadrao: z.string().optional(),
      ativo: z.boolean().optional(),
      modoAuth: z.enum(["login_contador", "certificado_digital"]).optional(),
      certTipo: z.enum(["A1", "A3"]).nullable().optional(),
      certA3Info: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fields: string[] = [];
      const values: any[] = [];

      if (input.cnpj !== undefined) { fields.push("cnpj = ?"); values.push(input.cnpj.replace(/\D/g, "")); }
      if (input.inscricaoMunicipal !== undefined) { fields.push("inscricaoMunicipal = ?"); values.push(input.inscricaoMunicipal); }
      if (input.razaoSocial !== undefined) { fields.push("razaoSocial = ?"); values.push(input.razaoSocial); }
      if (input.portalId !== undefined) { fields.push("portal_id = ?"); values.push(input.portalId); }
      if (input.municipio !== undefined) { fields.push("municipio = ?"); values.push(input.municipio); }
      if (input.uf !== undefined) { fields.push("uf = ?"); values.push(input.uf); }
      if (input.regime !== undefined) { fields.push("regime = ?"); values.push(input.regime); }
      if (input.issRetido !== undefined) { fields.push("issRetido = ?"); values.push(input.issRetido ? 1 : 0); }
      if (input.listaServico !== undefined) { fields.push("listaServico = ?"); values.push(input.listaServico); }
      if (input.cnaePrincipal !== undefined) { fields.push("cnaePrincipal = ?"); values.push(input.cnaePrincipal); }
      if (input.descricaoPadrao !== undefined) { fields.push("descricaoPadrao = ?"); values.push(input.descricaoPadrao); }
      if (input.emailPadrao !== undefined) { fields.push("emailPadrao = ?"); values.push(input.emailPadrao); }
      if (input.ativo !== undefined) { fields.push("ativo = ?"); values.push(input.ativo ? 1 : 0); }
      if (input.modoAuth !== undefined) { fields.push("modo_auth = ?"); values.push(input.modoAuth); }
      if (input.certTipo !== undefined) { fields.push("cert_tipo = ?"); values.push(input.certTipo); }
      if (input.certA3Info !== undefined) { fields.push("cert_a3_info = ?"); values.push(input.certA3Info); }

      if (fields.length === 0) return { success: true };

      values.push(input.id);
      await rawExec(`UPDATE nfse_config SET ${fields.join(", ")} WHERE id = ?`, values);
      await auditLog(null, input.id, "config_updated", input, ctx.user?.name || "admin");
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await rawExec("UPDATE nfse_config SET ativo = 0 WHERE id = ?", [input.id]);
      await auditLog(null, input.id, "config_deleted", {}, ctx.user?.name || "admin");
      return { success: true };
    }),

  toggleAtivo: publicProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await rawExec("UPDATE nfse_config SET ativo = ? WHERE id = ?", [input.ativo ? 1 : 0, input.id]);
      await auditLog(null, input.id, "config_toggle_ativo", { ativo: input.ativo }, ctx.user?.name || "admin");
      return { success: true };
    }),

  // Upload de certificado A1 (.pfx/.p12)
  uploadCertificado: publicProcedure
    .input(z.object({
      configId: z.number(),
      certPfxUrl: z.string().url(),
      certSenha: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const senhaCriptografada = encryptPassword(input.certSenha);
      await rawExec(
        `UPDATE nfse_config SET cert_pfx_url = ?, cert_senha = ?, cert_tipo = 'A1', modo_auth = 'certificado_digital' WHERE id = ?`,
        [input.certPfxUrl, senhaCriptografada, input.configId]
      );
      await auditLog(null, input.configId, "certificado_uploaded", { tipo: "A1" }, ctx.user?.name || "admin");
      // Registrar também na auditoria centralizada
      await audit({
        userId: ctx.user?.id ?? null,
        userName: ctx.user?.name ?? ctx.user?.email ?? null,
        action: "upload_certificado",
        resource: "nfse_config",
        resourceId: String(input.configId),
        description: `Upload de certificado A1 para configId ${input.configId}`,
        newValue: { tipo: "A1", configId: input.configId },
        status: "success",
      });
      return { success: true };
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Tomadores Router — Cadastro de tomadores de serviço
// ══════════════════════════════════════════════════════════════════════

const tomadoresRouter = router({
  list: publicProcedure
    .input(z.object({
      configId: z.number().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let where = "WHERE t.ativo = 1";
      const params: any[] = [];

      if (input.configId) {
        where += " AND t.configId = ?";
        params.push(input.configId);
      }
      if (input.search) {
        where += " AND (t.nome LIKE ? OR t.cpfCnpj LIKE ?)";
        params.push(`%${input.search}%`, `%${input.search}%`);
      }

      return rawQuery(
        `SELECT t.*, c.razaoSocial as prestadorNome
         FROM nfse_tomadores t
         LEFT JOIN nfse_config c ON c.id = t.configId
         ${where}
         ORDER BY t.nome`,
        params
      );
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await rawQuery("SELECT * FROM nfse_tomadores WHERE id = ?", [input.id]);
      return row || null;
    }),

  create: publicProcedure
    .input(z.object({
      configId: z.number(),
      nome: z.string().min(2),
      cpfCnpj: z.string().min(11),
      endereco: z.string().optional(),
      cidade: z.string().optional(),
      estado: z.string().optional(),
      cep: z.string().optional(),
      email: z.string().optional(),
      telefone: z.string().optional(),
      observacao: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await rawExec(
        `INSERT INTO nfse_tomadores (configId, nome, cpfCnpj, endereco, cidade, estado, cep, email, telefone, observacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.configId, input.nome, input.cpfCnpj.replace(/\D/g, ""),
          input.endereco || null, input.cidade || null, input.estado || null,
          input.cep || null, input.email || null, input.telefone || null,
          input.observacao || null,
        ]
      );
      await auditLog(null, input.configId, "tomador_created", { nome: input.nome }, ctx.user?.name || "admin");
      return { id: result.insertId, success: true };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().optional(),
      cpfCnpj: z.string().optional(),
      endereco: z.string().optional(),
      cidade: z.string().optional(),
      estado: z.string().optional(),
      cep: z.string().optional(),
      email: z.string().optional(),
      telefone: z.string().optional(),
      observacao: z.string().optional(),
      ativo: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fields: string[] = [];
      const values: any[] = [];

      if (input.nome !== undefined) { fields.push("nome = ?"); values.push(input.nome); }
      if (input.cpfCnpj !== undefined) { fields.push("cpfCnpj = ?"); values.push(input.cpfCnpj.replace(/\D/g, "")); }
      if (input.endereco !== undefined) { fields.push("endereco = ?"); values.push(input.endereco); }
      if (input.cidade !== undefined) { fields.push("cidade = ?"); values.push(input.cidade); }
      if (input.estado !== undefined) { fields.push("estado = ?"); values.push(input.estado); }
      if (input.cep !== undefined) { fields.push("cep = ?"); values.push(input.cep); }
      if (input.email !== undefined) { fields.push("email = ?"); values.push(input.email); }
      if (input.telefone !== undefined) { fields.push("telefone = ?"); values.push(input.telefone); }
      if (input.observacao !== undefined) { fields.push("observacao = ?"); values.push(input.observacao); }
      if (input.ativo !== undefined) { fields.push("ativo = ?"); values.push(input.ativo ? 1 : 0); }

      if (fields.length === 0) return { success: true };

      values.push(input.id);
      await rawExec(`UPDATE nfse_tomadores SET ${fields.join(", ")} WHERE id = ?`, values);
      await auditLog(null, null, "tomador_updated", { id: input.id }, ctx.user?.name || "admin");
      return { success: true };
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Emissões Router — Gerenciamento de emissões de NFS-e
// ══════════════════════════════════════════════════════════════════════

const emissoesRouter = router({
  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      perPage: z.number().default(50),
      configId: z.number().optional(),
      status: z.string().optional(),
      competencia: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { page, perPage, configId, status, competencia, search } = input;
      const offset = (page - 1) * perPage;
      let where = "WHERE 1=1";
      const params: any[] = [];

      if (configId) { where += " AND e.configId = ?"; params.push(configId); }
      if (status) { where += " AND e.status = ?"; params.push(status); }
      if (competencia) { where += " AND e.competencia = ?"; params.push(competencia); }
      if (search) {
        where += " AND (e.tomadorNome LIKE ? OR e.numeroNfse LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      const rows = await rawQuery(
        `SELECT e.*, c.razaoSocial as prestadorNome, c.cnpj as prestadorCnpj,
                p.nome as portalNome
         FROM nfse_emissoes e
         LEFT JOIN nfse_config c ON c.id = e.configId
         LEFT JOIN nfse_portais p ON p.id = c.portal_id
         ${where}
         ORDER BY e.createdAt DESC
         LIMIT ${Number(perPage)} OFFSET ${Number(offset)}`,
        params
      );

      const [countRow] = await rawQuery(
        `SELECT COUNT(*) as total FROM nfse_emissoes e ${where}`,
        params
      );

      return {
        rows,
        total: (countRow as any).total,
        page,
        perPage,
      };
    }),

  get: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await rawQuery(
        `SELECT e.*, c.razaoSocial as prestadorNome, c.cnpj as prestadorCnpj,
                c.inscricaoMunicipal, c.listaServico, c.cnaePrincipal,
                p.nome as portalNome, p.municipio as portalMunicipio
         FROM nfse_emissoes e
         LEFT JOIN nfse_config c ON c.id = e.configId
         LEFT JOIN nfse_portais p ON p.id = c.portal_id
         WHERE e.id = ?`,
        [input.id]
      );
      return row || null;
    }),

  create: publicProcedure
    .input(z.object({
      configId: z.number(),
      tomadorId: z.number().optional(),
      tomadorNome: z.string().min(2),
      tomadorCpfCnpj: z.string().min(11),
      valor: z.number().positive(),
      competencia: z.string().regex(/^\d{2}\/\d{4}$/),
      descricaoServico: z.string().optional(),
      solicitadoVia: z.enum(["dashboard", "whatsapp", "manual", "api"]).default("dashboard"),
      whatsappPhone: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await rawExec(
        `INSERT INTO nfse_emissoes (configId, tomadorId, tomadorNome, tomadorCpfCnpj, valor,
         competencia, descricaoServico, status, solicitadoVia, whatsappPhone)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?)`,
        [
          input.configId, input.tomadorId || null,
          input.tomadorNome, input.tomadorCpfCnpj.replace(/\D/g, ""),
          input.valor, input.competencia,
          input.descricaoServico || null,
          input.solicitadoVia, input.whatsappPhone || null,
        ]
      );
      const solicitadoViaFinal = input.solicitadoVia;
      console.log(`[NfseCreate] solicitadoVia enviado: "${solicitadoViaFinal}" | configId: ${input.configId} | tomador: ${input.tomadorNome}`);
      await auditLog(result.insertId, input.configId, "emissao_created", {
        tomadorNome: input.tomadorNome,
        valor: input.valor,
        competencia: input.competencia,
        via: solicitadoViaFinal,
      }, ctx.user?.name || "admin");
      return { id: result.insertId, success: true };
    }),

  // Iniciar emissão (motor Playwright)
  emit: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const [emissao] = await rawQuery("SELECT * FROM nfse_emissoes WHERE id = ?", [input.id]);
      if (!emissao) throw new Error("Emissão não encontrada");

      await rawExec(
        "UPDATE nfse_emissoes SET status = 'em_processamento' WHERE id = ?",
        [input.id]
      );
      await auditLog(input.id, (emissao as any).configId, "emissao_started", {
        tomadorNome: (emissao as any).tomadorNome,
        valor: (emissao as any).valor,
      }, ctx.user?.name || "admin");

      // Dispara motor de emissão em background (não bloqueia)
      import("../services/nfseEmissionEngine").then(({ emitNfse }) => {
        emitNfse(input.id).catch(console.error);
      });

      return { success: true, message: "Emissão iniciada. Aguarde o processamento." };
    }),

  retry: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await rawExec(
        "UPDATE nfse_emissoes SET status = 'em_processamento', erroDetalhes = NULL WHERE id = ?",
        [input.id]
      );
      await auditLog(input.id, null, "emissao_retry", {}, ctx.user?.name || "admin");

      import("../services/nfseEmissionEngine").then(({ emitNfse }) => {
        emitNfse(input.id).catch(console.error);
      });

      return { success: true };
    }),

  cancel: publicProcedure
    .input(z.object({ id: z.number(), motivo: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      await rawExec(
        "UPDATE nfse_emissoes SET status = 'cancelada' WHERE id = ?",
        [input.id]
      );
      await auditLog(input.id, null, "emissao_cancelled", { motivo: input.motivo }, ctx.user?.name || "admin");
      return { success: true };
    }),

  // Cancela a nota no painel E no portal da prefeitura via Playwright (assíncrono)
  cancelarNaPrefeitura: publicProcedure
    .input(z.object({
      id: z.number(),
      justificativa: z.string().min(5, "Justificativa deve ter no mínimo 5 caracteres"),
    }))
    .mutation(async ({ input, ctx }) => {
      const [emissao] = await rawQuery(
        "SELECT id, status, numeroNf, configId, tomadorNome FROM nfse_emissoes WHERE id = ?",
        [input.id]
      );
      if (!emissao) throw new Error("Emissão não encontrada");
      const em = emissao as any;

      if (em.status !== "emitida") {
        throw new Error(`Só é possível cancelar notas com status "emitida". Status atual: ${em.status}`);
      }

      if (!em.numeroNf) throw new Error("Nota não possui número NF — não pode ser cancelada no portal");

      // Marcar como em_cancelamento e retornar imediatamente (evita timeout do nginx)
      await rawExec(
        "UPDATE nfse_emissoes SET status = 'em_cancelamento' WHERE id = ?",
        [input.id]
      );
      await auditLog(input.id, em.configId, "cancelamento_iniciado", {
        numeroNf: em.numeroNf, justificativa: input.justificativa,
      }, ctx.user?.name || "admin");

      // Executar cancelamento via Playwright em background (fire-and-forget)
      import("../services/nfseEmissionEngine").then(({ cancelNfse }) => {
        cancelNfse(input.id, input.justificativa).then(async (result) => {
          if (!result.success) {
            // Reverter para emitida em caso de erro (portal não cancelou)
            await rawExec("UPDATE nfse_emissoes SET status = 'emitida' WHERE id = ?", [input.id]);
            await auditLog(input.id, em.configId, "cancelamento_erro", { error: result.error }, "system");
            console.error(`[NfseCancel] Falha ao cancelar emissão ${input.id}:`, result.error);
          }
        }).catch(async (err) => {
          await rawExec("UPDATE nfse_emissoes SET status = 'emitida' WHERE id = ?", [input.id]);
          console.error(`[NfseCancel] Exceção ao cancelar emissão ${input.id}:`, err);
        });
      }).catch(console.error);

      return { success: true, numeroNf: em.numeroNf, message: "Cancelamento iniciado no portal da prefeitura. Aguarde alguns minutos." };
    }),

  downloadPdf: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const [row] = await rawQuery(
        "SELECT pdfUrl, numeroNfse FROM nfse_emissoes WHERE id = ?",
        [input.id]
      );
      if (!row || !(row as any).pdfUrl) return null;
      return { url: (row as any).pdfUrl, numeroNfse: (row as any).numeroNfse };
    }),

  // Métricas reais do mês atual
  metrics: publicProcedure
    .input(z.object({ competencia: z.string().optional() }))
    .query(async ({ input }) => {
      const now = new Date();
      const comp = input.competencia ||
        `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;

      // Totais por status no mês
      const [totais] = await rawQuery(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status = 'emitida' THEN 1 ELSE 0 END) as emitidas,
           SUM(CASE WHEN status = 'em_processamento' THEN 1 ELSE 0 END) as processando,
           SUM(CASE WHEN status = 'erro' THEN 1 ELSE 0 END) as erros,
           SUM(CASE WHEN status = 'rascunho' THEN 1 ELSE 0 END) as rascunhos,
           SUM(CASE WHEN status = 'cancelada' THEN 1 ELSE 0 END) as canceladas,
           COALESCE(SUM(CASE WHEN status = 'emitida' THEN valor ELSE 0 END), 0) as valorEmitido,
           COALESCE(SUM(valor), 0) as valorTotal
         FROM nfse_emissoes
         WHERE competencia = ?`,
        [comp]
      );

      // Breakdown por empresa no mês
      const porEmpresa = await rawQuery(
        `SELECT c.razaoSocial, c.cnpj,
                COUNT(*) as total,
                SUM(CASE WHEN e.status = 'emitida' THEN 1 ELSE 0 END) as emitidas,
                COALESCE(SUM(CASE WHEN e.status = 'emitida' THEN e.valor ELSE 0 END), 0) as valorEmitido
         FROM nfse_emissoes e
         LEFT JOIN nfse_config c ON c.id = e.configId
         WHERE e.competencia = ?
         GROUP BY e.configId, c.razaoSocial, c.cnpj
         ORDER BY valorEmitido DESC`,
        [comp]
      );

      // Histórico dos últimos 6 meses (contagem de emitidas)
      const historico = await rawQuery(
        `SELECT competencia,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'emitida' THEN 1 ELSE 0 END) as emitidas,
                COALESCE(SUM(CASE WHEN status = 'emitida' THEN valor ELSE 0 END), 0) as valorEmitido
         FROM nfse_emissoes
         WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
         GROUP BY competencia
         ORDER BY STR_TO_DATE(CONCAT('01/', competencia), '%d/%m/%Y') DESC
         LIMIT 6`
      );

      return {
        competencia: comp,
        totais: totais as any,
        porEmpresa,
        historico,
      };
    }),

  // Fila de processamento em tempo real
  fila: publicProcedure.query(async () => {
    const processando = await rawQuery(
      `SELECT e.id, e.configId, e.tomadorNome, e.valor, e.competencia,
              e.status, e.createdAt, e.processadoEm, e.erroDetalhes,
              c.razaoSocial as prestadorNome
       FROM nfse_emissoes e
       LEFT JOIN nfse_config c ON c.id = e.configId
       WHERE e.status IN ('em_processamento', 'em_cancelamento')
       ORDER BY e.createdAt DESC
       LIMIT 20`
    );

    const errosRecentes = await rawQuery(
      `SELECT e.id, e.configId, e.tomadorNome, e.valor, e.competencia,
              e.status, e.createdAt, e.erroDetalhes,
              c.razaoSocial as prestadorNome
       FROM nfse_emissoes e
       LEFT JOIN nfse_config c ON c.id = e.configId
       WHERE e.status = 'erro' AND e.createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY e.createdAt DESC
       LIMIT 10`
    );

    return { processando, errosRecentes };
  }),

  // Callbacks do motor de emissão (server-side only)
  markEmitida: publicProcedure
    .input(z.object({
      id: z.number(),
      numeroNfse: z.string(),
      serieNfse: z.string().optional(),
      pdfUrl: z.string().optional(),
      empresaSelecionadaLog: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await rawExec(
        `UPDATE nfse_emissoes SET status = 'emitida', numeroNfse = ?, serieNfse = ?,
         pdfUrl = ?, dataEmissao = NOW() WHERE id = ?`,
        [input.numeroNfse, input.serieNfse || null, input.pdfUrl || null, input.id]
      );
      await auditLog(input.id, null, "emissao_completed", {
        numeroNfse: input.numeroNfse,
        empresaSelecionada: input.empresaSelecionadaLog,
      }, "motor");
      return { success: true };
    }),

  markErro: publicProcedure
    .input(z.object({ id: z.number(), erro: z.string() }))
    .mutation(async ({ input }) => {
      await rawExec(
        "UPDATE nfse_emissoes SET status = 'erro', erroDetalhes = ? WHERE id = ?",
        [input.erro, input.id]
      );
      await auditLog(input.id, null, "emissao_error", { erro: input.erro }, "motor");
      return { success: true };
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Audit Router
// ══════════════════════════════════════════════════════════════════════

const nfseAuditRouter = router({
  list: publicProcedure
    .input(z.object({
      page: z.number().default(1),
      perPage: z.number().default(50),
      configId: z.number().optional(),
      emissaoId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const { page, perPage, configId, emissaoId } = input;
      const offset = (page - 1) * perPage;
      let where = "WHERE 1=1";
      const params: any[] = [];

      if (configId) { where += " AND a.configId = ?"; params.push(configId); }
      if (emissaoId) { where += " AND a.emissaoId = ?"; params.push(emissaoId); }

      const rows = await rawQuery(
        `SELECT a.* FROM nfse_audit a ${where} ORDER BY a.createdAt DESC LIMIT ${Number(perPage)} OFFSET ${Number(offset)}`,
        params
      );

      return rows;
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Session Router — Sessão persistente do portal (sem CAPTCHA)
// ══════════════════════════════════════════════════════════════════════

const nfseSessionRouter = router({
  // Retorna status da sessão ativa para um portal
  status: publicProcedure
    .input(z.object({ portalId: z.number() }))
    .query(async ({ input }) => {
      const { getSessionStatus } = await import("../services/nfseSessionService");
      return getSessionStatus(input.portalId);
    }),

  // Testa se a sessão atual ainda é válida (abre browser headless)
  test: publicProcedure
    .input(z.object({ portalId: z.number() }))
    .mutation(async ({ input }) => {
      const { testSession } = await import("../services/nfseSessionService");
      const result = await testSession(input.portalId);
      return result;
    }),

  // Captura sessão a partir de cookies exportados manualmente pelo usuário
  captureFromCookies: publicProcedure
    .input(z.object({
      portalId: z.number(),
      cookiesJson: z.string().min(2), // JSON array de cookies
      capturedBy: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { captureSessionFromCookies } = await import("../services/nfseSessionService");
      let cookies: any[];
      try {
        cookies = JSON.parse(input.cookiesJson);
        if (!Array.isArray(cookies)) throw new Error("Deve ser um array de cookies");
      } catch (e: any) {
        throw new Error(`JSON de cookies inválido: ${e.message}`);
      }
      const result = await captureSessionFromCookies(
        input.portalId,
        cookies,
        input.capturedBy || ctx.user?.name || "admin"
      );
      return result;
    }),

  // Invalida a sessão atual (força nova captura)
  invalidate: publicProcedure
    .input(z.object({ portalId: z.number() }))
    .mutation(async ({ input }) => {
      const rows = await rawQuery<any>(
        `SELECT id FROM nfse_sessions WHERE portal_id = ? AND is_valid = 1 ORDER BY captured_at DESC LIMIT 1`,
        [input.portalId]
      );
      if (rows.length) {
        const { invalidateSession } = await import("../services/nfseSessionService");
        await invalidateSession(rows[0].id);
      }
      return { success: true };
    }),

  // Lista histórico de sessões de um portal
  history: publicProcedure
    .input(z.object({ portalId: z.number() }))
    .query(async ({ input }) => {
      return rawQuery<any>(
        `SELECT id, captured_at, expires_at, captured_by, is_valid, last_test_ok, last_test_at, last_used_at
         FROM nfse_sessions WHERE portal_id = ? ORDER BY captured_at DESC LIMIT 20`,
        [input.portalId]
      );
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Diagnóstico Router — testes E2E do motor de emissão
// ══════════════════════════════════════════════════════════════════════

const nfseDiagRouter = router({
  // Diagnóstico do ambiente de sistema (OS, package managers, Chromium, libs)
  checkSystemEnv: publicProcedure
    .mutation(async () => {
      const { execSync } = await import("child_process");
      const run = (cmd: string) => { try { return execSync(cmd, { timeout: 5000 }).toString().trim(); } catch { return "N/A"; } };
      return {
        os: run("cat /etc/os-release | head -3"),
        whoami: run("whoami"),
        aptGet: run("which apt-get"),
        chromiumBin: run("ls /usr/bin/chrom* 2>/dev/null || echo none"),
        libglib: run("ldconfig -p 2>/dev/null | grep libglib | head -3 || echo none"),
        libnspr: run("ldconfig -p 2>/dev/null | grep libnspr | head -1 || echo none"),
        playwrightCache: run("ls ~/.cache/ms-playwright/ 2>/dev/null || echo none"),
        playwrightInstallResult: run("npx playwright install --with-deps chromium 2>&1 | tail -5"),
      };
    }),

  // Pré-check: Verificar se o runtime do Playwright está disponível
  checkPlaywrightRuntime: publicProcedure
    .mutation(async () => {
      const { checkPlaywrightRuntime } = await import("../services/nfsePlaywrightHealth");
      return checkPlaywrightRuntime();
    }),

  // Teste 1: Verificar se a sessão é válida e o portal está acessível
  testConnection: publicProcedure
    .input(z.object({ portalId: z.number() }))
    .mutation(async ({ input }) => {
      const { testPortalConnection } = await import("../services/nfseEmissionEngine");
      return testPortalConnection(input.portalId);
    }),

  // Teste 2: Verificar se consegue selecionar a empresa no portal
  testSelectEmpresa: publicProcedure
    .input(z.object({ portalId: z.number(), configId: z.number() }))
    .mutation(async ({ input }) => {
      const { testSelectEmpresa } = await import("../services/nfseEmissionEngine");
      return testSelectEmpresa(input.portalId, input.configId);
    }),

  // Emissão de teste: emite 1 NFS-e real com valor pequeno e retorna resultado completo
  emitirTeste: publicProcedure
    .input(z.object({
      configId: z.number(),
      tomadorNome: z.string(),
      tomadorCpfCnpj: z.string(),
      valor: z.number().default(10.00),
      competencia: z.string().default(() => {
        const now = new Date();
        return `${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
      }),
      descricao: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Criar emissão de teste no banco
      const result = await rawExec(
        `INSERT INTO nfse_emissoes
         (configId, tomadorNome, tomadorCpfCnpj, valor, competencia, descricaoServico,
          status, solicitadoVia, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, 'rascunho', 'dashboard', NOW())`,
        [
          input.configId,
          input.tomadorNome,
          input.tomadorCpfCnpj,
          input.valor,
          input.competencia,
          input.descricao || `[TESTE] Serviços de contabilidade - ${input.competencia}`,
        ]
      );

      const emissaoId = result.insertId;
      console.log(`[NfseTeste] emissao criada id=${emissaoId} | solicitadoVia="dashboard" | status="rascunho" | configId=${input.configId} | tomador=${input.tomadorNome}`);
      await auditLog(emissaoId, input.configId, "emissao_teste_started", {
        valor: input.valor,
        tomador: input.tomadorNome,
        solicitadoVia: "dashboard",
        status: "rascunho",
      }, ctx.user?.name || "admin");

      // Executar motor de emissão de forma SÍNCRONA (aguarda resultado)
      const { emitNfse } = await import("../services/nfseEmissionEngine");
      const emissaoResult = await emitNfse(emissaoId);

      return {
        emissaoId,
        success: emissaoResult.success,
        numeroNfse: emissaoResult.numeroNfse,
        serieNfse: emissaoResult.serieNfse,
        pdfUrl: emissaoResult.pdfUrl,
        logs: emissaoResult.logs,
        screenshotUrl: emissaoResult.screenshotUrl,
        error: emissaoResult.error,
      };
    }),

  // Salvar storageState capturado via Playwright (pelo frontend)
  saveStorageState: publicProcedure
    .input(z.object({
      portalId: z.number(),
      storageStateJson: z.string().min(2),
      capturedBy: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { saveStorageState } = await import("../services/nfseStorageState");
      let state: any;
      try {
        state = JSON.parse(input.storageStateJson);
        if (!state.cookies) throw new Error("storageState deve ter campo 'cookies'");
      } catch (e: any) {
        throw new Error(`JSON inválido: ${e.message}`);
      }
      await saveStorageState(
        input.portalId,
        state,
        input.capturedBy || ctx.user?.name || "admin"
      );
      return { success: true, cookieCount: state.cookies?.length || 0 };
    }),

  // Status da sessão usando o novo storageState service
  sessionStatus: publicProcedure
    .input(z.object({ portalId: z.number() }))
    .query(async ({ input }) => {
      const { getSessionStatus } = await import("../services/nfseStorageState");
      return getSessionStatus(input.portalId);
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Usuários Autorizados Router — telefones autorizados por empresa
// ══════════════════════════════════════════════════════════════════════

const usuariosAutorizadosRouter = router({
  list: publicProcedure
    .input(z.object({ configId: z.number().optional() }))
    .query(async ({ input }) => {
      try {
        if (input.configId !== undefined) {
          return rawQuery(
            `SELECT id, configId, nome, telefone, ativo, criado_em as created_at
             FROM nfse_usuarios_autorizados WHERE configId = ? ORDER BY nome`,
            [input.configId]
          );
        }
        return rawQuery(
          `SELECT id, configId, nome, telefone, ativo, criado_em as created_at
           FROM nfse_usuarios_autorizados ORDER BY nome`
        );
      } catch {
        // Fallback: colunas configId/nome podem não existir ainda (antes da migration)
        return rawQuery(
          `SELECT id, NULL as configId, '' as nome, telefone, ativo FROM nfse_usuarios_autorizados ORDER BY telefone`
        );
      }
    }),

  create: publicProcedure
    .input(z.object({
      configId: z.number(),
      nome: z.string().min(1),
      telefone: z.string().min(10),
    }))
    .mutation(async ({ input }) => {
      const telefone = input.telefone.replace(/\D/g, "");
      try {
        const result = await rawExec(
          `INSERT INTO nfse_usuarios_autorizados (configId, nome, telefone, ativo) VALUES (?, ?, ?, 1)`,
          [input.configId, input.nome, telefone]
        );
        return { id: result.insertId, success: true };
      } catch {
        // Fallback sem configId/nome
        const result = await rawExec(
          `INSERT INTO nfse_usuarios_autorizados (telefone, ativo) VALUES (?, 1)`,
          [telefone]
        );
        return { id: result.insertId, success: true };
      }
    }),

  toggle: publicProcedure
    .input(z.object({ id: z.number(), ativo: z.boolean() }))
    .mutation(async ({ input }) => {
      await rawExec(
        `UPDATE nfse_usuarios_autorizados SET ativo = ? WHERE id = ?`,
        [input.ativo ? 1 : 0, input.id]
      );
      return { success: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await rawExec(`DELETE FROM nfse_usuarios_autorizados WHERE id = ?`, [input.id]);
      return { success: true };
    }),
});

// ══════════════════════════════════════════════════════════════════════
// Main NFS-e Router
// ══════════════════════════════════════════════════════════════════════

export const nfseRouter = router({
  portais: portaisRouter,
  config: configRouter,
  tomadores: tomadoresRouter,
  emissoes: emissoesRouter,
  audit: nfseAuditRouter,
  session: nfseSessionRouter,
  diag: nfseDiagRouter,
  usuariosAutorizados: usuariosAutorizadosRouter,
});
