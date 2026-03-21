/**
 * abrasfXmlSigner.ts
 * Assina XML com certificado A1 (PFX) para envio ao webservice ABRASF 2.03
 * Usa xml-crypto + node-forge
 */

import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import crypto from 'crypto';

export interface PfxCredential {
  pfxBuffer: Buffer;
  password: string;
}

export interface SigningKey {
  privateKeyPem: string;
  certPem: string;
  certDer: string; // base64
}

/**
 * Extrai chave privada e certificado do PFX
 */
export function extractFromPfx(cred: PfxCredential): SigningKey {
  const p12Asn1 = forge.asn1.fromDer(cred.pfxBuffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, cred.password);

  // Buscar chave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBagList = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  if (keyBagList.length === 0) {
    throw new Error('Nenhuma chave privada encontrada no PFX');
  }
  const privateKey = keyBagList[0].key as forge.pki.rsa.PrivateKey;

  // Buscar certificado principal (CN contém CNPJ)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBagList = certBags[forge.pki.oids.certBag] || [];
  if (certBagList.length === 0) {
    throw new Error('Nenhum certificado encontrado no PFX');
  }

  // Pegar o cert que tem o CN com a empresa (não a CA)
  let cert = certBagList[0].cert!;
  for (const bag of certBagList) {
    const cn = bag.cert?.subject?.getField('CN')?.value || '';
    if (cn.includes(':') || cn.toUpperCase().includes('LTDA') || cn.toUpperCase().includes('S.T.')) {
      cert = bag.cert!;
      break;
    }
  }

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  // DER base64 para KeyInfo
  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary').toString('base64');

  return { privateKeyPem, certPem, certDer };
}

/**
 * Assina o XML do RPS/LoteRps para ABRASF 2.03
 * O Id do elemento a ser assinado é passado como parâmetro
 */
export function signXml(xmlString: string, signingKey: SigningKey, elementId: string): string {
  const sig = new SignedXml({
    privateKey: signingKey.privateKeyPem,
    publicCert: signingKey.certPem,
  });

  sig.addReference({
    xpath: `//*[@Id="${elementId}"]`,
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  });

  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#';
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

  sig.computeSignature(xmlString, {
    location: { reference: `//*[@Id="${elementId}"]`, action: 'append' },
    existingPrefixes: { ds: 'http://www.w3.org/2000/09/xmldsig#' },
  });

  let signed = sig.getSignedXml();

  // Injetar X509Certificate no KeyInfo para validação pelo servidor
  if (!signed.includes('X509Certificate') && signingKey.certDer) {
    signed = signed.replace(
      '<ds:KeyInfo>',
      `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${signingKey.certDer}</ds:X509Certificate></ds:X509Data>`
    ).replace('</ds:KeyInfo>', '</ds:KeyInfo>');
    // Se não tinha KeyInfo, adicionar
    if (!signed.includes('ds:KeyInfo')) {
      signed = signed.replace(
        '</ds:SignatureValue>',
        `</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${signingKey.certDer}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`
      );
    }
  }

  return signed;
}

/**
 * Gera número sequencial único para RPS baseado em timestamp
 */
export function gerarNumeroRps(): number {
  return Math.floor(Date.now() / 1000) % 999999 + 1;
}

/**
 * Gera número de lote único
 */
export function gerarNumeroLote(): number {
  return Math.floor(Date.now() / 1000);
}
