/**
 * State Machine para fluxo guiado de coleta de dados do tomador de NFS-e via WhatsApp
 * 
 * Estados:
 * - waiting_document: Aguardando CPF ou CNPJ
 * - document_received: CPF/CNPJ recebido, validando
 * - waiting_name: Aguardando nome completo (se CPF) ou razão social (se CNPJ)
 * - name_received: Nome/razão social recebido
 * - waiting_service_description: Aguardando descrição do serviço
 * - service_description_received: Descrição recebida
 * - waiting_value: Aguardando valor do serviço
 * - value_received: Valor recebido
 * - review_pending: Aguardando confirmação do resumo
 * - confirmed: Pronto para emitir
 * - cancelled: Fluxo cancelado
 */

export type NfseFlowState = 
  | 'waiting_confirmation'      // Aguardando SIM/NÃO inicial
  | 'selecting_company'         // Buscando empresas no banco (estado transitório)
  | 'waiting_company_selection' // Aguardando cliente escolher empresa da lista
  | 'waiting_document'
  | 'document_received'
  | 'waiting_name'
  | 'name_received'
  | 'waiting_service_description'
  | 'service_description_received'
  | 'waiting_value'
  | 'value_received'
  | 'review_pending'
  | 'confirmed'
  | 'cancelled';

export interface CompanyOption {
  document: string;      // CPF ou CNPJ
  name: string;          // Nome/Razão Social
  source: 'clients' | 'certificates';
}

export interface NfseFlowData {
  ticketId: string;
  phone: string;
  clientName?: string;
  
  // Seleção de empresa
  companyOptions?: CompanyOption[];   // Lista de empresas encontradas
  selectedCompany?: CompanyOption;    // Empresa selecionada pelo cliente
  
  // Dados do tomador
  takerDocument?: string; // CPF ou CNPJ
  takerDocumentType?: 'cpf' | 'cnpj'; // Tipo de documento
  takerName?: string; // Nome completo (se CPF) ou razão social (se CNPJ)
  
  // Dados do serviço
  serviceDescription?: string;
  serviceValue?: number;
  
  // Metadados
  state: NfseFlowState;
  createdAt: Date;
  updatedAt: Date;
  attemptCount: number;
  lastMessage?: string;
}

/**
 * Valida e normaliza CPF
 */
export function validateAndNormalizeCpf(cpf: string): { valid: boolean; normalized?: string } {
  const cleaned = cpf.replace(/\D/g, '');
  
  if (cleaned.length !== 11) {
    return { valid: false };
  }
  
  // Validação básica de CPF (não é perfeita, mas serve)
  const allSame = /^(\d)\1{10}$/.test(cleaned);
  if (allSame) {
    return { valid: false };
  }
  
  return { valid: true, normalized: cleaned };
}

/**
 * Valida e normaliza CNPJ
 */
export function validateAndNormalizeCnpj(cnpj: string): { valid: boolean; normalized?: string } {
  const cleaned = cnpj.replace(/\D/g, '');
  
  if (cleaned.length !== 14) {
    return { valid: false };
  }
  
  // Validação básica de CNPJ
  const allSame = /^(\d)\1{13}$/.test(cleaned);
  if (allSame) {
    return { valid: false };
  }
  
  return { valid: true, normalized: cleaned };
}

/**
 * Detecta se é CPF ou CNPJ
 */
export function detectDocumentType(document: string): 'cpf' | 'cnpj' | 'invalid' {
  const cleaned = document.replace(/\D/g, '');
  
  if (cleaned.length === 11) {
    const cpfValidation = validateAndNormalizeCpf(document);
    return cpfValidation.valid ? 'cpf' : 'invalid';
  }
  
  if (cleaned.length === 14) {
    const cnpjValidation = validateAndNormalizeCnpj(document);
    return cnpjValidation.valid ? 'cnpj' : 'invalid';
  }
  
  return 'invalid';
}

/**
 * Valida valor do serviço
 */
export function validateServiceValue(value: string): { valid: boolean; normalized?: number } {
  // Aceita formatos: 1000, 1.000,00, 1,00, 1000.00
  const normalized = value
    .replace(/\./g, '') // Remove pontos (separador de milhares)
    .replace(',', '.'); // Converte vírgula em ponto
  
  const parsed = parseFloat(normalized);
  
  if (isNaN(parsed) || parsed <= 0) {
    return { valid: false };
  }
  
  return { valid: true, normalized: parsed };
}

/**
 * Gera próxima pergunta baseada no estado
 */
export function getNextQuestion(state: NfseFlowState): string {
  const questions: Record<NfseFlowState, string> = {
    waiting_confirmation: 'Deseja emitir uma NFS-e? Responda *SIM* ou *NÃO*.',
    selecting_company: '',    // Processamento interno
    waiting_company_selection: 'Por favor, responda com o *número* da empresa desejada.',
    waiting_document: 'Por favor, envie o CPF ou CNPJ do tomador do serviço.',
    document_received: '', // Não é uma pergunta
    waiting_name: 'Por favor, envie o nome completo ou razão social do tomador.',
    name_received: '', // Não é uma pergunta
    waiting_service_description: 'Por favor, descreva o serviço prestado.',
    service_description_received: '', // Não é uma pergunta
    waiting_value: 'Por favor, envie o valor do serviço (ex: 1.000,00 ou 1000.00).',
    value_received: '', // Não é uma pergunta
    review_pending: 'Por favor, confirme os dados digitando *sim* ou *não*.',
    confirmed: '', // Não é uma pergunta
    cancelled: '', // Não é uma pergunta
  };
  
  return questions[state] || '';
}

