/**
 * Seletores reais do Portal NFS-e — Prefeitura de Vila Velha / ES
 * Sistema: SMARAPD — Contribuinte OnLine
 * URL: https://tributacao.vilavelha.es.gov.br/tbw/
 *
 * Mapeamento realizado em 06/03/2026 com sessão real do contador STEVENS TAGLIATE FRAGA (CRC 38570).
 * Todos os seletores foram confirmados via inspeção do HTML do portal com sessão ativa.
 *
 * Para manutenção: se o portal mudar, atualize APENAS este arquivo.
 * O motor (nfseEmissionEngine.ts) importa e usa estes seletores.
 */

export const VILAVELHA_SELECTORS = {

  // ── URLs ─────────────────────────────────────────────────────────
  urls: {
    login: "https://tributacao.vilavelha.es.gov.br/tbw/loginCNPJContribuinte.jsp",
    // Após login, a URL permanece a mesma mas o conteúdo muda para o menu principal
    // Após selecionar empresa, a URL muda para /tbw/servlet/controle
    controle: "https://tributacao.vilavelha.es.gov.br/tbw/servlet/controle",
    captcha: "https://tributacao.vilavelha.es.gov.br/tbw/getCaptcha.jpg",
  },

  // ── Tela de Login ────────────────────────────────────────────────
  login: {
    usuario: "#usuario",
    senha: "#senha",
    captcha: 'input[name="imagem"]',
    captchaImg: "img[src*='getCaptcha']",
    btnEntrar: "a#btnEntrar",
  },

  // ── Menu Principal (após login) ──────────────────────────────────
  // IDs confirmados via inspeção real do portal
  menu: {
    notaFiscal: "div#divnotafiscalouter",
    declaracaoFiscal: "div#divdeclaracaofiscalouter",
    emissao2aVia: "div#_div34",
    parcelamentoWeb: "div#divparcwebouter",
    pesquisaDebitos: "div#divpesqdebouter",
    certidoesWeb: "div#divcertwebouter",
    fichasExtratos: "div#divfichacadmobouter",
    cadastroEletronico: "div#_div21",
    consultarProcesso: "div#_div37",
    gerenciarAutorizacoes: "div#_div40",
  },

  // ── Tela de Cadastros Relacionados (seleção de empresa) ──────────
  // Após clicar em "Nota Fiscal", aparece a grid de empresas vinculadas ao contador
  empresaGrid: {
    // Grid com lista de empresas
    grid: "#_grid1",
    // Campo de busca por CNPJ/nome
    searchInput: "input#_filter1SearchValue",
    // Botão de busca (hint real do portal)
    searchBtn: "button[hint='Realizar Busca Simples']",
    // Célula de identificação da primeira linha (coluna 2 = identificação)
    // Padrão: td[id="N,2__grid1"] onde N é o número da linha
    firstRowCell: "td[id='1,2__grid1']",
    // Seletor dinâmico para linha por CNPJ
    rowByCnpj: (cnpj: string) => `td:has-text("${cnpj}")`,
    // Botão Continuar (após selecionar empresa)
    btnContinuar: "button#_imagebutton1",
  },

  // ── Menu de Nota Fiscal (após selecionar empresa) ────────────────
  // Seletores robustos baseados em texto (portal usa botões com ícones)
  nfseMenu: {
    gerarNotaFiscal: "text=Gerar Nota Fiscal",
    listaNotaFiscais: "text=Lista Nota Fiscais",
    personalizarNF: "text=Personalizar Nota Fiscal",
    tomadoresNF: "text=Tomadores da Nota Fiscal",
    itensNF: "text=Itens da Nota Fiscal",
    guiasISSQN: "text=Guias de ISSQN",
    rps: "text=RPS",
    gerenciarAutorizacoes: "text=Gerenciar Autorizações",
  },

  // ── Formulário de Emissão (Gerar Nota Fiscal) ────────────────────
  // Todos os IDs confirmados via inspeção real do formulário
  form: {
    // Dados do Tomador
    localizacaoTomador: "select#qyTomaInfo",
    // Opções: "Tomador não informado" | "Brasil" | "Exterior"

    // Campos do tomador (aparecem quando "Brasil" é selecionado)
    // IDs confirmados via inspeção real em 11/03/2026
    tomadorCpfCnpj: "input#qycnpjcpf",
    tomadorRazaoSocial: "input#qynome",
    tomadorEmail: "input#qyemail",
    tomadorTelefone: "input#qyTelefones",
    // Campos de endereço do tomador (IDs confirmados em 11/03/2026)
    tomadorLogradouro: "input#qyendereco",
    tomadorNumero: "input#qyendereconumero",
    tomadorComplemento: "input#qyenderecocomplemento",
    tomadorBairro: "input#qybairro",
    tomadorCidade: "input#qycidade",
    tomadorEstado: "input#qyestado",
    tomadorCep: "input#qycep",

    // Dados do Intermediário
    localizacaoIntermediario: "select#qyIntermedInfo",

    // Dados do RPS
    numeroRPS: "input#qyrps",
    dataEmissaoRPS: "input#qyrpsdtemissao",
    serieRPS: "input#qyrpsserie",

    // Dados da NFS-e
    servicosPrestados: "select#qyidatividade",
    codigoNBS: "input#qynbsdescricao",
    dataEmissao: "input#qydtemissao",
    competenciaMes: "select#qybuscafatormesreferencia",
    competenciaAno: "select#qybuscafatoranoreferencia",
    observacoes: "textarea#qyobs",

    // Tributação ISSQN
    imunidade: "select#qypergimunidade",
    paisPrestacao: "input#qyPaisPrestacao",
    municipioPrestacao: "input#qyservicocidade",
    estadoPrestacao: "input#qyservicoestado",
    municipioIncidencia: "select#qymunicipioincidencia",
    localServico: "select#combobox3",
    // Opções: "1 - SERVIÇO PRESTADO NO MUNICÍPIO DE VILA VELHA" | "2 - FORA" | "3 - EXPORTAÇÃO"

    // Descrição e Valores
    descricaoServico: "textarea#qynfitemunicodescritem",
    valorTotal: "input#qynfitemunicovlrtotal",
    descontoIncondicionado: "input#qydescontoincondicionado",
    descontoCondicionado: "input#qydescontocondicionado",
    valorDeducoes: "input#qyvlrdeducoes",

    // Impostos e Tributação
    tributacaoISSQN: "select#qytribISSQN",
    regimeEspecial: "select#qyRegimeEspecialTributacao",
    issRetido: "select#qyimpretido",
    suspensaoNao: "input#qypertpsuspensao0",
    suspensaoSim: "input#qypertpsuspensao1",
    retencaoObrigNao: "input#qyperretencaoobrig0",
    retencaoObrigSim: "input#qyperretencaoobrig1",
    beneficioMunicipalNao: "input#qyPerBeneMunicipal0",
    beneficioMunicipalSim: "input#qyPerBeneMunicipal1",
    aliquota: "input#qyaliquota",
    valorISSQN: "input#issdevido",
    baseCalculoISSQN: "input#bcissqn",
    codigoTributacao: "select#qycts",
    pisCofins: "select#qytpretpiscofins",
    irrf: "input#qyvlrirrf",
    csll: "input#qyvlrcsll",
    inss: "input#qyvlrinss",
    outrosImpostos: "input#qyoutrosdescontos",
    issValor: "input#issretido",

    // Ações do formulário
    btnConfirmarNota: "button#_imagebutton4",
    btnCancelar: "button#_imagebutton5",
  },

  // ── Resultado da Emissão ─────────────────────────────────────────
  // A ser mapeado após primeira emissão real
  resultado: {
    // Número da NFS-e (a confirmar após emissão)
    numeroNfse: "#numeroNFSe, span.numero-nfse, td.numero-nfse",
    // Botão de download do PDF
    btnDownloadPdf: "button[hint*='PDF'], a[href*='pdf'], button:has-text('PDF'), a:has-text('Imprimir')",
    // Indicador de sucesso
    successIndicator: "div.alert-success, span:has-text('emitida'), .sucesso",
    // Indicador de erro
    errorIndicator: "div.alert-danger, .erro, #mensagemErro",
  },

  // ── Indicadores de estado da página ─────────────────────────────
  pageState: {
    // Está logado (menu principal visível) — verificar pelo conteúdo, não pela URL
    isLoggedIn: "div#divnotafiscalouter",
    // Está na tela de login (campo de usuário visível)
    isLoginPage: "input#usuario",
    // Está na tela de seleção de empresa (grid de cadastros relacionados)
    isEmpresaGrid: "input#_filter1SearchValue",
    // Está no menu de NFS-e (após selecionar empresa) - usa texto pois portal usa botões com ícones
    isNfseMenu: "text=Gerar Nota Fiscal",
    // Está no formulário de emissão
    isEmissaoForm: "button#_imagebutton4",
  },
} as const;

