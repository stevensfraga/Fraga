/**
 * TAREFA A - Criar Pessoa com Logs Detalhados
 * Testa diferentes nomes de campo e valores enum
 */

import axios from 'axios';
import { getValidAccessToken } from '../contaAzulOAuthManager';

interface CreatePersonResult {
  attempt: number;
  fieldName: string;
  fieldValue: string;
  httpStatus?: number;
  success: boolean;
  uuid?: string;
  payloadSent?: any;
  errorBody?: any;
  errorMessage?: string;
  requestUrl?: string;
}

/**
 * Testar criação com diferentes nomes de campo
 */
export async function testCreatePersonWithFieldName(
  fieldName: string,
  fieldValue: string,
  name: string = 'CLIENTE TESTE FRAGA',
  email: string = 'contato+teste@fraga.com.br',
  extraPayload: any = {}
): Promise<CreatePersonResult> {
  try {
    const accessToken = await getValidAccessToken();

    // Montar payload com nome do campo testado
    const payload: any = {
      nome: name,
      email: email,
      ...extraPayload,
    };
    payload[fieldName] = fieldValue;

    console.log(`[PeopleCreate] Tentativa: fieldName=${fieldName} fieldValue=${fieldValue}`);
    console.log(`[PeopleCreate] payload_raw = ${JSON.stringify(payload)}`);
    console.log(`[PeopleCreate] headers = { content-type: application/json, accept: application/json, authorizationSuffix: ...Bearer }`);

    // Enviar para Conta Azul
    const response = await axios.post(
      'https://api-v2.contaazul.com/v1/pessoas',
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    const person = response.data?.data || response.data;
    const uuid = person?.id;

    console.log(`[PeopleCreate] SUCCESS httpStatus=${response.status} uuid=${uuid}`);

    return {
      attempt: 1,
      fieldName,
      fieldValue,
      httpStatus: response.status,
      success: true,
      uuid,
      payloadSent: payload,
    };
  } catch (error: any) {
    const status = error.response?.status;
    const errorBody = error.response?.data;
    const requestUrl = 'https://api-v2.contaazul.com/v1/pessoas';

    console.log(`[PeopleCreate] ❌ ERRO CAPTURADO`);
    console.log(`[PeopleCreate] requestUrl = ${requestUrl}`);
    console.log(`[PeopleCreate] error_status = ${status}`);
    console.log(`[PeopleCreate] error_body = ${JSON.stringify(errorBody)}`);
    console.log(`[PeopleCreate] error_message = ${error?.message}`);
    console.error(`[PeopleCreate] ERROR: ${error?.message}`);

    return {
      attempt: 1,
      fieldName,
      fieldValue,
      httpStatus: status,
      success: false,
      payloadSent: { nome: name, email, [fieldName]: fieldValue },
      errorBody,
      errorMessage: error?.message,
      requestUrl: 'https://api-v2.contaazul.com/v1/pessoas',
    };
  }
}

/**
 * Testar múltiplas variações de campo e valor
 */
export async function testCreatePersonVariations(): Promise<CreatePersonResult[]> {
  const results: CreatePersonResult[] = [];

  // Variações de nome de campo
  const fieldVariations = [
    { name: 'tipo', values: ['JURIDICA', 'FISICA', 'ESTRANGEIRA', 'Jurídica', 'Física', 'Estrangeira'] },
    { name: 'tipo_pessoa', values: ['JURIDICA', 'FISICA', 'ESTRANGEIRA', 'Jurídica', 'Física', 'Estrangeira'] },
    { name: 'tipoPessoa', values: ['JURIDICA', 'FISICA', 'ESTRANGEIRA', 'Jurídica', 'Física', 'Estrangeira'] },
  ];

  let attempt = 0;

  for (const fieldVar of fieldVariations) {
    for (const value of fieldVar.values) {
      attempt++;
      console.log(`\n[PeopleCreate] ========== TENTATIVA ${attempt} ==========`);
      console.log(`[PeopleCreate] Testando: fieldName=${fieldVar.name} fieldValue=${value}`);

      const result = await testCreatePersonWithFieldName(fieldVar.name, value);
      result.attempt = attempt;
      results.push(result);

      // Se funcionou, parar
      if (result.success) {
        console.log(`[PeopleCreate] ✅ SUCESSO! Usando fieldName=${fieldVar.name} fieldValue=${value}`);
        return results;
      }

      // Aguardar um pouco entre tentativas
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`[PeopleCreate] ❌ Nenhuma variação funcionou`);
  return results;
}
