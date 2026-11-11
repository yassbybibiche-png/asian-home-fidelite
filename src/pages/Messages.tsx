import { useCallback, useEffect, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, messageErreur, useAction, useDonneesCommerce, useStore } from '../store'
import type { MessageCommercant } from '../data/api'
import { CIBLES, clientsCibles, texteCible, TYPES_MESSAGES, type Cible } from '../lib/messages'
import { etatRelances, MENTION_ENVOI } from '../lib/integrations'
import { libelleModele, libelleStatutEnvoi } from '../lib/relances'
import { texteEtContacts } from '../lib/ecransCommercant'
import { dateRelative } from '../lib/format'
import type { EnvoiRelance } from '../types'
import { BoutonCopier, EnTete, MessageErreur, Vide } from '../components/ui'

const LIBELLE_TYPE: Record<string, string> = { ...Object.fromEntries(TYPES_MESSAGES.map((t) => [t.type, t.libelle])), commercant: 'Message du commerce' }

const COULEUR_STATUT: Record<EnvoiRelance['statut'], string> = {
  envoye: 'bg-green-100 text-green-900',
  en_cours: 'bg-amber-100 text-amber-900',
  refuse: 'bg-gray-200 text-gray-800',
  erreur: 'bg-red-100 text-red-900',
  non_branche: 'bg-gray-200 text-gray-800',
  test: 'bg-violet-100 text-violet-900',
}