// ── Objeto VV (seletores genéricos — fallback se IDs mudam) ─────────────────────
// Conforme instruções de 09/03/2026 — seletores alternativos para maior resiliência
export const VV = {
  login: {
    url: 'https://tributacao.vilavelha.es.gov.br/tbw/loginCNPJContribuinte.jsp',
    cpfCnpj: 'input[name="CPF_CGC"], input[type="text"]:first-of-type',
    senha: 'input[name="SENHA"], input[type="password"]',
    captcha: 'input[name="txtCaptcha"], input[name*="captcha" i], input[name*="imagem" i]',
    captchaImg: 'img[src*="captcha" i], img[src*="Captcha" i]',
    btnEntrar: 'button[type="submit"], input[type="submit"]',
  },
  empresa: {
    linhaTabela: 'table tr',
    btnContinuar: 'input[value="Continuar"], button:has-text("Continuar")',
    // Para selecionar empresa por CNPJ: page.locator(`tr:has-text("${cnpj}")`).click()
  },
  menuNfse: {
    btnNotaFiscal: 'a:has-text("Nota Fiscal"), td:has-text("Nota Fiscal")',
    btnGerarNota: 'a:has-text("Gerar Nota Fiscal"), td:has-text("Gerar Nota Fiscal")',
  },
  tomador: {
    localizacao: 'select[name*="localizacao" i], select[name*="local" i]',
    cnpjCpf: 'input[name*="CNPJ" i], input[name*="CPF" i], input[name*="cgc" i]',
    radioJuridica: 'input[type="radio"][value*="J"]',
    radioFisica: 'input[type="radio"][value*="F"]',
    nome: 'input[name*="nome" i], input[name*="razao" i]',
    email: 'input[name*="email" i]',
  },
  servico: {
    servicoPrestado: 'select[name*="servico" i], select[name*="atividade" i]',
    dataEmissao: 'input[name*="data" i]',
    competenciaMes: 'select[name*="mes" i]',
    competenciaAno: 'select[name*="ano" i]',
    descricao: 'textarea[name*="discriminacao" i], textarea[name*="descricao" i]',
    valor: 'input[name*="valor" i]:not([name*="issqn" i]):not([name*="bc" i])',
  },
  submissao: {
    btnEmitir: 'input[value*="Gravar" i], button:has-text("Gravar")',
    btnConfirmar: 'input[value*="Confirmar" i], button:has-text("Confirmar")',
  },
  download: {
    btnPdf: 'a:has-text("Imprimir"), a:has-text("PDF")',
  },
} as const;

