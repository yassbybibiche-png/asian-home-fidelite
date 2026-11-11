// P2-Q1 (vérification, 11/11/2026) — ce que le lot initial (fusion 1e40b68, déjà dans
// autonome/integration) avait livré sans garde automatisée, complété ici (revue Codex P2-Q1) :
// - vouvoiement : aucun test n'existait ; le détecteur couvre désormais les littéraux, les gabarits
//   et les textes JSX bruts (commentaires exclus), avec frontière Unicode et apostrophe typographique ;
// - couverture EN : l'ancien test ne voyait que les écrans clients et manquait les ternaires imbriqués,
//   les constantes (t(TEXTE_…), t(LIBELLE_…)), les titres/enfants de MessagePublic et de Traduit, et
//   les messages dynamiques (saisie, accroche, étapes, badges) ; l'analyseur ci-dessous lit le 1er
//   argument de chaque t(…) par analyse syntaxique (pas de regex sur « t('…') ») et chaque clé du
//   dictionnaire doit être utilisée — le plancher numérique (191) ne prouve rien, il est supprimé.
//   Trous trouvés par l'analyseur et corrigés : MESSAGE_MODE_SERVEUR, toute la page #/desinscription
//   (titres, phrases, bouton — dont la phrase « fait » avec {commerce} en modèle), le bandeau
//   parrainage et les instructions « Garder ma carte » de #/jouer, les libellés du profil de #/carte,
//   « ‹ Retour » de #/confidentialite. Clés mortes retirées : « 10/11/12/13 chiffres sur 10 »
//   (inatteignables : 10–13 chiffres forment déjà un numéro valide) ; « 0 chiffre sur 10 » ajouté
//   (tapé « + »). Limite connue : les textes JSX bruts sur plusieurs lignes dont le nœud commence seul
//   sur sa ligne échappent à segmentsJsx (ligne par ligne) — aucun en base après les corrections
//   ci-dessus (vérifié 11/11/2026 par balayage des pages clientes), et tout texte client passe par t() ;
// - revue Codex (2e passe, 11/11/2026) : analyseur renforcé (apostrophe JSX, interpolations imbriquées) ;
//   « Every {jour}, members: » (le « s » français ne se reporte pas) ; branche EN du détail des badges
//   (ligne FR épinglée par menu-client-p1-c5.test.ts:246) ; confirmations/erreurs des formulaires et
//   annonce des nouveaux tampons traduites ; historique traduit à l'affichage par type (contrat testé) ;
//   expiration datée traduite par un adaptateur (l'appel texteExpiration(…) est conservé, épinglé par
//   carte-pwa-p1-c3.test.ts:312) ; #/desinscription et #/confidentialite bilingues (langue mémorisée,
//   sans commutateur) — la caisse reste en français par conception (clés présentes, inactives).
// - contrastes : le gris retenu est le gris-600 (6,94:1 sur fond clair), plus fort que la suggestion
//   de l'audit (4,99:1) ; le gris-500 ne reste qu'en placeholder / désactivé / rail d'interrupteur
//   (contrôle par occurrence, pas par comptage de lignes) ;
// - tailles : contrôle des font-size des feuilles CSS (pas seulement des classes TSX).
// - bundle (P2-Q2) : le dictionnaire initial dépassait le seuil de 80 % du bundle d'avant découpe
//   (+8 601 o, dictionnaire + code) — 19 clés des pages différées (#/desinscription, #/confidentialite,
//   badges de #/menu) sont enregistrées par enregistrerTraductions() au chargement de leur page, et les
//   8 étapes « Garder ma carte » sont choisies par la langue (etapesEcranAccueilLangue), hors
//   dictionnaire. Le test de couverture lit le dictionnaire effectif (initial + enregistrées) et
//   vérifie qu'aucune clé enregistrée ne figure aussi dans le dictionnaire initial (pas de doublon).
// Résidus documentés (pas des oublis) : les données du commerce (noms de plats, libellés de lots,
// description, badge « ★ Signature », « Démo ») ne sont jamais traduites, comme les noms de plats
// (test identite-accessibilite-p2-q1) ; le corps de la politique de confidentialité est un texte légal
// (français) ; les messages d'erreur du serveur restent en français (API en français) — t() les laisse
// tels quels ; le détail « {MENTION_BADGE_DEDUIT} auprès de l’équipe » garde sa branche FR (test épinglé).
// Les .tsx/.ts sont vérifiés sur le source.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { contraste } from '../src/lib/apparence.ts'
import { TRADUCTIONS_EN } from '../src/lib/langue.ts'
import { ETAPES_VALIDATION } from '../src/lib/attenteVisite.ts'
import { ACCROCHE_GENERIQUE, ACCROCHE_LOT } from '../src/lib/mesure.ts'
import { etatSaisieContact } from '../src/lib/inscriptionJeu.ts'
import { libelleBoutonAvis, libelleNote } from '../src/lib/invitationAvis.ts'
import { LIBELLES_BADGES, MENTION_BADGE_DEDUIT } from '../src/lib/menuClient.ts'
import { etapesEcranAccueil, etapesEcranAccueilLangue } from '../src/lib/animationRoue.ts'
import { historiqueCarte, type LotHistorique } from '../src/lib/carte.ts'
import type { Client } from '../src/types.ts'

