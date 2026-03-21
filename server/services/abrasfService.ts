/**
 * abrasfService.ts
 * Integração com webservice ABRASF 2.03 — SmarAPD de Vila Velha/ES
 *
 * Endpoint: http://tributacao.vilavelha.es.gov.br/tbw/services/Abrasf
 *
 * Operações implementadas:
 *   - RecepcionarLoteRps  (emissão)
 *   - ConsultarNfseRps    (consulta após emissão)
 *   - CancelarNfse        (cancelamento)
 */

import mysql from 'mysql2/promise';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { extractFromPfx, signXml, gerarNumeroRps, gerarNumeroLote } from './abrasfXmlSigner';

const ABRASF_ENDPOINT = 'http://tributacao.vilavelha.es.gov.br/tbw/services/Abrasf';
const CODIGO_MUNICIPIO_VILA_VELHA = '3205200';
const NAMESPACE_ABRASF = 'http://www.abrasf.org.br/nfse.xsd';

// Criptografia das senhas (igual ao certificatesRouter)
const ENCRYPTION_KEY = (process.env.JWT_SECRET || 'fraga-cert-key-32chars-minimum!!').substring(0, 32);
const CERT_DEFAULT_PASSWORD = 'Abcd@1234';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface DadosEmissao {
  emissaoId: number;
  prestadorCnpj: string;
  prestadorIm: string;          // Inscrição Municipal
  prestadorRazaoSocial: string;
  tomadorNome: string;
  tomadorCpfCnpj: string;
  tomadorEmail?: string;
  tomadorEndereco?: string;
  tomadorNumero?: string;
  tomadorComplemento?: string;
  tomadorBairro?: string;
  tomadorCep?: string;
  tomadorCidade?: string;
  tomadorUf?: string;
  valor: number;
  competencia: string;          // "MM/AAAA"
  descricaoServico: string;
  codigoServico: string;        // ex: "17.06"
  cnaePrincipal?: string;       // ex: "6920601"
  issRetido: boolean;
  aliquotaIss?: number;         // decimal, ex: 0.02 = 2%
}

export interface ResultadoEmissao {
  success: boolean;
  numeroNfse?: string;
  serieNfse?: string;
  codigoVerificacao?: string;
  dataEmissao?: string;
  xmlRetorno?: string;
  erro?: string;
  protocolo?: string;
}

