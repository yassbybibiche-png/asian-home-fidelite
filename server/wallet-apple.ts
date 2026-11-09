// Apple Wallet — EN SUSPENS par décision explicite de l'utilisateur (09/11/2026).
// Ce fichier contient le VRAI code de fabrication d'un pass `.pkpass` (pass.json, manifest.json avec l'empreinte
// SHA-1 de chaque fichier, signature PKCS #7 / CMS détachée, archive zip), sans aucune dépendance npm.
// Il n'est branché sur AUCUNE route : `…/pass.pkpass` reste en 404 et `/sante` dit `appleWallet: "en_suspens"`.
// Sans certificat « Pass Type ID » + clé privée + certificat intermédiaire Apple WWDR, `construirePkpass` REFUSE
// (ErreurAppleNonConfigure) : rien n'est signé, aucun pass n'est produit. Ce qu'il faut fournir : server/README.md.
import { createHash, createPrivateKey, sign, X509Certificate } from 'node:crypto'
import type { Client, Commerce } from '../src/types.ts'
import { tamponsAffiches } from '../src/lib/fidelite.ts'
import { COULEUR_DEFAUT } from '../src/lib/apparence.ts'

export interface ConfigAppleWallet {
  /** Identifiant « Pass Type ID » (ex. pass.fr.exemple.fidelite) — compte Apple Developer. */
  passTypeIdentifier?: string
  /** Team ID Apple Developer (10 caractères). */
  teamIdentifier?: string
  /** Certificat du Pass Type ID (PEM). */
  certificatPem?: string
  /** Clé privée du certificat (PEM), éventuellement chiffrée. */
  clePem?: string
  motDePasseCle?: string
  /** Certificat intermédiaire Apple WWDR (PEM). */
  wwdrPem?: string
}

export class ErreurAppleNonConfigure extends Error {
  constructor() {
    super('Apple Wallet en suspens : aucun certificat Pass Type ID, clé ni certificat WWDR fournis. Aucun pass n’est signé ni généré.')
  }
}

export function appleWalletConfigure(c: ConfigAppleWallet | undefined): boolean {
  return !!(c?.passTypeIdentifier && c.teamIdentifier && c.certificatPem && c.clePem && c.wwdrPem)
}

