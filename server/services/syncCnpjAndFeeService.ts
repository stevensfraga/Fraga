/**
 * Sync CNPJ from Conta Azul API → clients.document
 * Then cross-reference with ekontrol_companies.inscricao_federal
 * to link client_id and fill honorarios_atual from recurring receivables.
 */
import mysql from "mysql2/promise";

async function getConnection() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

async function rawQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute(sql, params);
    return rows as T[];
  } finally {
    await conn.end();
  }
}

async function rawExec(sql: string, params: any[] = []): Promise<any> {
  const conn = await getConnection();
  try {
    const [result] = await conn.execute(sql, params);
    return result;
  } finally {
    await conn.end();
  }
}

// ============================================================
// Step 1: Fetch CNPJ from Conta Azul API for all clients
// ============================================================

async function getValidToken(): Promise<string> {
  const conn = await getConnection();
  try {
    const [tokens] = await conn.execute(
      "SELECT * FROM contaAzulTokens ORDER BY id DESC LIMIT 1"
    ) as any;
    if (!tokens.length) throw new Error("No Conta Azul token found");

    const token = tokens[0];
    const expiresAt = new Date(token.expiresAt);

    // If token is still valid (with 5 min buffer)
    if (expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return token.accessToken;
    }

    // Try to refresh
    const clientId = process.env.CONTA_AZUL_CLIENT_ID;
    const clientSecret = process.env.CONTA_AZUL_CLIENT_SECRET;
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const res = await fetch("https://api.contaazul.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status}`);
    }

    const data = await res.json();
    await conn.execute(
      "UPDATE contaAzulTokens SET accessToken = ?, refreshToken = ?, expiresAt = ? WHERE id = ?",
      [
        data.access_token,
        data.refresh_token,
        new Date(Date.now() + data.expires_in * 1000),
        token.id,
      ]
    );

    return data.access_token;
  } finally {
    await conn.end();
  }
}