export interface ResultadoCancelamento {
  success: boolean;
  mensagem?: string;
  xmlRetorno?: string;
  erro?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConn() {
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

function decryptPassword(encrypted: string): string | null {
  try {
    const [ivHex, encHex] = encrypted.split(':');
    if (!ivHex || !encHex) return null;
    const iv = Buffer.from(ivHex, 'hex');
    const encBuf = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    const decrypted = Buffer.concat([decipher.update(encBuf), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Formata valor monetário para XML ABRASF (2 casas decimais, ponto como separador)
 */
function fmtValor(v: number): string {
  return Number(v).toFixed(2);
}

/**
 * Formata data para ABRASF: YYYY-MM-DD
 */
function fmtData(d: Date): string {
  return d.toISOString().substring(0, 10);
}

/**
 * Converte competência "MM/AAAA" para primeiro dia: "AAAA-MM-01"
 */
function competenciaToData(competencia: string): string {
  const [mm, aaaa] = competencia.split('/');
  return `${aaaa}-${mm.padStart(2, '0')}-01`;
}

/**
 * Limpa CNPJ/CPF removendo pontuação
 */
function limparDoc(doc: string): string {
  return (doc || '').replace(/\D/g, '');
}

// ─── Busca certificado do prestador ──────────────────────────────────────────

async function buscarCertificadoPrestador(cnpj: string): Promise<{ pfxBuffer: Buffer; password: string } | null> {
  const cnpjLimpo = limparDoc(cnpj);

  // Buscar certificado com pfx_data no banco
  const certs = await rawQuery(
    'SELECT c.id, c.pfx_data FROM certificates c WHERE c.cnpj = ? AND c.pfx_data IS NOT NULL AND c.status IN ("valid", "unknown") ORDER BY c.id DESC LIMIT 1',
    [cnpjLimpo]
  );

  if (!certs.length || !certs[0].pfx_data) {
    console.warn(`[ABRASF] Certificado não encontrado para CNPJ ${cnpjLimpo}`);
    return null;
  }

  const certId = certs[0].id;
  const pfxBuffer = Buffer.isBuffer(certs[0].pfx_data) ? certs[0].pfx_data : Buffer.from(certs[0].pfx_data);

  // Buscar senha na tabela certificate_secrets
  const secrets = await rawQuery(
    'SELECT encrypted_password FROM certificate_secrets WHERE certificate_id = ? LIMIT 1',
    [certId]
  );

  let password = CERT_DEFAULT_PASSWORD;
  if (secrets.length && secrets[0].encrypted_password) {
    const decrypted = decryptPassword(secrets[0].encrypted_password);
    if (decrypted) password = decrypted;
  }

  return { pfxBuffer, password };
}

// ─── Construção do XML RPS ────────────────────────────────────────────────────

function buildRpsXml(dados: DadosEmissao, numeroRps: number): string {
  const cnpjPrestador = limparDoc(dados.prestadorCnpj);
  const dataEmissao = fmtData(new Date());
  const competenciaData = competenciaToData(dados.competencia);
  const valorServicos = fmtValor(dados.valor);
  const aliquota = dados.aliquotaIss ?? 0.02;
  const valorIss = fmtValor(dados.valor * aliquota);
  const issRetidoCodigo = dados.issRetido ? '1' : '2'; // 1=sim, 2=não
  const valorLiquido = dados.issRetido ? fmtValor(dados.valor - dados.valor * aliquota) : valorServicos;
  const cnpjTomador = limparDoc(dados.tomadorCpfCnpj);
  const isCnpj = cnpjTomador.length === 14;
  const codigoServico = (dados.codigoServico || '17.06').replace(/\./g, '.'); // garante ponto
  const cnae = dados.cnaePrincipal || '6920601';
  const rpsId = `rps${numeroRps}`;

  // Endereço do tomador
  let enderecoTomadorXml = '';
  if (dados.tomadorEndereco) {
    const cepLimpo = (dados.tomadorCep || '').replace(/\D/g, '').padEnd(8, '0');
    const codMunTomador = CODIGO_MUNICIPIO_VILA_VELHA; // padrão Vila Velha
    enderecoTomadorXml = `
        <Endereco>
          <Endereco>${escapeXml(dados.tomadorEndereco)}</Endereco>
          <Numero>${escapeXml(dados.tomadorNumero || 'S/N')}</Numero>
          ${dados.tomadorComplemento ? `<Complemento>${escapeXml(dados.tomadorComplemento)}</Complemento>` : ''}
          <Bairro>${escapeXml(dados.tomadorBairro || '')}</Bairro>
          <CodigoMunicipio>${codMunTomador}</CodigoMunicipio>
          <Uf>${escapeXml(dados.tomadorUf || 'ES')}</Uf>
          <CodigoPais>1058</CodigoPais>
          <Cep>${cepLimpo}</Cep>
        </Endereco>`;
  }

  const emailTomadorXml = dados.tomadorEmail
    ? `<Contato><Email>${escapeXml(dados.tomadorEmail)}</Email></Contato>` : '';

  return `<Rps>
      <InfDeclaracaoPrestacaoServico Id="${rpsId}">
        <Rps>
          <IdentificacaoRps>
            <Numero>${numeroRps}</Numero>
            <Serie>1</Serie>
            <Tipo>1</Tipo>
          </IdentificacaoRps>
          <DataEmissao>${dataEmissao}</DataEmissao>
          <Status>1</Status>
        </Rps>
        <Competencia>${competenciaData}</Competencia>
        <Servico>
          <Valores>
            <ValorServicos>${valorServicos}</ValorServicos>
            <ValorDeducoes>0.00</ValorDeducoes>
            <ValorPis>0.00</ValorPis>
            <ValorCofins>0.00</ValorCofins>
            <ValorInss>0.00</ValorInss>
            <ValorIr>0.00</ValorIr>
            <ValorCsll>0.00</ValorCsll>
            <IssRetido>${issRetidoCodigo}</IssRetido>
            <ValorIss>${valorIss}</ValorIss>
            <ValorIssRetido>${dados.issRetido ? valorIss : '0.00'}</ValorIssRetido>
            <OutrasRetencoes>0.00</OutrasRetencoes>
            <BaseCalculo>${valorServicos}</BaseCalculo>
            <Aliquota>${aliquota.toFixed(4)}</Aliquota>
            <ValorLiquidoNfse>${valorLiquido}</ValorLiquidoNfse>
          </Valores>
          <ItemListaServico>${escapeXml(codigoServico)}</ItemListaServico>
          <CodigoCnae>${cnae}</CodigoCnae>
          <Discriminacao>${escapeXml(dados.descricaoServico)}</Discriminacao>
          <CodigoMunicipio>${CODIGO_MUNICIPIO_VILA_VELHA}</CodigoMunicipio>
          <ExigibilidadeISS>1</ExigibilidadeISS>
          <MunicipioIncidencia>${CODIGO_MUNICIPIO_VILA_VELHA}</MunicipioIncidencia>
        </Servico>
        <Prestador>
          <CpfCnpj><Cnpj>${cnpjPrestador}</Cnpj></CpfCnpj>
          <InscricaoMunicipal>${escapeXml(dados.prestadorIm)}</InscricaoMunicipal>
        </Prestador>
        <Tomador>
          <IdentificacaoTomador>
            <CpfCnpj>${isCnpj ? `<Cnpj>${cnpjTomador}</Cnpj>` : `<Cpf>${cnpjTomador}</Cpf>`}</CpfCnpj>
          </IdentificacaoTomador>
          <RazaoSocial>${escapeXml(dados.tomadorNome)}</RazaoSocial>
          ${enderecoTomadorXml}
          ${emailTomadorXml}
        </Tomador>
        <OptanteSimplesNacional>1</OptanteSimplesNacional>
        <IncentivoFiscal>2</IncentivoFiscal>
      </InfDeclaracaoPrestacaoServico>
    </Rps>`;
}

function buildEnviarLoteRpsXml(dados: DadosEmissao, numeroRps: number, numeroLote: number): string {
  const cnpjPrestador = limparDoc(dados.prestadorCnpj);
  const loteId = `lote${numeroLote}`;
  const rpsXml = buildRpsXml(dados, numeroRps);

  return `<?xml version="1.0" encoding="UTF-8"?>
<EnviarLoteRpsEnvio xmlns="${NAMESPACE_ABRASF}">
  <LoteRps Id="${loteId}" versao="2.03">
    <NumeroLote>${numeroLote}</NumeroLote>
    <CpfCnpj><Cnpj>${cnpjPrestador}</Cnpj></CpfCnpj>
    <InscricaoMunicipal>${escapeXml(dados.prestadorIm)}</InscricaoMunicipal>
    <QuantidadeRps>1</QuantidadeRps>
    <ListaRps>
      ${rpsXml}
    </ListaRps>
  </LoteRps>
</EnviarLoteRpsEnvio>`;
}

function wrapSoapEnvelope(bodyContent: string, action: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:e="http://www.abrasf.org.br/nfse.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    ${bodyContent}
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(str: string): string {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ─── Envio SOAP ───────────────────────────────────────────────────────────────

async function sendSoapRequest(soapEnvelope: string, soapAction: string): Promise<string> {
  const response = await fetch(ABRASF_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml;charset=UTF-8',
      'SOAPAction': soapAction,
    },
    body: soapEnvelope,
    // timeout: 30000 (node-fetch v2 não suporta diretamente, usar signal)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

// ─── Parser de resposta ───────────────────────────────────────────────────────

function extrairTagXml(xml: string, tag: string): string | null {
  const regex = new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function temErroRetorno(xml: string): { temErro: boolean; mensagem: string } {
  const msgErro = extrairTagXml(xml, 'Mensagem') || extrairTagXml(xml, 'MensagemRetorno') || '';
  const codErro = extrairTagXml(xml, 'Codigo') || extrairTagXml(xml, 'CodigoMensagemAlerta') || '';
  // Código E = erro, A = alerta (não fatal)
  const isErro = xml.includes('ListaMensagemRetornoLote') ||
    xml.includes('ListaMensagemRetorno') ||
    codErro.startsWith('E');

  return { temErro: isErro && !!codErro.startsWith('E'), mensagem: msgErro || codErro };
}

// ─── Consulta NFS-e por RPS ───────────────────────────────────────────────────

async function consultarNfsePorRps(
  prestadorCnpj: string,
  prestadorIm: string,
  numeroRps: number,
  signingKey: any
): Promise<{ numeroNfse?: string; codigoVerificacao?: string; dataEmissao?: string }> {
  const cnpjLimpo = limparDoc(prestadorCnpj);
  const consultaId = `cons${numeroRps}`;

  const consultaXml = `<?xml version="1.0" encoding="UTF-8"?>
<ConsultarNfseRpsEnvio xmlns="${NAMESPACE_ABRASF}">
  <IdentificacaoRps Id="${consultaId}">
    <Numero>${numeroRps}</Numero>
    <Serie>1</Serie>
    <Tipo>1</Tipo>
  </IdentificacaoRps>
  <Prestador>
    <CpfCnpj><Cnpj>${cnpjLimpo}</Cnpj></CpfCnpj>
    <InscricaoMunicipal>${prestadorIm}</InscricaoMunicipal>
  </Prestador>
</ConsultarNfseRpsEnvio>`;

  const signedConsulta = signXml(consultaXml, signingKey, consultaId);
  const soapBody = `<e:ConsultarNfseRps><e:nfseCabecMsg><![CDATA[<?xml version="1.0" encoding="UTF-8"?><cabecalho xmlns="${NAMESPACE_ABRASF}" versao="2.03"><versaoDados>2.03</versaoDados></cabecalho>]]></e:nfseCabecMsg><e:nfseDadosMsg><![CDATA[${signedConsulta}]]></e:nfseDadosMsg></e:ConsultarNfseRps>`;
  const soap = wrapSoapEnvelope(soapBody, 'http://www.abrasf.org.br/nfse.xsd/ConsultarNfseRps');

  try {
    const resposta = await sendSoapRequest(soap, 'ConsultarNfseRps');
    const numeroNfse = extrairTagXml(resposta, 'Numero');
    const codigoVerificacao = extrairTagXml(resposta, 'CodigoVerificacao');
    const dataEmissao = extrairTagXml(resposta, 'DataEmissaoNfse') || extrairTagXml(resposta, 'DataEmissao');
    return { numeroNfse: numeroNfse || undefined, codigoVerificacao: codigoVerificacao || undefined, dataEmissao: dataEmissao || undefined };
  } catch (err) {
    console.warn('[ABRASF] Consulta NFS-e falhou:', err);
    return {};
  }
}

// ─── Emissão principal ────────────────────────────────────────────────────────

export async function emitirViaSoap(dados: DadosEmissao): Promise<ResultadoEmissao> {
  console.log(`[ABRASF] Iniciando emissão para ${dados.prestadorRazaoSocial} (${dados.prestadorCnpj})`);

  // 1. Buscar certificado
  const credencial = await buscarCertificadoPrestador(dados.prestadorCnpj);
  if (!credencial) {
    return { success: false, erro: `Certificado A1 não encontrado para CNPJ ${dados.prestadorCnpj}` };
  }

  // 2. Extrair chave e certificado do PFX
  let signingKey: ReturnType<typeof import('./abrasfXmlSigner').extractFromPfx>;
  try {
    const { extractFromPfx: extract } = await import('./abrasfXmlSigner');
    signingKey = extract(credencial);
  } catch (err: any) {
    return { success: false, erro: `Erro ao processar certificado: ${err.message}` };
  }

  // 3. Gerar números de RPS e Lote
  const numeroRps = gerarNumeroRps();
  const numeroLote = gerarNumeroLote();
  const rpsId = `rps${numeroRps}`;
  const loteId = `lote${numeroLote}`;

  // 4. Montar XML do lote
  const loteXml = buildEnviarLoteRpsXml(dados, numeroRps, numeroLote);
  console.log('[ABRASF] XML do lote montado (primeiros 500 chars):', loteXml.substring(0, 500));

  // 5. Assinar XML (assinar o InfDeclaracaoPrestacaoServico)
  let loteXmlAssinado: string;
  try {
    const { signXml: sign } = await import('./abrasfXmlSigner');
    loteXmlAssinado = sign(loteXml, signingKey, rpsId);
    console.log('[ABRASF] XML assinado com sucesso');
  } catch (err: any) {
    return { success: false, erro: `Erro ao assinar XML: ${err.message}` };
  }

  // 6. Montar envelope SOAP
  const cabecalho = `<?xml version="1.0" encoding="UTF-8"?><cabecalho xmlns="${NAMESPACE_ABRASF}" versao="2.03"><versaoDados>2.03</versaoDados></cabecalho>`;
  const soapBody = `<e:RecepcionarLoteRps>
    <e:nfseCabecMsg><![CDATA[${cabecalho}]]></e:nfseCabecMsg>
    <e:nfseDadosMsg><![CDATA[${loteXmlAssinado}]]></e:nfseDadosMsg>
  </e:RecepcionarLoteRps>`;
  const soapEnvelope = wrapSoapEnvelope(soapBody, 'http://www.abrasf.org.br/nfse.xsd/RecepcionarLoteRps');

  // 7. Enviar para o webservice
  let xmlRetorno: string;
  try {
    console.log('[ABRASF] Enviando para', ABRASF_ENDPOINT);
    xmlRetorno = await sendSoapRequest(soapEnvelope, 'RecepcionarLoteRps');
    console.log('[ABRASF] Resposta recebida (primeiros 1000 chars):', xmlRetorno.substring(0, 1000));
  } catch (err: any) {
    return { success: false, erro: `Falha na comunicação com o webservice: ${err.message}`, xmlRetorno: '' };
  }

  // 8. Verificar protocolo de recepção
  const protocolo = extrairTagXml(xmlRetorno, 'Protocolo');
  const erroInfo = temErroRetorno(xmlRetorno);

  if (erroInfo.temErro) {
    console.warn('[ABRASF] Webservice retornou erro:', erroInfo.mensagem);
    return { success: false, erro: erroInfo.mensagem, xmlRetorno, protocolo: protocolo || undefined };
  }

  // 9. Se recebeu protocolo, aguardar processamento e consultar
  if (protocolo) {
    console.log(`[ABRASF] Protocolo de recepção: ${protocolo}. Aguardando 3s para consultar...`);
    await new Promise(r => setTimeout(r, 3000));

    const consultaResult = await consultarNfsePorRps(
      dados.prestadorCnpj,
      dados.prestadorIm,
      numeroRps,
      signingKey
    );

    if (consultaResult.numeroNfse) {
      console.log(`[ABRASF] NFS-e emitida com sucesso! Número: ${consultaResult.numeroNfse}`);
      return {
        success: true,
        numeroNfse: consultaResult.numeroNfse,
        serieNfse: '1',
        codigoVerificacao: consultaResult.codigoVerificacao,
        dataEmissao: consultaResult.dataEmissao,
        xmlRetorno,
        protocolo,
      };
    }

    // Protocolo recebido mas NFS-e ainda não disponível — emissão em processamento
    console.warn('[ABRASF] Protocolo recebido mas NFS-e ainda não disponível após consulta');
    return {
      success: false,
      erro: `Lote em processamento (protocolo: ${protocolo}). Consulte novamente em instantes.`,
      protocolo,
      xmlRetorno,
    };
  }

  // 10. Verificar se já veio o número da nota direto na resposta (sincrono)
  const numeroNfse = extrairTagXml(xmlRetorno, 'NumeroNfse') || extrairTagXml(xmlRetorno, 'Numero');
  const codigoVerificacao = extrairTagXml(xmlRetorno, 'CodigoVerificacao');
  const dataEmissao = extrairTagXml(xmlRetorno, 'DataEmissaoNfse') || extrairTagXml(xmlRetorno, 'DataEmissao');

  if (numeroNfse) {
    console.log(`[ABRASF] NFS-e emitida de forma síncrona! Número: ${numeroNfse}`);
    return {
      success: true,
      numeroNfse,
      serieNfse: '1',
      codigoVerificacao: codigoVerificacao || undefined,
      dataEmissao: dataEmissao || undefined,
      xmlRetorno,
    };
  }

  return {
    success: false,
    erro: 'Resposta do webservice não contém número de nota ou protocolo. Verifique o XML retornado.',
    xmlRetorno,
  };
}

// ─── Cancelamento ─────────────────────────────────────────────────────────────

export async function cancelarViaSoap(
  prestadorCnpj: string,
  prestadorIm: string,
  numeroNfse: string,
  codigoCancelamento: string = '2' // 2 = Erro na emissão
): Promise<ResultadoCancelamento> {
  console.log(`[ABRASF] Cancelando NFS-e ${numeroNfse} para ${prestadorCnpj}`);

  const credencial = await buscarCertificadoPrestador(prestadorCnpj);
  if (!credencial) {
    return { success: false, erro: `Certificado A1 não encontrado para CNPJ ${prestadorCnpj}` };
  }

  let signingKey: ReturnType<typeof import('./abrasfXmlSigner').extractFromPfx>;
  try {
    const { extractFromPfx: extract } = await import('./abrasfXmlSigner');
    signingKey = extract(credencial);
  } catch (err: any) {
    return { success: false, erro: `Erro ao processar certificado: ${err.message}` };
  }

  const cnpjLimpo = limparDoc(prestadorCnpj);
  const cancelId = `cancel${Date.now()}`;

  const cancelXml = `<?xml version="1.0" encoding="UTF-8"?>
<CancelarNfseEnvio xmlns="${NAMESPACE_ABRASF}">
  <Pedido>
    <InfPedidoCancelamento Id="${cancelId}">
      <IdentificacaoNfse>
        <Numero>${numeroNfse}</Numero>
        <CpfCnpj><Cnpj>${cnpjLimpo}</Cnpj></CpfCnpj>
        <InscricaoMunicipal>${prestadorIm}</InscricaoMunicipal>
        <CodigoMunicipio>${CODIGO_MUNICIPIO_VILA_VELHA}</CodigoMunicipio>
      </IdentificacaoNfse>
      <CodigoCancelamento>${codigoCancelamento}</CodigoCancelamento>
    </InfPedidoCancelamento>
  </Pedido>
</CancelarNfseEnvio>`;

  const { signXml: sign } = await import('./abrasfXmlSigner');
  let cancelXmlAssinado: string;
  try {
    cancelXmlAssinado = sign(cancelXml, signingKey, cancelId);
  } catch (err: any) {
    return { success: false, erro: `Erro ao assinar XML de cancelamento: ${err.message}` };
  }

  const cabecalho = `<?xml version="1.0" encoding="UTF-8"?><cabecalho xmlns="${NAMESPACE_ABRASF}" versao="2.03"><versaoDados>2.03</versaoDados></cabecalho>`;
  const soapBody = `<e:CancelarNfse>
    <e:nfseCabecMsg><![CDATA[${cabecalho}]]></e:nfseCabecMsg>
    <e:nfseDadosMsg><![CDATA[${cancelXmlAssinado}]]></e:nfseDadosMsg>
  </e:CancelarNfse>`;
  const soapEnvelope = wrapSoapEnvelope(soapBody, 'http://www.abrasf.org.br/nfse.xsd/CancelarNfse');

  let xmlRetorno: string;
  try {
    xmlRetorno = await sendSoapRequest(soapEnvelope, 'CancelarNfse');
    console.log('[ABRASF] Resposta cancelamento:', xmlRetorno.substring(0, 500));
  } catch (err: any) {
    return { success: false, erro: `Falha na comunicação: ${err.message}` };
  }

  const erroInfo = temErroRetorno(xmlRetorno);
  if (erroInfo.temErro) {
    return { success: false, erro: erroInfo.mensagem, xmlRetorno };
  }

  const dataCancelamento = extrairTagXml(xmlRetorno, 'DataHoraCancelamento');
  return {
    success: true,
    mensagem: `NFS-e ${numeroNfse} cancelada com sucesso${dataCancelamento ? ` em ${dataCancelamento}` : ''}`,
    xmlRetorno,
  };
}
