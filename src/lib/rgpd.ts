// RGPD (P1-B6) : durée de conservation, liste des clients à purger, export individuel et texte de la politique de
// confidentialité. Logique pure, partagée par le serveur (routes …/purge, …/export.csv) et le front (page
// #/confidentialite, écran Clients) — testée sans navigateur.
import type { Client, Commerce, CommercePublic, EnvoiRelance, Tirage } from '../types'
import { celluleCsv } from './csv.ts'
import { reserveUtilisable, recompensesEnAttenteValables } from './programme.ts'
import { statutGain, type StatutGain } from './roulette.ts'

// ---------- Durée de conservation ----------

/** Défaut : 3 ans après la dernière activité (recommandation CNIL pour les données clients / prospects). */
export const CONSERVATION_DEFAUT_MOIS = 36
export const CONSERVATION_MIN_MOIS = 6
export const CONSERVATION_MAX_MOIS = 120
/** Un client apparaît dans l'avertissement « bientôt purgé » ce nombre de jours avant sa date de purge. */
export const JOURS_AVERTISSEMENT_PURGE = 30

export function dureeConservationMois(c: Pick<Commerce, 'conservationMois'>): number {
  const m = c.conservationMois
  return typeof m === 'number' && Number.isInteger(m) && m >= CONSERVATION_MIN_MOIS && m <= CONSERVATION_MAX_MOIS ? m : CONSERVATION_DEFAUT_MOIS
}

/** « 3 ans », « 18 mois ». */
export function libelleDuree(mois: number): string {
  if (mois % 12 === 0) return `${mois / 12} an${mois > 12 ? 's' : ''}`
  return `${mois} mois`
}

/** Dernière activité connue : dernière visite validée, à défaut la date d'inscription. */
export function derniereActivite(c: Pick<Client, 'derniereVisite' | 'creeLe'>): string {
  return c.derniereVisite && c.derniereVisite > c.creeLe ? c.derniereVisite : c.creeLe
}

/** Date + n mois (fin de mois ramenée au dernier jour : 31 janv. + 1 mois → 28/29 févr.). */
export function ajouterMois(iso: string, mois: number): Date {
  const d = new Date(iso)
  const jour = d.getUTCDate()
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + mois, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()))
  const dernier = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(jour, dernier))
  return r
}

export function datePurge(c: Pick<Client, 'derniereVisite' | 'creeLe'>, mois: number): Date {
  return ajouterMois(derniereActivite(c), mois)
}

/**
 * Raison pour laquelle un client n'est jamais purgé automatiquement, même inactif depuis plus que la durée :
 * exclusion décidée par le commerce, récompense gagnée pas encore retirée, plat en réserve valable, visite oubliée en
 * attente de décision (litige ouvert). `undefined` = rien ne le protège.
 */
export function protectionPurge(c: Client, maintenant: Date): string | undefined {
  if (c.exclusPurge) return 'Exclu de la purge par le commerce'
  if (recompensesEnAttenteValables(c, maintenant).length) return 'Récompense gagnée pas encore retirée'
  if (reserveUtilisable(c, maintenant)) return 'Plat en réserve encore valable'
  if ((c.demandesRattrapage ?? []).some((d) => d.statut === 'en_attente')) return 'Visite oubliée en attente de décision'
  return undefined
}

export interface ClientAPurger {
  id: string
  prenom: string
  derniereActivite: string
  /** Date à partir de laquelle le client peut être purgé (ISO). */
  purgeLe: string
  /** `due` : date dépassée, purgeable maintenant ; `bientot` : dans moins de JOURS_AVERTISSEMENT_PURGE jours. */
  statut: 'due' | 'bientot'
  /** Présente : le client ne sera PAS purgé (voir `protectionPurge`). */
  protection?: string
}

/** Avertissement avant purge : clients dont la date de purge est passée ou proche, la plus ancienne d'abord. */
export function listePurge(clients: Client[], commerce: Pick<Commerce, 'conservationMois'>, maintenant: Date): ClientAPurger[] {
  const mois = dureeConservationMois(commerce)
  const limiteAvertissement = maintenant.getTime() + JOURS_AVERTISSEMENT_PURGE * 86_400_000
  const liste: ClientAPurger[] = []
  for (const c of clients) {
    const purge = datePurge(c, mois)
    if (purge.getTime() > limiteAvertissement) continue
    const protection = protectionPurge(c, maintenant)
    liste.push({
      id: c.id,
      prenom: c.prenom,
      derniereActivite: derniereActivite(c),
      purgeLe: purge.toISOString(),
      statut: purge.getTime() <= maintenant.getTime() ? 'due' : 'bientot',
      ...(protection ? { protection } : {}),
    })
  }
  return liste.sort((a, b) => a.purgeLe.localeCompare(b.purgeLe))
}