const RACINE = join(import.meta.dirname, '..')
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), 'utf8')

function fichiers(dossier: string, ext: RegExp): string[] {
  return readdirSync(join(RACINE, dossier), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => relative(RACINE, join(e.parentPath, e.name)))
}
const SOURCES = fichiers('src', /\.(ts|tsx)$/)
/** Seuls les fichiers qui utilisent le crochet de langue appellent la fonction de traduction t(). */
const SOURCES_TRADUITES = SOURCES.filter((f) => lire(f).includes('useLangue'))

// ---------- Constantes chaînes du code (résolution de t(CONSTANTE)) ----------

/** Valeurs des `const NOM = '…'` (une ligne) de tout src/ : t(TEXTE_…) les utilise comme clés. */
function constsChaines(): Map<string, string> {
  const consts = new Map<string, string>()
  for (const f of SOURCES) {
    const s = lire(f)
    for (const m of s.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*'((?:[^'\\\n]|\\.)*)'/g)) {
      consts.set(m[1], m[2].replace(/\\(.)/g, '$1'))
    }
    for (const m of s.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*"((?:[^"\\\n]|\\.)*)"/g)) {
      consts.set(m[1], m[2].replace(/\\(.)/g, '$1'))
    }
  }
  return consts
}
const CONSTS = constsChaines()

// ---------- Traductions enregistrées par les pages différées (P2-Q1, bundle P2-Q2) ----------

/** Paires 'FR': 'EN' des blocs `enregistrerTraductions({...})` de tout src/ (pages différées). */
function traductionsEnregistrees(): Map<string, string> {
  const enregistrees = new Map<string, string>()
  const motif = /'((?:[^'\\\n]|\\.)*)'\s*:\s*'((?:[^'\\\n]|\\.)*)'/g
  for (const f of SOURCES) {
    const s = lire(f)
    let pos = s.indexOf('enregistrerTraductions({')
    while (pos !== -1) {
      const debut = s.indexOf('{', pos)
      // Fin de l'objet : accolade fermante au même niveau (chaînes exclues par finChaine/finGabarit).
      let profondeur = 0
      let i = debut
      let fin = -1
      while (i < s.length) {
        const c = s[i]
        if (c === "'" || c === '"') {
          const finChaineIdx = finChaine(s, i)
          i = finChaineIdx === -1 ? s.length : finChaineIdx + 1
          continue
        }
        if (c === '`') {
          const finGabaritIdx = finGabarit(s, i)
          i = finGabaritIdx === -1 ? s.length : finGabaritIdx + 1
          continue
        }
        if (c === '{') profondeur++
        if (c === '}') {
          profondeur--
          if (profondeur === 0) {
            fin = i
            break
          }
        }
        i++
      }
      if (fin === -1) break
      for (const m of s.slice(debut, fin + 1).matchAll(motif)) {
        enregistrees.set(m[1].replace(/\\(.)/g, '$1'), m[2].replace(/\\(.)/g, '$1'))
      }
      pos = s.indexOf('enregistrerTraductions({', fin + 1)
    }
  }
  return enregistrees
}
const ENREGISTREES = traductionsEnregistrees()
/** Dictionnaire effectif : dictionnaire initial + traductions des pages différées. */
const TRADUCTIONS: Record<string, string> = { ...TRADUCTIONS_EN, ...Object.fromEntries(ENREGISTREES) }

// ---------- Textes affichables : littéraux, gabarits, textes JSX (vouvoiement) ----------

/** Index de fin d'une chaîne '…' / "…" (i sur le guillemet ouvrant) ; -1 si non terminée. */
function finChaine(source: string, i: number): number {
  const q = source[i]
  let j = i + 1
  while (j < source.length && source[j] !== q) {
    if (source[j] === '\\') j++
    if (source[j] === '\n') return -1
    j++
  }
  return j < source.length ? j : -1
}

/** Index de fin d'un gabarit `…` (i sur l'accent grave) ; -1 si non terminé. */
function finGabarit(source: string, i: number): number {
  let j = i + 1
  while (j < source.length && source[j] !== '`') {
    if (source[j] === '\\') {
      j += 2
      continue
    }
    if (source[j] === '$' && source[j + 1] === '{') {
      let d = 0
      j += 2
      while (j < source.length) {
        const c = source[j]
        if (c === "'" || c === '"' || c === '`') {
          const fin = c === '`' ? finGabarit(source, j) : finChaine(source, j)
          j = fin === -1 ? source.length : fin + 1
          continue
        }
        if (c === '{') d++
        if (c === '}') {
          if (d === 0) break
          d--
        }
        j++
      }
      j++
      continue
    }
    j++
  }
  return j < source.length ? j : -1
}

function decoderChaine(avecGuillemets: string): string {
  return avecGuillemets
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\(.)/g, '$1')
}

/** Segments de texte JSX brut d'un bloc (entre > et <), expressions {…} retirées. */
function segmentsJsx(bloc: string): string[] {
  const sortis: string[] = []
  for (const ligne of bloc.split('\n')) {
    for (const m of ligne.matchAll(/>([^<>]+)</g)) {
      let seg = m[1]
      for (let k = 0; k < 6 && /\{[^{}]*\}/.test(seg); k++) seg = seg.replace(/\{\s*[^{}]*\}/g, ' ')
      seg = seg.trim()
      if (!seg || /&&|\|\||=>|;|=/.test(seg)) continue
      if (!/[A-Za-zÀ-ÿ]{2,}/.test(seg)) continue
      sortis.push(seg)
    }
  }
  return sortis
}

/** Tous les textes affichables d'un fichier : littéraux '…' "…", parties statiques des gabarits `…`,
 *  textes JSX bruts. Commentaires et code exclus. */
function textesAffichables(source: string): string[] {
  const textes: string[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const fin = source.indexOf('*/', i + 2)
      i = fin === -1 ? source.length : fin + 2
      continue
    }
    if ((c === "'" || c === '"') && estDebutChaine(source, i)) {
      const fin = finChaine(source, i)
      if (fin === -1) {
        i++
        continue
      }
      textes.push(decoderChaine(source.slice(i, fin + 1)))
      i = fin + 1
      continue
    }
    if (c === '`') {
      const fin = finGabarit(source, i)
      if (fin === -1) {
        i++
        continue
      }
      const brut = source.slice(i + 1, fin)
      textes.push(brut.replace(/\$\{[^{}]*\}/g, ' '))
      i = fin + 1
      continue
    }
    i++
  }
  return [...textes, ...segmentsJsx(source)]
}