// ── Helpers para seletores ───────────────────────────────────────

/**
 * Tenta encontrar um elemento por seletor com timeout curto.
 * Retorna o elemento ou null se não encontrar.
 */
export async function trySelector(page: any, selector: string, timeout = 3000): Promise<any | null> {
  try {
    return await page.waitForSelector(selector, { timeout, state: "visible" }).catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Verifica se um seletor está presente na página.
 */
export async function hasSelector(page: any, selector: string, timeout = 2000): Promise<boolean> {
  const el = await trySelector(page, selector, timeout);
  return el !== null;
}

/**
 * Tenta encontrar um elemento por uma lista de seletores.
 * Retorna o primeiro elemento encontrado ou null.
 */
export async function trySelectors(page: any, selectors: string[], timeout = 3000): Promise<any | null> {
  for (const sel of selectors) {
    const el = await trySelector(page, sel, timeout);
    if (el) return el;
  }
  return null;
}

/**
 * Tenta preencher um campo por uma lista de seletores.
 * Retorna true se conseguiu preencher.
 */
export async function tryFill(page: any, selectors: string[], value: string, timeout = 3000): Promise<boolean> {
  for (const sel of selectors) {
    const el = await trySelector(page, sel, timeout);
    if (el) {
      try {
        await el.fill(value);
        return true;
      } catch {
        // tenta próximo seletor
      }
    }
  }
  return false;
}

/**
 * Tenta selecionar uma opção em um <select> por uma lista de seletores.
 * Retorna true se conseguiu selecionar.
 */
export async function trySelectOption(page: any, selectors: string[], value: string, timeout = 3000): Promise<boolean> {
  const errors: { selector: string; error: string }[] = [];
  
  for (const sel of selectors) {
    try {
      const el = await trySelector(page, sel, timeout);
      if (el) {
        try {
          await el.selectOption(value);
          console.log(`[trySelectOption] OK: ${sel}, valor: ${value}`);
          return true;
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          console.log(`[trySelectOption] ERRO ao selecionar ${sel}: ${errMsg}`);
          errors.push({ selector: sel, error: errMsg });
        }
      } else {
        console.log(`[trySelectOption] WARN: Elemento nao encontrado para ${sel}`);
        errors.push({ selector: sel, error: 'Elemento nao encontrado' });
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.log(`[trySelectOption] ERRO ao processar ${sel}: ${errMsg}`);
      errors.push({ selector: sel, error: errMsg });
    }
  }
  
  console.log(`[trySelectOption] FALHA: Nenhum seletor funcionou para valor '${value}'`);
  console.log(`[trySelectOption] Seletores tentados:`, selectors);
  console.log(`[trySelectOption] Erros:`, errors);
  return false;
}

/**
 * Tenta clicar em um elemento por uma lista de seletores.
 * Retorna true se conseguiu clicar.
 */
export async function tryClick(page: any, selectors: string[], timeout = 3000): Promise<boolean> {
  for (const sel of selectors) {
    const el = await trySelector(page, sel, timeout);
    if (el) {
      try {
        await el.click();
        return true;
      } catch {
        // tenta próximo seletor
      }
    }
  }
  return false;
}