/** Purgeable maintenant : date de purge passée et aucune protection. */
export function estPurgeable(c: Client, commerce: Pick<Commerce, 'conservationMois'>, maintenant: Date): boolean {
  return datePurge(c, dureeConservationMois(commerce)).getTime() <= maintenant.getTime() && !protectionPurge(c, maintenant)
}

// ---------- Rappel périodique de purge (P1-G1) ----------

/**
 * Décision P1-G1 — refus explicite de la purge automatique : RIEN n'est jamais supprimé sans un geste du
 * commerçant. Ni tâche planifiée (Render Free n'exécute rien sans requête), ni suppression à l'ouverture de
 * l'état, ni minuteur côté front. La contrepartie est ce rappel : le tableau de bord — ouvert à chaque passage
 * du commerçant — et l'écran Clients montrent les cartes dues ou proches de l'être, avec le lien vers l'écran
 * Clients où la purge se lance après saisie de « PURGER ».
 * Portée exacte de la garantie : le rappel du tableau de bord couvre les cartes purgeables (dues ou dues sous
 * 30 jours, sans protection), en mode API, depuis les clients chargés dans le navigateur. Une carte protégée
 * au-delà de la conservation n'y apparaît pas — elle reste listée dans l'écran Clients avec sa protection, et
 * c'est l'écran Clients (`GET …/purge`, relu à chaque ouverture) qui est la liste de référence, pas le rappel.
 */
export interface ResumeRappelPurge {
  /** Cartes dont la date de purge est passée et qu'aucune protection ne retient : à purger maintenant. */
  aPurger: number
  /** Cartes dont la date de purge tombe dans les 30 jours, sans protection. */
  bientot: number
  /** Cartes listées mais protégées (exclues, récompense en attente, réserve, litige) : jamais purgées. */
  proteges: number
}

/** Résumé du rappel, depuis une liste de purge (`listePurge`) : les trois compteurs sont disjoints. */
export function resumeRappelPurge(liste: ClientAPurger[]): ResumeRappelPurge {
  return {
    aPurger: liste.filter((c) => c.statut === 'due' && !c.protection).length,
    bientot: liste.filter((c) => c.statut === 'bientot' && !c.protection).length,
    proteges: liste.filter((c) => c.protection).length,
  }
}

// ---------- Export individuel (droit d'accès / portabilité) ----------

const ORIGINES: Record<NonNullable<Client['consentementRelanceOrigine']>, string> = {
  inscription: 'case cochée à l’inscription',
  commercant: 'enregistré par le commerce',
  'stop-sms': 'réponse STOP par SMS',
  'lien-email': 'lien de désinscription (e-mail)',
}

/** Statut d'un tirage dans l'export (perdant : rien ; remis : la date de remise suit déjà). */
const STATUTS_EXPORT: Record<StatutGain, string> = {
  enAttente: 'gain utilisable à partir de demain',
  inactif: 'gain à utiliser',
  utilisable: 'gain à utiliser',
  remis: '',
  expire: 'gain expiré',
  perdant: '',
  consolation: '',
}

/**
 * Toutes les données d'UN client, en CSV (même format que l'export global `clientsEnCsv` : séparateur « ; », BOM
 * UTF-8, cellules protégées contre l'injection de formules). Une ligne par donnée : rubrique ; date ; libellé ; valeur.
 * Jamais : PIN, hash, code équipe, identifiants techniques (anti-doublon, idempotence), ni l'identifiant d'un autre
 * client (le parrain n'est indiqué que par « oui »).
 */
