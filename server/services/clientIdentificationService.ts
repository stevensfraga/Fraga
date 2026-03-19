import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL || "";

/**
 * Serviço de identificação de cliente
 * Prioridade: telefone → CNPJ → nome da empresa → manual
 */

export interface ClientIdentificationResult {
  success: boolean;
  companyId?: number;
  cnpj?: string;
  companyName?: string;
  identificationMethod: "by_phone" | "by_cnpj" | "by_company_name" | "manual_fallback" | "not_found";
  phoneNormalized?: string;
  message?: string;
  confidence?: number; // 0-100
}

/**
 * Normalizar número de telefone para formato padrão
 * Entrada: +55 11 98765-4321, 11987654321, (11) 98765-4321, etc.
 * Saída: +5511987654321
 */
export function normalizePhoneNumber(phone: string): string | null {
  if (!phone) return null;

  // Remover caracteres especiais
  let normalized = phone.replace(/[^\d+]/g, "");

  // Se não começar com +, adicionar +55
  if (!normalized.startsWith("+")) {
    normalized = "+55" + normalized;
  }

  // Remover + temporariamente para contar dígitos
  const digitsOnly = normalized.replace(/\D/g, "");

  // Validar: deve ter 13 dígitos (55 + 11 dígitos) ou 12 dígitos (sem o 55)
  if (digitsOnly.length === 13 && digitsOnly.startsWith("55")) {
    // Já está com código de país
    return "+" + digitsOnly;
  } else if (digitsOnly.length === 11) {
    // Faltava código de país
    return "+55" + digitsOnly;
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith("55")) {
    // Tem 55 mas faltam dígitos
    return null;
  }

  return null;
}

/**
 * Buscar cliente por telefone normalizado
 */
export async function findClientByPhone(phoneNormalized: string): Promise<ClientIdentificationResult> {
  try {
    const connection = await mysql.createConnection(DATABASE_URL);

    // Procurar na tabela de contatos (assumindo que existe uma tabela de contatos/telefones)
    const [contacts] = await connection.execute(
      `SELECT c.id, c.cnpj, c.company_name, c.company_id 
       FROM contacts c 
       WHERE c.phone_normalized = ? OR c.phone = ? 
       LIMIT 1`,
      [phoneNormalized, phoneNormalized.replace("+", "")]
    );

    await connection.end();

    if ((contacts as any).length > 0) {
      const contact = (contacts as any)[0];
      return {
        success: true,
        companyId: contact.company_id,
        cnpj: contact.cnpj,
        companyName: contact.company_name,
        identificationMethod: "by_phone",
        phoneNormalized,
        message: `Cliente identificado pelo telefone: ${contact.company_name}`,
        confidence: 95,
      };
    }

    return {
      success: false,
      identificationMethod: "not_found",
      phoneNormalized,
      message: "Nenhum cliente encontrado com este telefone",
      confidence: 0,
    };
  } catch (error) {
    console.error("[ClientIdentification] Erro ao buscar por telefone:", error);
    return {
      success: false,
      identificationMethod: "not_found",
      message: `Erro ao buscar cliente: ${error instanceof Error ? error.message : "desconhecido"}`,
      confidence: 0,
    };
  }
}

/**
 * Buscar cliente por CNPJ
 */
export async function findClientByCnpj(cnpj: string): Promise<ClientIdentificationResult> {
  try {
    const connection = await mysql.createConnection(DATABASE_URL);

    // Normalizar CNPJ (remover caracteres especiais)
    const cnpjNormalized = cnpj.replace(/[^\d]/g, "");

    const [companies] = await connection.execute(
      `SELECT id, cnpj, company_name FROM companies WHERE cnpj = ? LIMIT 1`,
      [cnpjNormalized]
    );

    await connection.end();

    if ((companies as any).length > 0) {
      const company = (companies as any)[0];
      return {
        success: true,
        companyId: company.id,
        cnpj: company.cnpj,
        companyName: company.company_name,
        identificationMethod: "by_cnpj",
        message: `Cliente identificado pelo CNPJ: ${company.company_name}`,
        confidence: 90,
      };
    }

    return {
      success: false,
      identificationMethod: "not_found",
      message: "Nenhuma empresa encontrada com este CNPJ",
      confidence: 0,
    };
  } catch (error) {
    console.error("[ClientIdentification] Erro ao buscar por CNPJ:", error);
    return {
      success: false,
      identificationMethod: "not_found",
      message: `Erro ao buscar empresa: ${error instanceof Error ? error.message : "desconhecido"}`,
      confidence: 0,
    };
  }
}

