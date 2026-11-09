import { useCallback, useEffect, useState } from 'react'
import { MESSAGE_MODE_SERVEUR, messageErreur, useAction, useDonneesCommerce, useStore } from '../store'
import type { MessageCommercant } from '../data/api'
import { CIBLES, clientsCibles, texteCible, TYPES_MESSAGES, type Cible } from '../lib/messages'
import { MENTION_ENVOI } from '../lib/integrations'
import { dateRelative } from '../lib/format'
import { BoutonCopier, EnTete, MessageErreur, Vide } from '../components/ui'

const LIBELLE_TYPE: Record<string, string> = { ...Object.fromEntries(TYPES_MESSAGES.map((t) => [t.type, t.libelle])), commercant: 'Message du commerce' }

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

  const contacts = cibles.map((c) => c.telephone ?? c.email).filter(Boolean).join(', ')

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
        <div className="grid gap-2 sm:grid-cols-2">
          <BoutonCopier texte={texte} libelle="Copier le texte" className="bouton-secondaire w-full" />
          <BoutonCopier texte={contacts} libelle={`Copier les ${cibles.length} contact(s)`} className="bouton-secondaire w-full" />
        </div>
        <button className="bouton w-full" disabled={enCours || !texte.trim() || !cibles.length} onClick={() => void deposer()}>
          {enCours ? 'Dépôt…' : 'Déposer dans l’espace client'}
        </button>
        <MessageErreur>{erreur}</MessageErreur>
        {annonce && (
          <p className="alerte-succes" role="status">
            {annonce}
          </p>
        )}
        <p className="text-xs text-gray-600">{MENTION_ENVOI} : aucun SMS ni e-mail n’est envoyé par l’app. Copiez le texte dans votre messagerie si vous le souhaitez.</p>
      </section>

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
                <BoutonCopier texte={m.texte} libelle="Copier" className="min-h-11 text-sm font-semibold text-marque-700 underline" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