export async function syncCnpjFromContaAzul(): Promise<{
  total: number;
  fetched: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let fetched = 0;
  let updated = 0;

  // Get clients that have contaAzulPersonId but no document
  const clients = await rawQuery<{
    id: number;
    name: string;
    contaAzulPersonId: string;
    document: string | null;
  }>(
    `SELECT id, name, contaAzulPersonId, document
     FROM clients
     WHERE contaAzulPersonId IS NOT NULL 
       AND contaAzulPersonId != ''`
  );

  const total = clients.length;
  if (total === 0) return { total: 0, fetched: 0, updated: 0, errors: [] };

  let accessToken: string;
  try {
    accessToken = await getValidToken();
  } catch (e: any) {
    return { total, fetched: 0, updated: 0, errors: [e.message] };
  }

  const apiBase = process.env.CONTA_AZUL_API_BASE || "https://api-v2.contaazul.com/v1";

  for (const client of clients) {
    try {
      // Skip if already has document
      if (client.document && client.document.length >= 11) {
        fetched++;
        continue;
      }

      const res = await fetch(`${apiBase}/pessoas/${client.contaAzulPersonId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 429) {
        // Rate limited, wait and retry
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!res.ok) {
        if (res.status === 404) {
          // Person not found in CA, skip
          continue;
        }
        errors.push(`${client.name}: API ${res.status}`);
        continue;
      }

      const data = await res.json();
      const documento = (data.documento || "").replace(/\D/g, "");

      if (documento && documento.length >= 11) {
        await rawExec(
          "UPDATE clients SET document = ? WHERE id = ?",
          [documento, client.id]
        );
        updated++;
      }
      fetched++;

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 100));
    } catch (e: any) {
      errors.push(`${client.name}: ${e.message}`);
    }
  }

  return { total, fetched, updated, errors };
}

// ============================================================
// Step 2: Match clients → ekontrol_companies via CNPJ
// ============================================================

export async function matchClientsByDocument(): Promise<{
  matched: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let matched = 0;

  try {
    // Match by exact CNPJ (document limpo)
    const result = await rawExec(
      `UPDATE ekontrol_companies ek
       INNER JOIN clients c ON REPLACE(REPLACE(REPLACE(c.document, '.', ''), '/', ''), '-', '') = ek.inscricao_federal
       SET ek.client_id = c.id
       WHERE c.document IS NOT NULL 
         AND c.document != ''
         AND LENGTH(REPLACE(REPLACE(REPLACE(c.document, '.', ''), '/', ''), '-', '')) >= 11`
    );
    matched = result.affectedRows || 0;
  } catch (e: any) {
    errors.push(`Match CNPJ: ${e.message}`);
  }

  // Also try matching by name for clients without document
  try {
    const result2 = await rawExec(
      `UPDATE ekontrol_companies ek
       INNER JOIN clients c ON UPPER(TRIM(c.name)) = UPPER(TRIM(ek.razao_social))
       SET ek.client_id = c.id
       WHERE ek.client_id IS NULL
         AND ek.status_empresa = 'A'`
    );
    matched += result2.affectedRows || 0;
  } catch (e: any) {
    errors.push(`Match nome exato: ${e.message}`);
  }

  // Partial name match (client name contained in razao_social or vice versa)
  try {
    const result3 = await rawExec(
      `UPDATE ekontrol_companies ek
       INNER JOIN clients c ON (
         UPPER(TRIM(ek.razao_social)) LIKE CONCAT(UPPER(TRIM(c.name)), '%')
         OR UPPER(TRIM(c.name)) LIKE CONCAT(UPPER(TRIM(ek.razao_social)), '%')
       )
       SET ek.client_id = c.id
       WHERE ek.client_id IS NULL
         AND ek.status_empresa = 'A'
         AND LENGTH(c.name) > 8`
    );
    matched += result3.affectedRows || 0;
  } catch (e: any) {
    errors.push(`Match nome parcial: ${e.message}`);
  }

  return { matched, errors };
}

// ============================================================
// Step 3: Detect recurring fee from receivables and fill honorarios_atual
// ============================================================

export async function fillHonorariosFromReceivables(): Promise<{
  detected: number;
  updated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let detected = 0;
  let updated = 0;

  try {
    // Find recurring receivable amounts per client (3+ occurrences in last 6 months)
    // Pick the highest-occurrence amount as the "honorário" for each client
    const recurrents = await rawQuery<{
      clientId: number;
      clientName: string;
      amount: string;
      occurrences: number;
    }>(
      `SELECT r.clientId, c.name as clientName,
              CAST(r.amount AS DECIMAL(10,2)) as amount, 
              COUNT(*) as occurrences
       FROM receivables r
       INNER JOIN clients c ON c.id = r.clientId
       WHERE r.dueDate >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
         AND r.status IN ('paid', 'overdue', 'pending')
         AND r.amount > 0
       GROUP BY r.clientId, r.amount
       HAVING COUNT(*) >= 3
       ORDER BY r.clientId, occurrences DESC`
    );

    // Group by clientId, keep the one with most occurrences
    const clientFees = new Map<
      number,
      { amount: number; occurrences: number; clientName: string }
    >();
    for (const row of recurrents) {
      const existing = clientFees.get(row.clientId);
      if (!existing || row.occurrences > existing.occurrences) {
        clientFees.set(row.clientId, {
          amount: parseFloat(row.amount),
          occurrences: row.occurrences,
          clientName: row.clientName,
        });
      }
    }

    detected = clientFees.size;

    // Update ekontrol_companies with the detected fee
    for (const [clientId, data] of Array.from(clientFees.entries())) {
      try {
        // Update ALL ekontrol_companies linked to this client (even if they already have honorarios)
        // The receivable amount from Conta Azul is the REAL fee being charged
        const result = await rawExec(
          `UPDATE ekontrol_companies 
           SET honorarios_atual = ?,
               honorarios_fonte = 'conta_azul_receivables'
           WHERE client_id = ?`,
          [data.amount, clientId]
        );

        if (result.affectedRows > 0) {
          updated++;
        } else {
          // Try to match by name if client_id not linked
          const result2 = await rawExec(
            `UPDATE ekontrol_companies 
             SET honorarios_atual = ?,
                 honorarios_fonte = 'conta_azul_receivables'
             WHERE UPPER(TRIM(razao_social)) LIKE CONCAT(UPPER(TRIM(?)), '%')
               AND status_empresa = 'A'
               AND (honorarios_atual IS NULL OR honorarios_atual = 0 OR honorarios_fonte != 'ekontrol')`,
            [data.amount, data.clientName]
          );
          if (result2.affectedRows > 0) updated++;
        }
      } catch (e: any) {
        errors.push(`Client ${clientId} (${data.clientName}): ${e.message}`);
      }
    }

    // Also update pricing_current with the new fee_atual
    try {
      await rawExec(
        `UPDATE pricing_current pc
         INNER JOIN ekontrol_companies ek ON pc.ek_company_id = ek.id
         SET pc.fee_atual = ek.honorarios_atual
         WHERE ek.honorarios_atual IS NOT NULL 
           AND ek.honorarios_atual > 0
           AND ek.honorarios_fonte = 'conta_azul_receivables'`
      );
    } catch (e: any) {
      errors.push(`Update pricing_current: ${e.message}`);
    }
  } catch (e: any) {
    errors.push(`fillHonorariosFromReceivables: ${e.message}`);
  }

  return { detected, updated, errors };
}

// ============================================================
// Full pipeline: sync CNPJ → match → fill fees
// ============================================================

export async function runFullCnpjAndFeePipeline(): Promise<{
  cnpjSync: { total: number; fetched: number; updated: number; errors: string[] };
  match: { matched: number; errors: string[] };
  fees: { detected: number; updated: number; errors: string[] };
}> {
  console.log("[CNPJ+Fee Pipeline] Starting...");

  // Step 1: Sync CNPJ from Conta Azul
  console.log("[CNPJ+Fee Pipeline] Step 1: Syncing CNPJ from Conta Azul API...");
  const cnpjSync = await syncCnpjFromContaAzul();
  console.log(`[CNPJ+Fee Pipeline] CNPJ sync: ${cnpjSync.updated} updated of ${cnpjSync.total} clients`);

  // Step 2: Match clients to ekontrol companies
  console.log("[CNPJ+Fee Pipeline] Step 2: Matching clients by CNPJ/name...");
  const match = await matchClientsByDocument();
  console.log(`[CNPJ+Fee Pipeline] Matched: ${match.matched} companies`);

  // Step 3: Fill honorarios from receivables
  console.log("[CNPJ+Fee Pipeline] Step 3: Filling honorários from receivables...");
  const fees = await fillHonorariosFromReceivables();
  console.log(`[CNPJ+Fee Pipeline] Fees: ${fees.detected} detected, ${fees.updated} updated`);

  console.log("[CNPJ+Fee Pipeline] Complete.");
  return { cnpjSync, match, fees };
}
