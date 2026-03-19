import * as mysql from "mysql2/promise";
import * as siegService from "../services/siegService";
import fs from "fs";

/**
 * Job de sincronização automática de certificados com SIEG
 *
 * Fluxo:
 * 1. Buscar certificados ativos válidos que ainda não foram enviados ao SIEG
 * 2. Separar os que têm arquivo no disco dos que não têm
 * 3. Marcar sem arquivo como error no banco
 * 4. Selecionar o primeiro COM arquivo como piloto
 * 5. Enviar piloto → se falhar, abortar
 * 6. Se piloto OK → enviar todos os demais COM arquivo
 * 7. Atualizar banco: sieg_status, sieg_id, sieg_sent_at, sieg_error
 *
 * Usa mysql2 diretamente (padrão do projeto) para evitar problemas com Drizzle ORM.
 */

function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function syncCertificatesToSieg() {
  const startTime = Date.now();
  console.log(`[SIEG_SYNC] Iniciando sincronização de certificados com SIEG`);

  const conn = await getConn();

  try {
    // 1. Buscar certificados candidatos
    const [certRows] = await conn.execute<mysql.RowDataPacket[]>(`
      SELECT id, cnpj, company_name, file_path, file_name, sieg_status, sieg_id, valid_to
      FROM certificates
      WHERE is_active = 1
        AND status = 'valid'
        AND valid_to > NOW()
        AND (sieg_status IS NULL OR sieg_status = 'pending' OR sieg_status = 'error')
      ORDER BY valid_to DESC
    `);

    console.log(`[SIEG_SYNC] Encontrados ${certRows.length} certificados candidatos`);

    if (certRows.length === 0) {
      await conn.end();
      return { success: true, message: "Nenhum certificado para sincronizar", stats: { total: 0, sent: 0, failed: 0 } };
    }

    // 2. Separar COM arquivo vs SEM arquivo
    const comArquivo: mysql.RowDataPacket[] = [];
    const semArquivo: mysql.RowDataPacket[] = [];

    for (const cert of certRows) {
      if (cert.file_path && fs.existsSync(cert.file_path)) {
        comArquivo.push(cert);
      } else {
        semArquivo.push(cert);
      }
    }

    console.log(`[SIEG_SYNC] Com arquivo: ${comArquivo.length} | Sem arquivo: ${semArquivo.length}`);

    // 3. Marcar sem arquivo como error
    for (const cert of semArquivo) {
      const errMsg = `Arquivo não encontrado: ${cert.file_path || cert.file_name}`;
      await conn.execute(
        `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
        [errMsg.substring(0, 255), cert.id]
      );
      console.warn(`[SIEG_SYNC] ⚠️ Sem arquivo: ${cert.cnpj} → ${cert.file_path || cert.file_name}`);
    }

    if (comArquivo.length === 0) {
      await conn.end();
      return {
        success: false,
        message: `Nenhum certificado com arquivo disponível. ${semArquivo.length} marcados como error.`,
        stats: { total: certRows.length, sent: 0, failed: semArquivo.length }
      };
    }

    // 4. Selecionar piloto (primeiro com arquivo)
    const pilotCert = comArquivo[0];
    const pilotLabel = pilotCert.company_name || pilotCert.file_name || pilotCert.cnpj;
    console.log(`[SIEG_SYNC_PILOT] Testando piloto: ${pilotCert.cnpj} (${pilotLabel})`);
    console.log(`[SIEG_SYNC_PILOT] Arquivo piloto: ${pilotCert.file_path}`);

    // Ler arquivo do piloto
    let pfxBuffer: Buffer;
    try {
      pfxBuffer = fs.readFileSync(pilotCert.file_path);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await conn.execute(
        `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
        [`Erro ao ler arquivo: ${errMsg}`.substring(0, 255), pilotCert.id]
      );
      await conn.end();
      return { success: false, message: `Erro ao ler arquivo piloto: ${errMsg}`, stats: { total: certRows.length, sent: 0, failed: 1 } };
    }

    const password = process.env.CERT_PASSWORD_DEFAULT || "Fraga@123";

    // 5. Enviar piloto
    const pilotResult = await siegService.uploadCertificadoSieg(
      pilotCert.cnpj,
      pilotLabel,
      pfxBuffer,
      password
    );

    console.log(`[SIEG_SYNC_PILOT] Resultado: success=${pilotResult.success} | siegId=${pilotResult.siegId || 'N/A'} | error=${pilotResult.error || 'N/A'}`);

    if (!pilotResult.success) {
      console.error(`[SIEG_SYNC_PILOT] Piloto falhou: ${pilotResult.error}`);
      await conn.execute(
        `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
        [(pilotResult.error || "Erro desconhecido").substring(0, 255), pilotCert.id]
      );
      await conn.end();
      return {
        success: false,
        message: `Piloto falhou: ${pilotResult.error}`,
        stats: { total: certRows.length, sent: 0, failed: 1 + semArquivo.length }
      };
    }

    // Atualizar piloto com sucesso
    const pilotSiegId = (pilotResult.siegId && String(pilotResult.siegId).trim()) || null;
    await conn.execute(
      `UPDATE certificates SET sieg_status = 'sent', sieg_id = ?, sieg_sent_at = NOW(), sieg_error = NULL WHERE id = ?`,
      [pilotSiegId, pilotCert.id]
    );
    console.log(`[SIEG_SYNC_PILOT] ✅ Piloto enviado com sucesso. SIEG ID: ${pilotSiegId || 'N/A'}`);

    // 6. Enviar todos os demais COM arquivo
    let sent = 1;
    let failed = semArquivo.length;
    const errors: Array<{ cnpj: string; error: string }> = [];

    for (let i = 1; i < comArquivo.length; i++) {
      const cert = comArquivo[i];
      const certLabel = cert.company_name || cert.file_name || cert.cnpj;
      console.log(`[SIEG_SYNC] Enviando ${i + 1}/${comArquivo.length}: ${cert.cnpj}`);

      let certPfxBuffer: Buffer;
      try {
        certPfxBuffer = fs.readFileSync(cert.file_path);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await conn.execute(
          `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
          [`Erro ao ler arquivo: ${errMsg}`.substring(0, 255), cert.id]
        );
        failed++;
        errors.push({ cnpj: cert.cnpj, error: `Erro ao ler arquivo: ${errMsg}` });
        continue;
      }

      const result = await siegService.uploadCertificadoSieg(cert.cnpj, certLabel, certPfxBuffer, password);

      if (result.success) {
        const certSiegId = (result.siegId && String(result.siegId).trim()) || null;
        await conn.execute(
          `UPDATE certificates SET sieg_status = 'sent', sieg_id = ?, sieg_sent_at = NOW(), sieg_error = NULL WHERE id = ?`,
          [certSiegId, cert.id]
        );
        sent++;
        console.log(`[SIEG_SYNC] ✅ Enviado: ${cert.cnpj} | SIEG ID: ${certSiegId || 'N/A'}`);
      } else {
        await conn.execute(
          `UPDATE certificates SET sieg_status = 'error', sieg_error = ? WHERE id = ?`,
          [(result.error || "Erro desconhecido").substring(0, 255), cert.id]
        );
        failed++;
        errors.push({ cnpj: cert.cnpj, error: result.error || "Erro desconhecido" });
        console.error(`[SIEG_SYNC] ❌ Erro: ${cert.cnpj} - ${result.error}`);
      }

      // Intervalo de 200ms entre envios
      await new Promise(r => setTimeout(r, 200));
    }

    const durationMs = Date.now() - startTime;
    console.log(`[SIEG_SYNC] Concluído em ${durationMs}ms. Enviados: ${sent}, Falhados: ${failed}`);

    await conn.end();

    return {
      success: true,
      message: `Sincronização concluída: ${sent} enviados, ${failed} falhados (${semArquivo.length} sem arquivo)`,
      stats: {
        total: certRows.length,
        comArquivo: comArquivo.length,
        semArquivo: semArquivo.length,
        sent,
        failed,
        errors: errors.slice(0, 10),
        durationMs,
        pilot: {
          cnpj: pilotCert.cnpj,
          label: pilotLabel,
          siegId: pilotSiegId,
        }
      }
    };
  } catch (error) {
    console.error(`[SIEG_SYNC] Erro fatal:`, error);
    try { await conn.end(); } catch {}
    return { success: false, message: `Erro fatal: ${error}`, stats: { total: 0, sent: 0, failed: 0 } };
  }
}