/** pass.json d'une carte de fidélité (style « storeCard »). */
export function passJsonApple(commerce: Commerce, client: Client, urlCarte: string, c: Required<Pick<ConfigAppleWallet, 'passTypeIdentifier' | 'teamIdentifier'>>) {
  const couleur = commerce.apparence?.couleur ?? COULEUR_DEFAUT
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16)).join(', ')})`
  return {
    formatVersion: 1,
    passTypeIdentifier: c.passTypeIdentifier,
    teamIdentifier: c.teamIdentifier,
    serialNumber: client.id,
    organizationName: commerce.nom,
    description: `Carte de fidélité ${commerce.nom}`,
    logoText: commerce.nom,
    backgroundColor: rgb,
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(255, 255, 255)',
    storeCard: {
      primaryFields: [{ key: 'tampons', label: 'Tampons', value: `${tamponsAffiches(client, commerce)}/${commerce.seuilTampons}` }],
      secondaryFields: [{ key: 'titulaire', label: 'Titulaire', value: client.prenom }],
      auxiliaryFields: [{ key: 'points', label: 'Points', value: client.points ?? 0 }],
      backFields: [{ key: 'recompense', label: 'Récompense', value: commerce.recompense }],
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: urlCarte, messageEncoding: 'iso-8859-1', altText: client.prenom }],
  }
}

/** manifest.json : empreinte SHA-1 (hex) de chaque fichier du pass. */
export function manifeste(fichiers: Record<string, Buffer>): Record<string, string> {
  return Object.fromEntries(Object.entries(fichiers).map(([nom, contenu]) => [nom, createHash('sha1').update(contenu).digest('hex')]))
}

// ---------- DER (ASN.1) minimal ----------

function longueur(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const octets: number[] = []
  for (let x = n; x > 0; x >>= 8) octets.unshift(x & 0xff)
  return Buffer.from([0x80 | octets.length, ...octets])
}
const tlv = (tag: number, ...contenu: Buffer[]) => {
  const c = Buffer.concat(contenu)
  return Buffer.concat([Buffer.from([tag]), longueur(c.length), c])
}
const seq = (...c: Buffer[]) => tlv(0x30, ...c)
const set = (...c: Buffer[]) => tlv(0x31, ...c)
const entier = (n: number) => tlv(0x02, Buffer.from([n]))
const nul = () => Buffer.from([0x05, 0x00])
function oid(s: string): Buffer {
  const [a, b, ...reste] = s.split('.').map(Number)
  const octets = [40 * a + b]
  for (const n of reste) {
    const g = [n & 0x7f]
    for (let x = n >> 7; x > 0; x >>= 7) g.unshift((x & 0x7f) | 0x80)
    octets.push(...g)
  }
  return tlv(0x06, Buffer.from(octets))
}
function utcTime(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, '0')
  return tlv(0x17, Buffer.from(`${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`))
}

/** Lit un élément DER à `debut` : renvoie l'élément complet et ses bornes. */
function lireTlv(b: Buffer, debut: number) {
  let i = debut + 1
  let n = b[i++]
  if (n & 0x80) {
    const k = n & 0x7f
    n = 0
    for (let j = 0; j < k; j++) n = (n << 8) | b[i++]
  }
  return { tag: b[debut], debutContenu: i, fin: i + n, brut: b.subarray(debut, i + n) }
}

/** Émetteur (Name) et numéro de série du certificat, tels quels (DER), pour IssuerAndSerialNumber. */
function emetteurEtSerie(certDer: Buffer): { emetteur: Buffer; serie: Buffer } {
  const cert = lireTlv(certDer, 0)
  const tbs = lireTlv(certDer, cert.debutContenu)
  let i = tbs.debutContenu
  if (certDer[i] === 0xa0) i = lireTlv(certDer, i).fin // version [0]
  const serie = lireTlv(certDer, i)
  const algo = lireTlv(certDer, serie.fin)
  const emetteur = lireTlv(certDer, algo.fin)
  return { emetteur: emetteur.brut, serie: serie.brut }
}

const OID = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsa: '1.2.840.113549.1.1.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
}

const derDuPem = (pem: string) => Buffer.from(new X509Certificate(pem).raw)

/** Signature CMS (PKCS #7) détachée de `contenu`, SHA-256 / RSA, avec le certificat signataire et le WWDR. */
export function signatureCms(contenu: Buffer, certificatPem: string, clePem: string, wwdrPem: string, motDePasse?: string, quand = new Date()): Buffer {
  const cert = derDuPem(certificatPem)
  const wwdr = derDuPem(wwdrPem)
  const { emetteur, serie } = emetteurEtSerie(cert)
  const algoSha256 = seq(oid(OID.sha256), nul())
  const attributs = [
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(utcTime(quand))),
    seq(oid(OID.messageDigest), set(tlv(0x04, createHash('sha256').update(contenu).digest()))),
  ]
  // On signe les attributs encodés en SET (0x31), puis on les range sous la balise implicite [0] (0xA0).
  const signature = sign('sha256', set(...attributs), createPrivateKey({ key: clePem, passphrase: motDePasse }))
  const signerInfo = seq(
    entier(1),
    seq(emetteur, serie),
    algoSha256,
    tlv(0xa0, ...attributs),
    seq(oid(OID.rsa), nul()),
    tlv(0x04, signature),
  )
  const signedData = seq(entier(1), set(algoSha256), seq(oid(OID.data)), tlv(0xa0, cert, wwdr), set(signerInfo))
  return seq(oid(OID.signedData), tlv(0xa0, signedData))
}

// ---------- ZIP (méthode « stockée », sans compression) ----------

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
export function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const x of b) c = TABLE_CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zip(fichiers: Record<string, Buffer>): Buffer {
  const locaux: Buffer[] = []
  const central: Buffer[] = []
  let decalage = 0
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const n = Buffer.from(nom, 'utf8')
    const crc = crc32(contenu)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // noms en UTF-8
    local.writeUInt16LE(0, 8) // stocké
    local.writeUInt32LE(0x00210000, 10) // 01/01/1980 00:00
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(contenu.length, 18)
    local.writeUInt32LE(contenu.length, 22)
    local.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x0800, 8)
    c.writeUInt32LE(0x00210000, 12)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(contenu.length, 20)
    c.writeUInt32LE(contenu.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(decalage, 42)
    locaux.push(local, n, contenu)
    central.push(c, n)
    decalage += 30 + n.length + contenu.length
  }
  const dir = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(Object.keys(fichiers).length, 8)
  fin.writeUInt16LE(Object.keys(fichiers).length, 10)
  fin.writeUInt32LE(dir.length, 12)
  fin.writeUInt32LE(decalage, 16)
  return Buffer.concat([...locaux, dir, fin])
}

/**
 * Fabrique un `.pkpass` : fichiers fournis (pass.json, icon.png…) + manifest.json + signature, zippés.
 * REFUSE sans configuration complète (certificat, clé, WWDR, identifiants) : rien n'est signé.
 */
export function construirePkpass(fichiers: Record<string, Buffer>, config: ConfigAppleWallet | undefined, quand = new Date()): Buffer {
  if (!appleWalletConfigure(config)) throw new ErreurAppleNonConfigure()
  if (!fichiers['pass.json']) throw new Error('pass.json manquant.')
  const manifest = Buffer.from(JSON.stringify(manifeste(fichiers)))
  const signature = signatureCms(manifest, config!.certificatPem!, config!.clePem!, config!.wwdrPem!, config!.motDePasseCle, quand)
  return zip({ ...fichiers, 'manifest.json': manifest, signature })
}
