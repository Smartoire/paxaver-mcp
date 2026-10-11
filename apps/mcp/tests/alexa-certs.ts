/**
 * Test helper: builds an RSA test CA and an Alexa-style signing certificate
 * in process, and signs Alexa request bodies with it. Nothing here is a
 * real Amazon key.
 */

import { AsnConvert, OctetString } from '@peculiar/asn1-schema';
import {
  AlgorithmIdentifier,
  AttributeTypeAndValue,
  AttributeValue,
  BasicConstraints,
  Certificate,
  Extension,
  Extensions,
  GeneralName,
  Name,
  RelativeDistinguishedName,
  SubjectAlternativeName,
  SubjectPublicKeyInfo,
  TBSCertificate,
  Validity,
  Version,
  id_ce_basicConstraints,
  id_ce_subjectAltName,
} from '@peculiar/asn1-x509';

const RSA_PARAMS = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

const SHA256_WITH_RSA = new AlgorithmIdentifier({
  algorithm: '1.2.840.113549.1.1.11',
  parameters: new Uint8Array([5, 0]).buffer,
});

const DAY = 86_400_000;

function name(cn: string): Name {
  return new Name([
    new RelativeDistinguishedName([
      new AttributeTypeAndValue({ type: '2.5.4.3', value: new AttributeValue({ utf8String: cn }) }),
    ]),
  ]);
}

function toPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export interface TestCert {
  pem: string;
  keys: CryptoKeyPair;
  subject: string;
}

export interface CertOptions {
  subject: string;
  issuer?: TestCert;
  san?: string;
  ca?: boolean;
  notBefore?: number;
  notAfter?: number;
}

export async function makeCert(opts: CertOptions): Promise<TestCert> {
  const keys = (await crypto.subtle.generateKey(RSA_PARAMS, true, ['sign', 'verify'])) as CryptoKeyPair;
  const spki = (await crypto.subtle.exportKey('spki', keys.publicKey)) as ArrayBuffer;
  const now = Date.now();

  const extensions = new Extensions();
  if (opts.ca) {
    extensions.push(
      new Extension({
        extnID: id_ce_basicConstraints,
        critical: true,
        extnValue: new OctetString(AsnConvert.serialize(new BasicConstraints({ cA: true }))),
      }),
    );
  }
  if (opts.san) {
    extensions.push(
      new Extension({
        extnID: id_ce_subjectAltName,
        critical: false,
        extnValue: new OctetString(
          AsnConvert.serialize(new SubjectAlternativeName([new GeneralName({ dNSName: opts.san })])),
        ),
      }),
    );
  }

  const tbs = new TBSCertificate({
    version: Version.v3,
    serialNumber: crypto.getRandomValues(new Uint8Array(8)).buffer,
    signature: SHA256_WITH_RSA,
    issuer: name(opts.issuer?.subject ?? opts.subject),
    validity: new Validity({
      notBefore: new Date(opts.notBefore ?? now - DAY),
      notAfter: new Date(opts.notAfter ?? now + 30 * DAY),
    }),
    subject: name(opts.subject),
    subjectPublicKeyInfo: AsnConvert.parse(spki, SubjectPublicKeyInfo),
    extensions,
  });
  const tbsDer = AsnConvert.serialize(tbs);
  const signer = opts.issuer?.keys.privateKey ?? keys.privateKey;
  const signatureValue = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, tbsDer);
  const cert = new Certificate({ tbsCertificate: tbs, signatureAlgorithm: SHA256_WITH_RSA, signatureValue });
  return { pem: toPem(AsnConvert.serialize(cert)), keys, subject: opts.subject };
}

/** A root, an intermediate, and a signing leaf with SAN echo-api.amazon.com. */
export async function makeAlexaChain(leaf: Partial<CertOptions> = {}): Promise<{
  root: TestCert;
  intermediate: TestCert;
  leaf: TestCert;
  chainPem: string;
}> {
  const root = await makeCert({ subject: 'Test Root', ca: true });
  const intermediate = await makeCert({ subject: 'Test Intermediate', issuer: root, ca: true });
  const signing = await makeCert({
    subject: 'echo-api.amazon.com',
    issuer: intermediate,
    san: 'echo-api.amazon.com',
    ...leaf,
  });
  return { root, intermediate, leaf: signing, chainPem: signing.pem + intermediate.pem };
}

export async function signBody(leaf: TestCert, body: Uint8Array): Promise<string> {
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', leaf.keys.privateKey, body);
  return Buffer.from(signature).toString('base64');
}