export function exportClientCsv(client: Client, tirages: Tirage[], envois: EnvoiRelance[] = [], maintenant = new Date()): string {
  const lignes: (string | number | null | undefined)[][] = []
  const l = (rubrique: string, date: string | null | undefined, libelle: string, valeur?: string | number | null) => lignes.push([rubrique, date ?? '', libelle, valeur ?? ''])

  l('profil', client.creeLe, 'Inscription', 'carte de fidélité')
  l('profil', null, 'Identifiant de la carte', client.id)
  l('profil', null, 'Prénom', client.prenom)
  l('profil', null, 'Téléphone', client.telephone)
  l('profil', null, 'E-mail', client.email)
  l('profil', null, 'Anniversaire (MM-JJ)', client.anniversaire)
  l('profil', null, 'Plat préféré', client.platPrefere)
  l('fidelite', null, 'Tampons', client.tampons)
  l('fidelite', null, 'Points', client.points ?? 0)
  l('fidelite', null, 'Dépense déclarée (centimes)', client.depenseCentimes ?? 0)
  l('fidelite', client.derniereVisite, 'Dernière visite', client.visites.length ? `${client.visites.length} visite(s) au total` : 'aucune visite')
  if (client.codeParrainage) l('fidelite', null, 'Code de parrainage', client.codeParrainage)
  if (client.parrainId) l('fidelite', null, 'Parrainé par un autre client', client.parrainagePaye ? 'oui (bonus versé)' : 'oui')
  for (const d of client.parrainagesGagnes ?? []) l('fidelite', d, 'Parrainage réussi', '')
  l(
    'consentement',
    client.consentementRelanceLe,
    'Relances SMS / e-mail',
    client.consentementRelance ? `oui${client.consentementRelanceOrigine ? ` (${ORIGINES[client.consentementRelanceOrigine]})` : ''}` : client.consentementRelanceOrigine ? `retiré (${ORIGINES[client.consentementRelanceOrigine]})` : 'non',
  )
  if (client.demandeSuppressionLe) l('rgpd', client.demandeSuppressionLe, 'Demande de suppression', 'en attente de traitement par le commerce')
  for (const v of client.visites) l('visite', v, 'Visite validée', '')
  for (const r of client.recompensesOffertes ?? []) l('recompense', r.date, 'Récompense offerte', r.libelle)
  for (const r of client.recompensesEnAttente ?? []) l('recompense', r.creeLe, 'Récompense à retirer', `${r.libelle}${r.expireLe ? ` (jusqu’au ${r.expireLe.slice(0, 10)})` : ''}`)
  for (const s of client.paliersOfferts ?? []) l('recompense', null, 'Palier remis', `${s} visites`)
  for (const d of client.defisReussis ?? []) l('recompense', d.date, 'Défi réussi', d.recompense)
  if (client.reserve) l('recompense', client.reserve.gagneLe, 'Plat en réserve', client.reserve.utiliseLe ? `utilisé le ${client.reserve.utiliseLe.slice(0, 10)}` : `valable jusqu’au ${client.reserve.expireLe.slice(0, 10)}`)
  for (const e of client.echangesPoints ?? []) l('echange', e.date, 'Échange de points', `${e.libelle} (−${e.cout} points, solde ${e.soldeAvant} → ${e.soldeApres})`)
  // Revue Codex R3 (F1) : jamais le code brut — il ne circule que par l'activation (« Utiliser mon gain ») ; à la place,
  // le statut du gain à la date de l'export.
  for (const t of [...tirages].filter((x) => x.clientId === client.id).sort((a, b) => a.date.localeCompare(b.date))) {
    const statut = STATUTS_EXPORT[statutGain(t, maintenant)]
    l('tirage', t.date, 'Roue du jour', `${t.lot}${statut ? ` (${statut})` : ''}${t.remis ? ` — remis le ${t.remis.le.slice(0, 10)}` : ''}`)
  }
  for (const d of client.demandesRattrapage ?? []) l('rattrapage', d.date, 'Visite oubliée signalée', `${d.statut} · ${d.montantCentimes} centimes${d.ticket ? ` · ticket ${d.ticket}` : ''}`)
  for (const m of client.messages ?? []) l('message', m.date, 'Message reçu sur la carte', m.texte)
  for (const m of client.messagesPrives ?? []) l('message', m.creeLe, `Message privé au restaurant (${m.note}★)`, m.texte)
  for (const e of envois.filter((x) => x.clientId === client.id)) l('relance', e.date, `Relance ${e.canal === 'sms' ? 'SMS' : 'e-mail'} (${e.modele})`, e.statut)

  const entete = ['rubrique', 'date', 'libelle', 'valeur']
  return '﻿' + [entete.join(';'), ...lignes.map((x) => x.map(celluleCsv).join(';'))].join('\r\n') + '\r\n'
}

export function nomFichierExportClient(clientId: string): string {
  return `donnees-${clientId}.csv`.replace(/[^\w.-]/g, '_')
}

// ---------- Politique de confidentialité ----------