/** Journal des envois de relances (qui, quand, modèle, canal, statut) — partagé avec la fiche client. */
export function JournalEnvois({ envois, avecClient = true }: { envois: EnvoiRelance[]; avecClient?: boolean }) {
  if (!envois.length) return <p className="text-sm text-gray-600">Aucune relance tentée pour l’instant.</p>
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {envois.slice(0, 50).map((e) => (
        <li key={e.id} className="space-y-0.5 py-2">
          <p className="flex justify-between gap-3">
            <span>
              {avecClient && (
                <>
                  <a href={`#/client/${e.clientId}`} className="font-semibold text-gray-900 underline decoration-gray-300 underline-offset-4">
                    {e.clientPrenom}
                  </a>{' '}
                  ·{' '}
                </>
              )}
              {libelleModele(e.modele)} · {e.canal === 'sms' ? 'SMS' : 'E-mail'}
            </span>
            <span className="shrink-0 text-gray-600" title={new Date(e.date).toLocaleString('fr-FR')}>
              {dateRelative(e.date)}
            </span>
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${COULEUR_STATUT[e.statut]}`}>{libelleStatutEnvoi(e.statut)}</span>
            <span>{e.declencheur === 'auto' ? 'Automatique' : e.auteur}</span>
            {e.raison && e.statut !== 'envoye' && <span>— {e.raison}</span>}
          </p>
        </li>
      ))}
    </ul>
  )
}

/** Relances SMS / e-mail (P1-B3) : état réel des prestataires, relances automatiques, journal des envois. */
function RelancesSmsEmail() {
  const { api, avecPin } = useStore()
  const { commerce, envois } = useDonneesCommerce()
  const { executer, enCours, erreur } = useAction()
  const [statut, setStatut] = useState<{ sms?: boolean; email?: boolean; migration?: boolean; modeTest?: boolean } | null>(null)
  const regles = commerce.relancesAuto ?? { inactif: false, anniversaire: false }

  useEffect(() => {
    if (!api) return
    api.sante().then(
      (s) => setStatut({ sms: !!s.integrations?.sms, email: !!s.integrations?.email, migration: s.migrations?.relances, modeTest: !!s.integrations?.modeTest }),
      () => setStatut(null),
    )
  }, [api])

  const basculer = (cle: 'inactif' | 'anniversaire', valeur: boolean) =>
    executer(() => avecPin((a, api) => api.majCommerce(commerce.id, a, { relancesAuto: { ...regles, [cle]: valeur } })))

  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Relances SMS / e-mail</h2>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700">
        {etatRelances(statut).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="text-sm text-gray-600">
        {MENTION_ENVOI}. Le client se désinscrit par le lien de l’e-mail, en répondant STOP au SMS quand il vient d’un numéro, ou auprès du commerçant ; vous pouvez aussi retirer son consentement sur sa fiche.
      </p>
      <fieldset className="space-y-2 border-t border-gray-100 pt-3">
        <legend className="etiquette">Relances automatiques (à l’ouverture du tableau de bord, une fois par jour)</legend>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-gray-700">
          <span className="zone-case">
            <input type="checkbox" className="case-a-cocher" checked={regles.inactif} disabled={enCours} onChange={(e) => void basculer('inactif', e.target.checked)} />
          </span>
          <span>« Vous nous manquez » aux clients inactifs depuis 30 jours</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-gray-700">
          <span className="zone-case">
            <input type="checkbox" className="case-a-cocher" checked={regles.anniversaire} disabled={enCours} onChange={(e) => void basculer('anniversaire', e.target.checked)} />
          </span>
          <span>Message d’anniversaire (si la date est renseignée)</span>
        </label>
        <p className="text-sm text-gray-600">Seulement vers les clients qui ont consenti, et seulement si le prestataire du canal est configuré.</p>
      </fieldset>
      <MessageErreur>{erreur}</MessageErreur>
      <div className="border-t border-gray-100 pt-3">
        <h3 className="etiquette">Journal des envois</h3>
        <JournalEnvois envois={envois} />
      </div>
    </section>
  )
}

/** Messagerie : messages automatiques (règles dans Réglages) + message ciblé déposé dans l'espace client, texte prêt à copier. */
export default function Messages() {
  const { mode, avecPin, api, acces } = useStore()
  const { commerce, clients } = useDonneesCommerce()
  const [cible, setCible] = useState<Cible>('inactifs')
  const [texte, setTexte] = useState(() => texteCible('inactifs', commerce))
  const { executer, enCours, erreur } = useAction()
  const [annonce, setAnnonce] = useState('')
  const [recents, setRecents] = useState<MessageCommercant[] | null>(null)
  const [erreurListe, setErreurListe] = useState<string | null>(null)
  const cibles = clientsCibles(clients, commerce, cible, new Date())
  const actives = TYPES_MESSAGES.filter((t) => commerce.messagesAuto?.[t.type])

  // Lecture seule : appel direct (sans rechargement complet de l'état derrière).
  const chargerRecents = useCallback(() => {
    if (!api || !acces) return
    api.messages(commerce.id, acces).then(
      (m) => (setRecents(m), setErreurListe(null)),
      (e) => setErreurListe(messageErreur(e)),
    )
  }, [api, acces, commerce.id])

  useEffect(() => {
    chargerRecents()
  }, [chargerRecents])

  if (mode === 'local') {
    return (
      <div>
        <EnTete titre="Messages" />
        <Vide>{MESSAGE_MODE_SERVEUR}</Vide>
      </div>
    )
  }

  async function deposer() {
    if (!window.confirm(`Déposer ce message dans l’espace client de ${cibles.length} client(s) ?`)) return
    const r = await executer(() => avecPin((a, api) => api.envoyerMessage(commerce.id, a, cible, texte.trim())))
    if (r.ok) {
      setAnnonce(`✓ Message déposé dans l’espace client de ${r.valeur} client(s) : ils le verront à la prochaine ouverture de leur carte.`)
      chargerRecents()
    }
  }

  const contacts = cibles.map((c) => c.telephone ?? c.email ?? '')

  return (
    <div className="space-y-5">
      <EnTete titre="Messages" sousTitre="Les messages s’affichent dans l’espace client (sur sa carte). Le texte est aussi prêt à copier." />

      <section className="carte space-y-2">
        <h2 className="titre-carte">Messages automatiques</h2>
        {actives.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700">
            {actives.map((t) => (
              <li key={t.type}>
                <strong>{t.libelle}</strong> — {t.aide}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">Aucune règle activée.</p>
        )}
        <a href="#/reglages" className="lien">
          Choisir les règles dans Réglages
        </a>
      </section>

      <section className="carte space-y-3">
        <h2 className="titre-carte">Message ciblé</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Clients visés">
          {CIBLES.map((c) => (
            <button
              key={c.cible}
              type="button"
              role="radio"
              aria-checked={cible === c.cible}
              className="puce min-h-12"
              onClick={() => {
                setCible(c.cible)
                setTexte(texteCible(c.cible, commerce))
                setAnnonce('')
              }}
            >
              {c.libelle}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">
          {CIBLES.find((c) => c.cible === cible)!.aide} <strong>{cibles.length} client(s)</strong>.
        </p>
        <div>
          <label className="etiquette" htmlFor="message-texte">
            Texte
          </label>
          <textarea id="message-texte" className="champ min-h-28" maxLength={600} value={texte} onChange={(e) => setTexte(e.target.value)} />
        </div>
        {/* Un seul tap : le texte puis la liste des contacts, à coller dans votre messagerie. */}
        <BoutonCopier texte={texteEtContacts(texte, contacts)} libelle={`Copier le texte + ${cibles.length} contact(s)`} className="bouton-secondaire w-full" />
        <p className="rounded-xl bg-gray-50 p-2 text-sm text-gray-700 ring-1 ring-gray-200" data-rien-envoye>
          Rien n’est envoyé par SMS ni par e-mail depuis cet écran : sans les clés des prestataires configurées sur le serveur, SMS et e-mail ne sont pas branchés. Collez
          le texte dans votre messagerie et envoyez-le vous-même.
        </p>
        <button className="bouton w-full" disabled={enCours || !texte.trim() || !cibles.length} onClick={() => void deposer()}>
          {enCours ? 'Dépôt…' : 'Déposer dans l’espace client'}
        </button>
        <MessageErreur>{erreur}</MessageErreur>
        {annonce && (
          <p className="alerte-succes" role="status">
            {annonce}
          </p>
        )}
        <p className="text-sm text-gray-600">Le dépôt dans l’espace client n’envoie aucun SMS ni e-mail. Copiez le texte dans votre messagerie si vous le souhaitez.</p>
      </section>

      <RelancesSmsEmail />

      <section className="space-y-2">
        <h2 className="titre-carte">Derniers messages générés</h2>
        <MessageErreur>{erreurListe}</MessageErreur>
        {recents === null ? (
          <p className="text-sm text-gray-600">Chargement…</p>
        ) : recents.length === 0 ? (
          <Vide>Aucun message pour l’instant.</Vide>
        ) : (
          <ul className="space-y-2">
            {recents.slice(0, 30).map((m) => (
              <li key={m.id} className="carte space-y-1">
                <p className="flex justify-between gap-3 text-sm text-gray-600">
                  <span>
                    <strong className="text-gray-900">{m.prenom}</strong> · {m.contact} · {LIBELLE_TYPE[m.type]}
                  </span>
                  <span className="shrink-0">{dateRelative(m.date)}</span>
                </p>
                <p className="text-gray-800">{m.texte}</p>
                <BoutonCopier texte={m.texte} libelle="Copier" className="min-h-11 text-sm font-semibold text-magenta-700 underline" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