// ---------- Détecteur de tutoiement ----------

/** Frontière Unicode explicite : \b est ASCII en JS et couperait « complètes » avant « tes ». */
const PRONOMS_TUTOIEMENT = /(?<![\p{L}\p{N}_])(tu|toi|ton|ta|tes|t'as|t'es|t'y)(?![\p{L}\p{N}_])/iu
const IMPERATIFS_SINGULIER = [
  'Saisis', 'Choisis', 'Valide', 'Clique', 'Regarde', 'Essaie', 'Tourne', 'Scanne', 'Reviens', 'Donne', 'Garde', 'Prends', 'Tiens',
  'Vas', 'Viens', 'Patiente', 'Recharge', 'Confirme', 'Remplis', 'Renseigne', 'Montre', 'Ouvre', 'Inscris', 'Connecte', 'Supprime',
  'Modifie', 'Ajoute', 'Retire', 'Partage', 'Envoie', 'Écris', 'Réessaie', 'Recommence',
]
/** Titres nominaux d'un mot, pas des phrases (ex. section « Partage » de la politique de confidentialité). */
const TITRES_NOMINAUX_AUTORISES = ['Partage']

function phrases(texte: string): string[] {
  return texte
    .replace(/’/g, "'")
    .split(/[.!?…:;]\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Vrai si le texte contient un tutoiement : pronom (tu/toi/ton/ta/tes/t'as/t'es) ou impératif singulier
 *  en début de phrase. L'apostrophe typographique ’ vaut l'apostrophe droite. L'impératif est
 *  sensible à la casse : un fragment en minuscules (« saisis dans l’app », aide d'un chiffre) est
 *  un participe passé en milieu de phrase, pas un impératif — les phrases de l'app commencent
 *  toutes par une majuscule ; un impératif minuscule en début de phrase n'existe pas en base. */
function aUnTutoiement(texte: string): boolean {
  const normalise = texte.replace(/’/g, "'")
  if (PRONOMS_TUTOIEMENT.test(normalise)) return true
  return phrases(normalise).some((p) => {
    if (TITRES_NOMINAUX_AUTORISES.includes(p)) return false
    return IMPERATIFS_SINGULIER.some((v) => new RegExp(`^${v}\\b`).test(p))
  })
}

describe('P2-Q1 (vérification) : vouvoiement', () => {
  test('détecteur : positifs et négatifs connus', () => {
    for (const oui of ["t’as gagné", 't’es inscrit', 'tu peux jouer', 'Clique', 'Merci. Clique ici']) {
      assert.ok(aUnTutoiement(oui), oui)
    }
    for (const non of ['complètes', 'Partage', 'La roue tourne…', 'Saisissez un numéro (10 chiffres) ou un e-mail valide.', 'Tourner la roue et gagnez un cadeau !', 'Données stockées dans ce navigateur uniquement.', 'saisis dans l’app']) {
      assert.ok(!aUnTutoiement(non), non)
    }
  })

  test('aucun tutoiement dans les textes affichables de tout src/ (littéraux, gabarits, JSX brut)', () => {
    const fautes: string[] = []
    for (const f of SOURCES) {
      for (const texte of textesAffichables(lire(f))) {
        if (aUnTutoiement(texte)) fautes.push(`${f} : ${texte.slice(0, 100)}`)
      }
    }
    assert.deepEqual(fautes, [])
  })

  test('le vouvoiement est présent : « vous » et « Saisissez » dans les chaînes clientes', () => {
    const langue = lire('src/lib/langue.ts')
    assert.match(langue, /'Saisissez un numéro \(10 chiffres\) ou un e-mail valide\.'/)
    assert.ok(Object.keys(TRADUCTIONS).some((k) => /\bvous\b/i.test(k)), 'au moins une chaîne avec « vous »')
  })
})

// ---------- Analyse syntaxique des appels t(...) ----------

/** Extrait le 1er argument d'un appel (pos = index de '(') : texte + index de la ',' ou ')' qui le clôt. */
function extrairePremierArgument(source: string, pos: number): { arg: string; fin: number } | null {
  let profondeur = 0
  let i = pos
  while (i < source.length) {
    const c = source[i]
    if (c === "'" || c === '"') {
      const fin = finChaine(source, i)
      i = fin === -1 ? source.length : fin + 1
      continue
    }
    if (c === '`') {
      const fin = finGabarit(source, i)
      i = fin === -1 ? source.length : fin + 1
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const fin = source.indexOf('*/', i + 2)
      i = fin === -1 ? source.length : fin + 2
      continue
    }
    if (c === '(' || c === '[' || c === '{') profondeur++
    else if (c === ')' || c === ']' || c === '}') {
      profondeur--
      if (profondeur === 0) return { arg: source.slice(pos + 1, i), fin: i }
    } else if (c === ',' && profondeur === 1) return { arg: source.slice(pos + 1, i), fin: i }
    i++
  }
  return null
}

/** Découpe un ternaire a ? b : c (premier '?' de niveau 0, '?.' et '??' exclus) en ses deux branches. */
function decouperTernaire(texte: string): { alors: string; sinon: string } | null {
  let profondeur = 0
  let i = 0
  while (i < texte.length) {
    const c = texte[i]
    if (c === "'" || c === '"') {
      const fin = finChaine(texte, i)
      i = fin === -1 ? texte.length : fin + 1
      continue
    }
    if (c === '`') {
      const fin = finGabarit(texte, i)
      i = fin === -1 ? texte.length : fin + 1
      continue
    }
    if (c === '(' || c === '[' || c === '{') profondeur++
    else if (c === ')' || c === ']' || c === '}') profondeur--
    else if (c === '?' && profondeur === 0) {
      if (texte[i + 1] === '.' || texte[i + 1] === '?') {
        i += 2
        continue
      }
      let questions = 1
      let j = i + 1
      while (j < texte.length) {
        const d = texte[j]
        if (d === "'" || d === '"') {
          const fin = finChaine(texte, j)
          j = fin === -1 ? texte.length : fin + 1
          continue
        }
        if (d === '`') {
          const fin = finGabarit(texte, j)
          j = fin === -1 ? texte.length : fin + 1
          continue
        }
        if (d === '(' || d === '[' || d === '{') profondeur++
        else if (d === ')' || d === ']' || d === '}') profondeur--
        else if (d === '?' && profondeur === 0) {
          if (texte[j + 1] === '.' || texte[j + 1] === '?') {
            j += 2
            continue
          }
          questions++
        } else if (d === ':' && profondeur === 0) {
          questions--
          if (questions === 0) return { alors: texte.slice(i + 1, j), sinon: texte.slice(j + 1) }
        }
        j++
      }
      return null
    }
    i++
  }
  return null
}

interface AnalyseT {
  cles: string[]
  expressions: string[]
  nonResolus: string[]
}

/** Un guillemet ouvre une chaîne seulement s'il ne suit pas une lettre : une apostrophe de texte JSX
 *  (`<p>L'ami</p>`) n'en est pas une — sans cette règle, le « début de chaîne » avalerait le t('…')
 *  suivant (revue Codex point 1). */
function estDebutChaine(source: string, i: number): boolean {
  return i === 0 || !/[\p{L}\p{N}_$]/u.test(source[i - 1])
}

/** Contenus des interpolations ${…} d'un gabarit (accolades équilibrées, chaînes et gabarits imbriqués
 *  respectés) — pour y chercher des t(…) récursivement. */
function extraireInterpolations(corps: string): string[] {
  const sortis: string[] = []
  let i = 0
  while (i < corps.length) {
    if (corps[i] === '$' && corps[i + 1] === '{') {
      let profondeur = 0
      let j = i + 2
      while (j < corps.length) {
        const c = corps[j]
        if (c === "'" || c === '"') {
          const fin = finChaine(corps, j)
          j = fin === -1 ? corps.length : fin + 1
          continue
        }
        if (c === '`') {
          const fin = finGabarit(corps, j)
          j = fin === -1 ? corps.length : fin + 1
          continue
        }
        if (c === '{') profondeur++
        if (c === '}') {
          if (profondeur === 0) break
          profondeur--
        }
        j++
      }
      sortis.push(corps.slice(i + 2, j))
      i = j + 1
      continue
    }
    i++
  }
  return sortis
}

/** Analyse les appels t(...) d'un fichier : clés littérales du 1er argument (ternaires imbriqués
 *  compris, gabarits reconstruits avec les constantes), expressions non littérales, cas non résolus.
 *  Les t( dans les commentaires et les chaînes sont ignorés ; les t( dans les interpolations ${…}
 *  (même imbriquées) sont analysés récursivement. */
function analyserT(source: string): AnalyseT {
  const cles: string[] = []
  const expressions: string[] = []
  const nonResolus: string[] = []

  function reconstruireGabarit(texte: string): string | null {
    const corps = texte.slice(1, -1)
    let ok = true
    const reconstruit = corps.replace(/\$\{([^{}]*)\}/g, (_tout, dedans: string) => {
      const nom = dedans.trim()
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(nom) && CONSTS.has(nom)) return CONSTS.get(nom)!
      ok = false
      return ''
    })
    return ok ? reconstruit : null
  }

  function traiterPremierArg(arg: string): void {
    const texte = arg.trim()
    if (!texte) {
      nonResolus.push('appel t() sans argument')
      return
    }
    const ternaire = decouperTernaire(texte)
    if (ternaire) {
      traiterPremierArg(ternaire.alors)
      traiterPremierArg(ternaire.sinon)
      return
    }
    if ((texte.startsWith("'") && texte.endsWith("'")) || (texte.startsWith('"') && texte.endsWith('"'))) {
      if (texte.length < 2) {
        nonResolus.push(`chaîne vide : ${texte}`)
        return
      }
      cles.push(decoderChaine(texte))
      return
    }
    if (texte.startsWith('`') && texte.endsWith('`')) {
      const reconstruit = reconstruireGabarit(texte)
      if (reconstruit === null) nonResolus.push(`gabarit non résolu : ${texte.slice(0, 80)}`)
      else cles.push(reconstruit)
      return
    }
    if (texte.startsWith('(') && texte.endsWith(')')) {
      traiterPremierArg(texte.slice(1, -1))
      return
    }
    expressions.push(texte)
  }

  function parcourir(fragment: string): void {
    let i = 0
    while (i < fragment.length) {
      const c = fragment[i]
      if (c === '/' && fragment[i + 1] === '/') {
        while (i < fragment.length && fragment[i] !== '\n') i++
        continue
      }
      if (c === '/' && fragment[i + 1] === '*') {
        const fin = fragment.indexOf('*/', i + 2)
        i = fin === -1 ? fragment.length : fin + 2
        continue
      }
    if ((c === "'" || c === '"') && estDebutChaine(fragment, i)) {
      const fin = finChaine(fragment, i)
      i = fin === -1 ? fragment.length : fin + 1
      continue
    }
    if (c === '`') {
      const fin = finGabarit(fragment, i)
      if (fin !== -1) {
        for (const contenu of extraireInterpolations(fragment.slice(i + 1, fin))) parcourir(contenu)
        i = fin + 1
        continue
      }
      i++
      continue
    }
    if (/[\p{L}_$]/u.test(c)) {
      const debut = i
      while (i < fragment.length && /[\p{L}\p{N}_$]/u.test(fragment[i])) i++
      if (fragment.slice(debut, i) === 't') {
        let j = i
        while (j < fragment.length && /\s/.test(fragment[j])) j++
        if (fragment[j] === '(') {
          const ext = extrairePremierArgument(fragment, j)
          if (ext) {
            traiterPremierArg(ext.arg)
            i = ext.fin
            continue
          }
        }
      }
      continue
    }
    i++
    }
  }

  parcourir(source)
  return { cles, expressions, nonResolus }
}

/** Littéraux passés en titre / enfants à MessagePublic (traduits par le composant lui-même).
 *  Seuls les enfants CHAÎNE sont traduits (MessagePublic : `typeof children === 'string' ? t(children)`) :
 *  un enfant avec balises imbriquées (<p>, <button>) ou interpolation {…} n'est pas traduit — il doit
 *  passer par t() dans la page (cas #/desinscription, corrigé). */
function litterauxMessagePublic(): string[] {
  const trouves: string[] = []
  for (const f of SOURCES) {
    const s = lire(f)
    for (const m of s.matchAll(/<MessagePublic\b([^>]*)>([\s\S]*?)<\/MessagePublic>/g)) {
      const titre = /titre=(?:"([^"]+)"|\{'([^']+)'\})/.exec(m[1])
      if (titre) trouves.push(titre[1] ?? titre[2])
      const enfants = m[2]
      if (!enfants.includes('<') && !enfants.includes('{')) {
        const texte = enfants.replace(/\s+/g, ' ').trim()
        if (texte) trouves.push(texte)
      }
      for (const id of enfants.matchAll(/\{([A-Z_][A-Z0-9_]*)\}/g)) {
        if (CONSTS.has(id[1])) trouves.push(CONSTS.get(id[1])!)
      }
    }
  }
  return trouves
}

/** Littéraux passés en texte à Traduit (traduits par le composant lui-même). */
function litterauxTraduit(): string[] {
  const trouves: string[] = []
  for (const f of SOURCES) {
    const s = lire(f)
    for (const m of s.matchAll(/<Traduit\b[^>]*texte=(?:"([^"]+)"|\{'([^']+)'\}|\{([A-Za-z_$][A-Za-z0-9_$]*)\})/g)) {
      if (m[1] ?? m[2]) trouves.push(m[1] ?? m[2])
      else if (CONSTS.has(m[3])) trouves.push(CONSTS.get(m[3])!)
    }
  }
  return trouves
}

/** Tous les messages affichables de la saisie du contact (dynamiques compris : « N chiffre(s) sur 10 »).
 *  Formes atteignables : 0–9 chiffres (« + » seul donne « 0 chiffre sur 10 » ; 10–13 chiffres forment
 *  déjà un numéro valide), e-mail incomplet / invalide (espace ou double @), numéro invalide (« 06/12 »). */
function messagesSaisie(): string[] {
  const entrees = ['', '   ', '+', '06 12', '06 12 34 56 78', '06 12 34 56 78 90 12 34', '06/12', 'marie@', 'a@b@c', 'marie @exemple.fr', 'marie@exemple.fr', 'marie']
  for (let n = 1; n <= 13; n++) entrees.push('0'.repeat(n))
  const messages = new Set<string>()
  for (const e of entrees) {
    for (const essaye of [false, true]) {
      const message = etatSaisieContact(e, essaye).message
      if (message) messages.add(message)
    }
  }
  return [...messages]
}

/** Clés anglaises utilisées + problèmes rencontrés (appel non résolu, expression inconnue). */
function clesUtilisees(): { utilisees: Set<string>; problemes: string[] } {
  const utilisees = new Set<string>()
  const problemes: string[] = []
  for (const f of SOURCES_TRADUITES) {
    const a = analyserT(lire(f))
    for (const cle of a.cles) utilisees.add(cle)
    for (const expr of a.expressions) {
      if (CONSTS.has(expr)) {
        utilisees.add(CONSTS.get(expr)!)
        continue
      }
      if (expr === 'accroche.modele') {
        utilisees.add(ACCROCHE_GENERIQUE)
        utilisees.add(ACCROCHE_LOT)
        continue
      }
      if (expr === 'etape') {
        for (const e of ETAPES_VALIDATION) utilisees.add(e)
        continue
      }
      if (expr === 'saisie.message') {
        for (const m of messagesSaisie()) utilisees.add(m)
        continue
      }
      if (expr === 'titre' || expr === 'children') {
        for (const l of litterauxMessagePublic()) utilisees.add(l)
        continue
      }
      if (expr === 'texte') {
        for (const l of litterauxTraduit()) utilisees.add(l)
        if (f === 'src/components/CarteFidelite.tsx') {
          // expirationLot : t(texte) où texte est une forme de texteExpiration(…) — les deux formes
          // fixes et le modèle de la forme datée.
          utilisees.add('Sans date limite')
          utilisees.add('Valable aujourd’hui seulement')
          utilisees.add('Valable jusqu’au {date}')
        }
        continue
      }
      if (/^libelleBoutonAvis\(note\)$/.test(expr) || /^libelleNote\(note\)$/.test(expr)) {
        for (let n = 1; n <= 5; n++) {
          utilisees.add(libelleBoutonAvis(n))
          utilisees.add(libelleNote(n))
        }
        continue
      }
      if (expr === 'LIBELLES_BADGES[b]') {
        for (const v of Object.values(LIBELLES_BADGES)) utilisees.add(v)
        continue
      }
      // L'expression « e » (étapes « Garder ma carte ») n'existe plus : les étapes sont choisies par
      // la langue dans etapesEcranAccueilLangue() (hors dictionnaire, P2-Q2) — pas de t(e) à résoudre.
      if (f === 'src/pages/CartePublique.tsx' && expr === 'message') {
        // Confirmations des formulaires du programme : les deux seuls messages posés par setMessage.
        utilisees.add('Merci, votre profil est à jour !')
        utilisees.add('Demande envoyée : le restaurant la validera et votre visite sera créditée.')
        continue
      }
      if (f === 'src/pages/CartePublique.tsx' && expr === 'erreur') {
        // Erreurs des formulaires : seuls les deux libellés clients sont traduits ; les messages
        // d'erreur du serveur (err.message) restent en français (API en français, hors P2-Q1) —
        // t() les laisse tels quels (repli français du dictionnaire).
        utilisees.add('Indiquez la date de la visite et le montant payé.')
        utilisees.add('Envoi impossible pour le moment.')
        continue
      }
      if (f === 'src/pages/CartePublique.tsx' && expr === 'm[2]') {
        // Statuts des lots dans libelleHistorique (adaptateur d'historique) : les trois suffixes.
        utilisees.add('retiré')
        utilisees.add('non retiré, expiré')
        utilisees.add('à retirer aujourd’hui')
        continue
      }
      problemes.push(`${f} : expression t() non résolue : ${expr}`)
    }
    for (const nr of a.nonResolus) problemes.push(`${f} : ${nr}`)
  }
  return { utilisees, problemes }
}

describe('P2-Q1 (vérification) : couverture anglaise sur tout src/', () => {
  test('chaque t(…) de tout src/ a sa traduction anglaise (1er argument analysé, ternaires compris)', () => {
    const { utilisees, problemes } = clesUtilisees()
    assert.deepEqual(problemes, [])
    const manquantes = [...utilisees].filter((k) => !(k in TRADUCTIONS))
    assert.deepEqual(manquantes, [])
  })

  test('traductions différées : enregistrées hors du dictionnaire initial, sans doublon', () => {
    // P2-Q2 : le déplacement ne vaut que si les clés ne sont plus dans le dictionnaire initial.
    assert.ok(ENREGISTREES.size >= 19, `clés enregistrées : ${ENREGISTREES.size}`)
    for (const k of ENREGISTREES.keys()) {
      assert.ok(!(k in TRADUCTIONS_EN), `clé en double dans TRADUCTIONS_EN : ${k}`)
      assert.ok(ENREGISTREES.get(k)!.trim(), `traduction vide : ${k}`)
    }
    // Les clés enregistrées sont bien celles des pages différées (et aucune autre).
    const cles = [...ENREGISTREES.keys()]
    assert.ok(cles.includes('Désinscription'), 'désinscription enregistrée')
    assert.ok(cles.includes('‹ Retour'), 'confidentialité enregistrée')
    assert.ok(cles.includes('🌶 Épicé'), 'badges enregistrés')
    assert.ok(cles.includes('Ce lien ne correspond à aucun commerce.'), 'lien commun enregistré')
  })

  test('étapes « Garder ma carte » : FR identique à etapesEcranAccueil, EN traduite', () => {
    // P2-Q1/P2-Q2 : les étapes sont choisies par la langue (hors dictionnaire) — le FR ne doit pas
    // dériver de la fonction de référence (épinglée par roulette-p1-c2.test.ts), et l'EN doit
    // mentionner le bon navigateur (Safari iOS, Chrome Android).
    for (const p of ['ios', 'android', 'autre'] as const) {
      assert.deepEqual(etapesEcranAccueilLangue(p, 'fr'), etapesEcranAccueil(p))
      const en = etapesEcranAccueilLangue(p, 'en')
      assert.equal(en.length, etapesEcranAccueil(p).length, `même nombre d'étapes (${p})`)
      assert.ok(en[0].startsWith('Open your card with the button below'), `1re étape EN (${p})`)
    }
    assert.ok(etapesEcranAccueilLangue('ios', 'en').join(' ').includes('Safari'))
    assert.ok(etapesEcranAccueilLangue('android', 'en').join(' ').includes('Chrome'))
  })

  test('analyseur : cas limites (apostrophe JSX, interpolation imbriquée, commentaire)', () => {
    // Revue Codex point 1 : une apostrophe de texte JSX avalait le t('…') suivant ; un t(…) dans une
    // interpolation imbriquée ${fn({x: t('…')})} échappait au contrôle.
    assert.deepEqual(analyserT(`<p>L'ami</p><p>{t('Réel')}</p>`).cles, ['Réel'])
    assert.deepEqual(analyserT('`Total : ${fn({ x: t(\'Réel\') })}`').cles, ['Réel'])
    assert.deepEqual(analyserT(`<p>l’app</p>`).cles, [])
    assert.deepEqual(analyserT(`// t('Faux')\n/* t('Faux aussi') */\nconst x = t('Vrai')`).cles, ['Vrai'])
    assert.deepEqual(analyserT(`const t = (l: { x: number }) => l.x\nlots.sort((a, b) => t(a) - t(b))`).cles, [])
  })

  test('messages dynamiques traduits : saisie, accroche A/B, étapes, badges, mention', () => {
    for (const m of messagesSaisie()) assert.ok(m in TRADUCTIONS, `saisie : ${m}`)
    for (const a of [ACCROCHE_GENERIQUE, ACCROCHE_LOT]) assert.ok(a in TRADUCTIONS, `accroche : ${a}`)
    for (const e of ETAPES_VALIDATION) assert.ok(e in TRADUCTIONS, `étape : ${e}`)
    for (const v of Object.values(LIBELLES_BADGES)) assert.ok(v in TRADUCTIONS, `badge : ${v}`)
    assert.ok(MENTION_BADGE_DEDUIT in TRADUCTIONS, `mention : ${MENTION_BADGE_DEDUIT}`)
    for (const l of litterauxMessagePublic()) assert.ok(l in TRADUCTIONS, `MessagePublic : ${l}`)
    for (const l of litterauxTraduit()) assert.ok(l in TRADUCTIONS, `Traduit : ${l}`)
  })

  test('historique : contrat entre les libellés FR de historiqueCarte() et leur adaptateur d’affichage', () => {
    // Revue Codex point 5 : libelleHistorique() (CartePublique) découpe les libellés FR par type —
    // ce test casse si historiqueCarte() change de formulation (le préfixe ne correspondrait plus).
    const client = {
      visites: ['2026-11-08T12:00:00Z'],
      recompensesOffertes: [{ date: '2026-11-05T12:00:00Z', libelle: 'Plat offert' }],
      echangesPoints: [{ date: '2026-11-06T12:00:00Z', libelle: 'Thé glacé', cout: 50 }],
      defisReussis: [{ date: '2026-11-07T12:00:00Z', recompense: 'Maki offert' }],
    } as unknown as Client
    const lots: LotHistorique[] = [
      { lot: 'Nems offerts', date: '2026-11-09T12:00:00Z', statut: 'expire' },
      { lot: 'Thé glacé', date: '2026-11-03T12:00:00Z', statut: 'remis' },
    ]
    const lignes = historiqueCarte(client, lots)
    const parType = new Map(lignes.map((l) => [l.type, l.libelle]))
    assert.equal(parType.get('visite'), 'Visite validée (+1 tampon)')
    assert.ok(parType.get('recompense')?.startsWith('Récompense remise : '))
    assert.ok(parType.get('defi')?.startsWith('Défi réussi : '))
    assert.ok(parType.get('echange')?.endsWith(' (−50 points)'))
    assert.match(parType.get('roue') ?? '', /^Roue : .* \((retiré|non retiré, expiré|à retirer aujourd’hui)\)$/)
    assert.ok(lignes.some((l) => l.libelle === 'Roue : Thé glacé (retiré)'))
    assert.ok(lignes.some((l) => l.libelle === 'Roue : Nems offerts (non retiré, expiré)'))
    // Les fragments traduits par l'adaptateur existent en anglais.
    for (const k of ['Visite validée (+1 tampon)', 'Récompense remise : {libelle}', 'Défi réussi : {recompense}', 'Roue : {lot} ({statut})', 'retiré', 'non retiré, expiré', 'à retirer aujourd’hui']) {
      assert.ok(k in TRADUCTIONS, k)
    }
  })

  test('chaque clé du dictionnaire effectif est utilisée (aucune clé orpheline, aucune traduction vide)', () => {
    const { utilisees, problemes } = clesUtilisees()
    assert.deepEqual(problemes, [])
    const cles = Object.keys(TRADUCTIONS)
    for (const k of cles) assert.ok(TRADUCTIONS[k].trim(), `traduction vide : ${k}`)
    const orphelines = cles.filter((k) => !utilisees.has(k))
    assert.deepEqual(orphelines, [])
  })

  test('seul le tri local de lib/carte.ts utilise un t() qui n’est pas la traduction', () => {
    // Dans src/lib/carte.ts, t est une clé de tri locale (lots triés par expiration), pas la fonction
    // de traduction — le fichier n'utilise pas useLangue. Tout autre fichier avec un appel t(…)
    // doit passer par le crochet de langue (sinon l'analyse ci-dessus le manquerait).
    const horsTraduction: string[] = []
    for (const f of SOURCES) {
      if (SOURCES_TRADUITES.includes(f)) continue
      const src = lire(f)
      // Comptage naïf (commentaires et chaînes exclus par l'analyseur) : un appel suffit à signaler.
      if (analyserT(src).cles.length + analyserT(src).expressions.length + analyserT(src).nonResolus.length > 0) {
        horsTraduction.push(f)
      }
    }
    assert.deepEqual(horsTraduction, ['src/lib/carte.ts'])
  })
})

describe('P2-Q1 (vérification) : contrastes du gris retenu', () => {
  test('gris-600 sur ivoire (fond de carte) ≥ 4,5:1 ; plus fort que la suggestion de l’audit', () => {
    // Suggestion AUDIT §2.5 : gris #5F6B7A = 4,99:1 sur fond clair — elle passe, mais le gris-600
    // Tailwind déjà utilisé partout vaut 6,94:1 sur le même fond : le choix retenu est plus lisible.
    // Chiffres calculés sur les hex ; Tailwind 4 définit ces gris en OKLCH (écart d'environ 0,01 au plus).
    assert.ok(contraste('#5f6b7a', '#f7f5f2') >= 4.5, 'suggestion de l’audit')
    assert.ok(contraste('#4b5563', '#f7f5f2') > contraste('#5f6b7a', '#f7f5f2'), 'gris-600 plus fort que la suggestion')
    assert.ok(contraste('#4b5563', '#fbf8f3') >= 4.5, 'gris-600 sur ivoire (fond de carte)')
    assert.ok(contraste('#4b5563', '#ffffff') >= 4.5, 'gris-600 sur blanc')
  })

  test('gris-500 : chaque occurrence est un placeholder, un désactivé ou le rail d’interrupteur', () => {
    const occurrences: string[] = []
    for (const f of [...SOURCES, 'src/index.css']) {
      for (const [i, l] of lire(f).split('\n').entries()) {
        if (l.includes('gray-500')) occurrences.push(`${f}:${i + 1}: ${l.trim()}`)
      }
    }
    assert.ok(occurrences.length > 0, 'au moins un usage de gris-500 à contrôler')
    for (const o of occurrences) {
      assert.match(
        o,
        /placeholder:text-gray-500|disabled:(text|bg)-gray-500|actif \? 'bg-magenta-500' : 'bg-gray-500'/,
        `usage de gris-500 non classé : ${o}`,
      )
    }
    assert.ok(contraste('#6b7280', '#ffffff') >= 4.5, 'placeholder sur blanc : 4,83:1')
    assert.ok(contraste('#6b7280', '#ffffff') >= 3, 'rail d’interrupteur (composant non textuel, seuil 3:1)')
  })
})

describe('P2-Q1 (vérification) : tailles minimales hors TSX', () => {
  test('aucune taille de police < 12 px dans les feuilles CSS et index.html', () => {
    for (const f of ['src/index.css', 'src/chargement.css', 'public/hors-ligne.css', 'index.html']) {
      const css = lire(f)
      for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) {
        const px = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]) // rem × 16 px (racine par défaut, conservateur)
        assert.ok(px >= 12, `${f} : font-size ${m[1]}${m[2]} = ${px} px`)
      }
      for (const m of css.matchAll(/text-\[([\d.]+)(px|rem)\]/g)) {
        const px = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1])
        assert.ok(px >= 12, `${f} : text-[${m[1]}${m[2]}] = ${px} px`)
      }
    }
  })
})