/** Hébergement : Render vérifié dans `render.yaml` (region: frankfurt). Supabase : la région du projet n'est déclarée nulle part dans le code. */
export const HEBERGEMENT_SERVEUR = 'Serveur de l’application : Render, région Frankfurt (Allemagne, Union européenne).'
export const HEBERGEMENT_BASE =
  'Base de données : Supabase — région à confirmer (la région Central EU Frankfurt est celle prévue à la création du projet, mais elle n’a pas pu être vérifiée).'

export interface Prestataires {
  sms?: boolean
  email?: boolean
  googleWallet?: boolean
  /** Nom du prestataire SMS effectif (`Brevo` / `Twilio`), envoyé par `/sante` quand le SMS est configuré. */
  smsPrestataire?: string
}

export interface SectionPolitique {
  titre: string
  lignes: string[]
}

/**
 * Texte de la page #/confidentialite/<commerceId>. `prestataires` = intégrations configurées sur le serveur
 * (GET /sante) ; `null` = état inconnu (serveur injoignable). Rien n'est nommé tant que ce n'est pas configuré.
 */
export function politiqueConfidentialite(
  commerce: Pick<CommercePublic, 'nom' | 'coordonnees'> & { conservationMois?: number },
  prestataires: Prestataires | null,
): SectionPolitique[] {
  const duree = libelleDuree(dureeConservationMois(commerce))
  const nommes = prestataires
    ? [
        // Le serveur envoie toujours le nom quand le SMS est configuré ; repli = le prestataire choisi (Brevo).
        ...(prestataires.sms ? [`${prestataires.smsPrestataire ?? 'Brevo'} (envoi des SMS de relance)`] : []),
        ...(prestataires.email ? ['Brevo (envoi des e-mails de relance)'] : []),
        ...(prestataires.googleWallet ? ['Google (carte Google Wallet, si vous l’ajoutez)'] : []),
      ]
    : []
  const envoi = !prestataires
    ? 'Liste des prestataires d’envoi momentanément indisponible (serveur injoignable). Aucun message n’est envoyé sans prestataire configuré.'
    : nommes.length
      ? `Prestataires techniques utilisés : ${nommes.join(' ; ')}. Ils n’agissent que pour le compte du commerce.`
      : 'Aucun prestataire d’envoi configuré à ce jour : aucun SMS ni e-mail n’est envoyé.'
  return [
    {
      titre: 'Responsable du traitement',
      lignes: [`${commerce.nom}${commerce.coordonnees ? ` — ${commerce.coordonnees}` : ''}.`],
    },
    {
      titre: 'Données collectées',
      lignes: [
        'Votre prénom (facultatif) et votre téléphone et / ou votre e-mail.',
        'Vos tampons, points, récompenses, gains de la roue et l’historique de vos visites.',
        'Votre anniversaire et votre plat préféré, seulement si vous les indiquez.',
        'Votre choix pour les relances SMS / e-mail (oui ou non, avec la date et l’origine).',
      ],
    },
    {
      titre: 'Finalité',
      lignes: [
        'La carte de fidélité du commerce et la roue du jour.',
        'Les relances par SMS ou e-mail, uniquement avec votre consentement (case non pré-cochée), retirable à tout moment : lien de désinscription dans chaque SMS et chaque e-mail, ou auprès du commerce.',
      ],
    },
    {
      titre: 'Partage',
      lignes: ['Aucune revente, aucune publicité tierce, aucun partage hors des prestataires techniques indispensables.', envoi],
    },
    {
      titre: 'Conservation',
      lignes: [
        `Vos données sont conservées ${duree} après votre dernière visite (ou après votre inscription si vous n’êtes jamais revenu), puis supprimées.`,
        'Le commerce voit à l’avance la liste des cartes concernées et lance lui-même la suppression : une carte avec une récompense pas encore retirée ou une demande en cours n’est pas supprimée.',
      ],
    },
    {
      titre: 'Vos droits',
      lignes: [
        'Accès, rectification, export (portabilité), suppression de vos données, retrait du consentement aux relances, opposition.',
        'Depuis votre carte : « Recevoir mes données » (fichier téléchargé) et « Demander la suppression » (la demande est enregistrée, le commerce supprime la carte).',
        'Ou en caisse, ou par message au commerce (coordonnées ci-dessus). Réponse sous un mois au plus.',
        'En cas de désaccord, vous pouvez saisir la CNIL (cnil.fr).',
      ],
    },
    {
      titre: 'Hébergement',
      lignes: [HEBERGEMENT_SERVEUR, HEBERGEMENT_BASE],
    },
  ]
}