/**
 * Gera resumo dos dados coletados
 */
export function generateReviewSummary(data: NfseFlowData): string {
  const docType = data.takerDocumentType === 'cpf' ? 'CPF' : 'CNPJ';
  
  return `📋 *Resumo da NFS-e*

*Tomador do Serviço:*
${docType}: ${data.takerDocument}
Nome: ${data.takerName}

*Serviço:*
Descrição: ${data.serviceDescription}
Valor: R$ ${data.serviceValue?.toFixed(2)}

Por favor, confirme os dados digitando *sim* para prosseguir com a emissão ou *não* para cancelar.`;
}

/**
 * Transição de estado baseada na entrada do usuário
 */
export function transitionState(
  currentState: NfseFlowState,
  userInput: string,
  data: NfseFlowData
): { nextState: NfseFlowState; error?: string; updatedData?: Partial<NfseFlowData> } {
  
  switch (currentState) {
    case 'waiting_confirmation': {
      const resp = userInput.toLowerCase().trim();
      if (resp === 'sim' || resp === 'yes' || resp === 's') {
        return { nextState: 'selecting_company' };
      }
      if (resp === 'não' || resp === 'nao' || resp === 'no' || resp === 'n') {
        return { nextState: 'cancelled', error: 'Emissão cancelada pelo cliente.' };
      }
      return { nextState: 'waiting_confirmation', error: 'Por favor, responda com *SIM* ou *NÃO*.' };
    }

    case 'selecting_company': {
      // Estado transitório — processado pelo webhook, não pelo cliente
      return { nextState: 'selecting_company' };
    }

    case 'waiting_company_selection': {
      const num = parseInt(userInput.trim(), 10);
      const options = data.companyOptions || [];
      if (isNaN(num) || num < 1 || num > options.length) {
        return {
          nextState: 'waiting_company_selection',
          error: `Por favor, responda com um número entre 1 e ${options.length}.`,
        };
      }
      const chosen = options[num - 1];
      const docType = chosen.document.replace(/\D/g, '').length === 11 ? 'cpf' : 'cnpj';
      return {
        nextState: 'waiting_service_description',
        updatedData: {
          selectedCompany: chosen,
          takerDocument: chosen.document,
          takerDocumentType: docType,
          takerName: chosen.name,
        },
      };
    }

    case 'waiting_document': {
      const docType = detectDocumentType(userInput);
      
      if (docType === 'invalid') {
        return {
          nextState: 'waiting_document',
          error: 'Documento inválido. Por favor, envie um CPF ou CNPJ válido.',
        };
      }
      
      const normalized = docType === 'cpf'
        ? validateAndNormalizeCpf(userInput).normalized
        : validateAndNormalizeCnpj(userInput).normalized;
      
      return {
        nextState: 'waiting_name',
        updatedData: {
          takerDocument: normalized,
          takerDocumentType: docType,
        },
      };
    }
    
    case 'waiting_name': {
      const name = userInput.trim();
      
      if (name.length < 3) {
        return {
          nextState: 'waiting_name',
          error: 'Nome muito curto. Por favor, envie um nome válido.',
        };
      }
      
      return {
        nextState: 'waiting_service_description',
        updatedData: { takerName: name },
      };
    }
    
    case 'waiting_service_description': {
      const description = userInput.trim();
      
      if (description.length < 5) {
        return {
          nextState: 'waiting_service_description',
          error: 'Descrição muito curta. Por favor, descreva melhor o serviço.',
        };
      }
      
      return {
        nextState: 'waiting_value',
        updatedData: { serviceDescription: description },
      };
    }
    
    case 'waiting_value': {
      const valueValidation = validateServiceValue(userInput);
      
      if (!valueValidation.valid) {
        return {
          nextState: 'waiting_value',
          error: 'Valor inválido. Por favor, envie um valor válido (ex: 1.000,00).',
        };
      }
      
      return {
        nextState: 'review_pending',
        updatedData: { serviceValue: valueValidation.normalized },
      };
    }
    
    case 'review_pending': {
      const response = userInput.toLowerCase().trim();
      
      if (response === 'sim' || response === 'yes' || response === 's') {
        return {
          nextState: 'confirmed',
        };
      }
      
      if (response === 'não' || response === 'no' || response === 'n') {
        return {
          nextState: 'cancelled',
          error: 'Fluxo cancelado pelo usuário.',
        };
      }
      
      return {
        nextState: 'review_pending',
        error: 'Por favor, responda com "sim" ou "não".',
      };
    }
    
    default:
      return {
        nextState: currentState,
        error: 'Estado inválido.',
      };
  }
}