/**
 * Buscar cliente por nome da empresa
 */
export async function findClientByCompanyName(companyName: string): Promise<ClientIdentificationResult> {
  try {
    const connection = await mysql.createConnection(DATABASE_URL);

    const [companies] = await connection.execute(
      `SELECT id, cnpj, company_name FROM companies WHERE company_name LIKE ? LIMIT 1`,
      [`%${companyName}%`]
    );

    await connection.end();

    if ((companies as any).length > 0) {
      const company = (companies as any)[0];
      return {
        success: true,
        companyId: company.id,
        cnpj: company.cnpj,
        companyName: company.company_name,
        identificationMethod: "by_company_name",
        message: `Cliente identificado pelo nome: ${company.company_name}`,
        confidence: 70,
      };
    }

    return {
      success: false,
      identificationMethod: "not_found",
      message: "Nenhuma empresa encontrada com este nome",
      confidence: 0,
    };
  } catch (error) {
    console.error("[ClientIdentification] Erro ao buscar por nome:", error);
    return {
      success: false,
      identificationMethod: "not_found",
      message: `Erro ao buscar empresa: ${error instanceof Error ? error.message : "desconhecido"}`,
      confidence: 0,
    };
  }
}

/**
 * Identificar cliente com fallback automático
 * Prioridade: telefone → CNPJ → nome → manual
 */
export async function identifyClientWithFallback(
  phoneE164?: string,
  cnpj?: string,
  companyName?: string
): Promise<ClientIdentificationResult> {
  // 1. Tentar por telefone
  if (phoneE164) {
    const normalized = normalizePhoneNumber(phoneE164);
    if (normalized) {
      const result = await findClientByPhone(normalized);
      if (result.success) {
        return result;
      }
    }
  }

  // 2. Tentar por CNPJ
  if (cnpj) {
    const result = await findClientByCnpj(cnpj);
    if (result.success) {
      return result;
    }
  }

  // 3. Tentar por nome
  if (companyName) {
    const result = await findClientByCompanyName(companyName);
    if (result.success) {
      return result;
    }
  }

  // 4. Fallback manual
  return {
    success: false,
    identificationMethod: "manual_fallback",
    message: "Cliente não identificado automaticamente. Será necessário informar o CNPJ manualmente.",
    confidence: 0,
  };
}

/**
 * Log de identificação para auditoria
 */
export async function logClientIdentification(
  ticketId: string,
  phoneE164: string,
  identificationResult: ClientIdentificationResult
): Promise<void> {
  try {
    const connection = await mysql.createConnection(DATABASE_URL);

    await connection.execute(
      `INSERT INTO client_identification_logs (
        ticket_id, phone_e164, identification_method, 
        company_id, cnpj, company_name, confidence, 
        message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        ticketId,
        phoneE164,
        identificationResult.identificationMethod,
        identificationResult.companyId || null,
        identificationResult.cnpj || null,
        identificationResult.companyName || null,
        identificationResult.confidence || 0,
        identificationResult.message || null,
      ]
    );

    await connection.end();

    console.log(
      `[ClientIdentification] Log criado: ${ticketId} - ${identificationResult.identificationMethod} (${identificationResult.confidence}%)`
    );
  } catch (error) {
    console.error("[ClientIdentification] Erro ao salvar log:", error);
  }
}
