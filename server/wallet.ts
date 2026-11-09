// Google Wallet — ARCHITECTURE PRÊTE, RIEN DE BRANCHÉ (V3).
// Construit la charge utile NON SIGNÉE d'un « Generic pass » Google Wallet pour une carte de fidélité.
// Aucun compte émetteur n'existe, aucune clé n'est configurée, aucun appel à Google n'est fait ici,
// et rien n'est signé : sans signature (JWT « Save to Google Wallet »), ce n'est PAS un pass utilisable.
//
// Apple Wallet : EN SUSPENS (décision utilisateur du 09/11/2026). Aucun code de génération ni de
// signature de pass Apple n'existe dans ce dépôt — voir server/README.md.
import type { Client, Commerce } from '../src/types.ts'
import { tamponsAffiches } from '../src/lib/fidelite.ts'

/** Valeur mise à la place de l'identifiant émetteur tant qu'aucun compte Google Wallet n'existe. */
export const ISSUER_PLACEHOLDER = 'ISSUER_ID_A_FOURNIR'

export interface ConfigGoogleWallet {
  /** Identifiant émetteur (console Google Pay & Wallet) — variable GOOGLE_WALLET_ISSUER_ID. */
  issuerId?: string
  /** Chemin du fichier JSON de la clé du compte de service — variable GOOGLE_WALLET_SERVICE_ACCOUNT_FILE. */
  fichierCleService?: string
}

/** Vrai seulement si l'émetteur ET la clé de service sont fournis. */
export function walletConfigure(c: ConfigGoogleWallet | undefined): boolean {
  return !!(c?.issuerId && c.fichierCleService)
}

const texte = (valeur: string) => ({ defaultValue: { language: 'fr', value: valeur } })

/** Identifiant Google Wallet : `<issuerId>.<suffixe>`, suffixe limité à lettres, chiffres, `.`, `_`, `-`. */
const suffixe = (s: string) => s.replace(/[^\w.-]/g, '_')

/**
 * Charge utile NON SIGNÉE (objet `genericObject` + classe) d'une carte de fidélité.
 * `urlCarte` = adresse publique de la carte (`<site>/#/carte/<clientId>`), encodée dans le QR.
 */
export function payloadGoogleWallet(commerce: Commerce, client: Client, urlCarte: string, issuerId = ISSUER_PLACEHOLDER) {
  const classId = `${issuerId}.${suffixe(`fidelite-${commerce.id}`)}`
  const tampons = tamponsAffiches(client, commerce)
  return {
    signe: false,
    genericClasses: [{ id: classId }],
    genericObjects: [
      {
        id: `${issuerId}.${suffixe(client.id)}`,
        classId,
        state: 'ACTIVE',
        cardTitle: texte(commerce.nom),
        subheader: texte('Carte de fidélité'),
        header: texte(client.prenom),
        hexBackgroundColor: '#b3262d',
        textModulesData: [
          { id: 'tampons', header: 'Tampons', body: `${tampons}/${commerce.seuilTampons}` },
          { id: 'recompense', header: 'Récompense', body: commerce.recompense },
        ],
        barcode: { type: 'QR_CODE', value: urlCarte, alternateText: client.prenom },
      },
    ],
  }
}
