import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface ImportResult {
  success: boolean;
  totalProcessed: number;
  created: number;
  failed: number;
  errors: Array<{ row: number; name: string; error: string }>;
}

export async function importClientsToContaAzul(): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    totalProcessed: 0,
    created: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Read Cliente(1).csv
    const csvPath = path.join('/home/ubuntu/upload', 'Cliente(1).csv');
    
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found: ${csvPath}`);
    }

    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());

    // Skip header (first line)
    const dataLines = lines.slice(1);

    console.log(`[ImportClients] Starting import of ${dataLines.length} clients`);

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      const parts = line.split(',').map(p => p.trim().replace(/^"(.*)"$/, '$1'));

      // CSV structure: nome, razao_social, cnpj, cpf, ...
      const nome = parts[0];
      const razaoSocial = parts[1];
      const cnpj = parts[2];
      const cpf = parts[3];
      const email = parts[10]; // Email principal
      const telefone = parts[11]; // Telefone principal

      if (!nome) {
        result.errors.push({ row: i + 2, name: 'UNKNOWN', error: 'Nome vazio' });
        result.failed++;
        continue;
      }

      try {
        // Determine tipo (PJ if CNPJ exists, PF if CPF exists)
        const tipo = cnpj && cnpj.length > 0 ? 'Jurídica' : cpf && cpf.length > 0 ? 'Física' : 'Jurídica';
        const documento = cnpj || cpf;

        // Build payload for Conta Azul
        const payload: any = {
          nome: razaoSocial || nome,
          tipo,
        };

        // Add optional fields
        if (documento) {
          payload.documento = documento;
        }
        if (email) {
          payload.emails = [{ email, principal: true }];
        }
        if (telefone) {
          payload.telefones = [{ telefone, principal: true }];
        }

        // Add perfil (Cliente)
        payload.perfis = ['Cliente'];

        console.log(`[ImportClients] Creating person ${i + 1}/${dataLines.length}: ${nome}`);

        // Call Conta Azul API
        const response = await axios.post(
          'https://api-v2.contaazul.com/v1/pessoas',
          payload,
          {
            headers: {
              Authorization: `Bearer ${process.env.CONTA_AZUL_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.status === 201 || response.status === 200) {
          result.created++;
          console.log(`[ImportClients] Created: ${nome} (uuid: ${response.data.uuid})`);
        }
      } catch (error: any) {
        const errorMsg = error.response?.data?.message || error.message;
        console.log(`[ImportClients] Error creating ${nome}: ${errorMsg}`);
        result.errors.push({ row: i + 2, name: nome, error: errorMsg });
        result.failed++;
      }

      result.totalProcessed++;
    }

    result.success = result.created > 0;
    console.log(`[ImportClients] Import complete: ${result.created} created, ${result.failed} failed`);

    return result;
  } catch (error: any) {
    console.error('[ImportClients] Fatal error:', error.message);
    result.errors.push({ row: 0, name: 'SYSTEM', error: error.message });
    return result;
  }
}
