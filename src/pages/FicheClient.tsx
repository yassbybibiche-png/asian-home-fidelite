import { useState, type FormEvent } from 'react'
import { useAction, useStore } from '../store'
import { useRoute } from '../router'
import type { Client, Commerce } from '../types'
import { recompenseDebloquee } from '../lib/fidelite'
import { soldePoints, formaterPrix } from '../lib/points'
import { analyserAnniversaire, anniversaireAffiche } from '../lib/messages'
import { nouvelIdAction } from '../lib/fileCaisse'
import { dateCourte, dateRelative } from '../lib/format'
import { CarteFidelite } from '../components/CarteFidelite'
import { EncartWallet, EnTete, MessageErreur, Vide } from '../components/ui'

/** Mode serveur : points (échange contre le catalogue), historique des échanges, anniversaire. */
function PointsEtAnniversaire({ client, commerce }: { client: Client; commerce: Commerce }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [anniv, setAnniv] = useState(anniversaireAffiche(client.anniversaire))
  const [annonce, setAnnonce] = useState('')
  const valeur = analyserAnniversaire(anniv)
  const solde = soldePoints(client)

  async function enregistrerAnniv(e: FormEvent) {
    e.preventDefault()
    if (valeur === null) return
    const r = await executer(() => avecPin((a, api) => api.majClient(commerce.id, a, client.id, { anniversaire: valeur })))
    if (r.ok) setAnnonce('✓ Anniversaire enregistré')
  }

  return (
    <section className="carte space-y-3">
      <h2 className="titre-carte">Points : {solde}</h2>
      <p className="text-sm text-gray-600">
        Dépensé au total : {formaterPrix(client.depenseCentimes ?? 0)}. Les points se gagnent en caisse (montant du passage).
      </p>
      {!!commerce.catalogue?.length && (
        <ul className="space-y-2">
          {commerce.catalogue.map((r) => (
            <li key={r.id}>
              <button
                className="bouton-secondaire min-h-12 w-full justify-between"
                disabled={enCours || solde < r.cout}
                onClick={async () => {
                  if (!window.confirm(`Échanger ${r.cout} points contre « ${r.nom} » ?`)) return
                  const res = await executer(() => avecPin((a, api) => api.actionCaisse(commerce.id, a, 'echange', { clientId: client.id, recompenseId: r.id, actionId: nouvelIdAction() })))
                  if (res.ok) setAnnonce(`✓ Échange enregistré : ${r.nom}`)
                }}
              >
                <span>Échanger : {r.nom}</span>
                <span className="tabular-nums">{r.cout} pts</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!!client.echangesPoints?.length && (
        <ul className="divide-y divide-gray-100 text-sm">
          {[...client.echangesPoints].reverse().slice(0, 10).map((e) => (
            <li key={e.id} className="flex justify-between gap-3 py-2">
              <span>
                🔁 {e.libelle} (−{e.cout} pts, {e.soldeAvant} → {e.soldeApres}) · {e.auteur}
              </span>
              <span className="shrink-0 text-gray-600">{dateRelative(e.date)}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={enregistrerAnniv} className="flex items-end gap-2 border-t border-gray-100 pt-3">
        <div className="min-w-0 flex-1">
          <label className="etiquette" htmlFor="anniv">
            Anniversaire (JJ/MM, optionnel)
          </label>
          <input id="anniv" className="champ" inputMode="numeric" placeholder="21/03" value={anniv} onChange={(e) => (setAnniv(e.target.value), setAnnonce(''))} />
        </div>
        <button className="bouton-secondaire h-12 shrink-0" disabled={enCours || valeur === null}>
          Enregistrer
        </button>
      </form>
      {valeur === null && <p className="text-sm text-red-700">Format attendu : JJ/MM (ex : 21/03).</p>}
      <MessageErreur>{erreur}</MessageErreur>
      {annonce && (
        <p className="alerte-succes" role="status">
          {annonce}
        </p>
      )}
    </section>
  )
}

/** Fiche client côté commerçant : la carte + les actions de caisse. */
export default function FicheClient() {
  const { param } = useRoute()
  const { etat, validerVisite, offrirRecompense, estDemo, mode } = useStore()
  const [annonce, setAnnonce] = useState('')
  const { executer, enCours, erreur } = useAction()
  const client = etat.clients.find((c) => c.id === param)
  const commerce = client && etat.commerces.find((c) => c.id === client.commerceId)

  if (!client || !commerce) {
    return (
      <div>
        <EnTete titre="Client introuvable" />
        <Vide>
          Ce client n’existe pas (ou la démo a été réinitialisée).{' '}
          <a href="#/clients" className="font-semibold text-marque-600 underline">
            Retour à la liste
          </a>
        </Vide>
      </div>
    )
  }

  const debloquee = recompenseDebloquee(client, commerce)
  const gains = etat.tirages.filter((t) => t.clientId === client.id).sort((a, b) => b.date.localeCompare(a.date))
  const annoncer = (texte: string) => {
    setAnnonce(texte)
    setTimeout(() => setAnnonce(''), 2500)
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <a href="#/clients" className="lien no-underline">
        ‹ Clients
      </a>
      <EnTete titre={client.prenom} sousTitre={`${client.telephone ?? client.email} · client depuis le ${dateCourte(client.creeLe)}`} />

      <CarteFidelite client={client} commerce={commerce} />

      <section className="carte space-y-2">
        <h2 className="titre-carte">En caisse</h2>
        <button
          className="bouton w-full"
          disabled={enCours}
          onClick={async () => {
            if (!(await executer(() => validerVisite(client.id))).ok) return
            annoncer(
              debloquee
                ? 'Visite enregistrée (+1 tampon, reporté sur la carte suivante) — offrez la récompense.'
                : '✓ Visite validée : +1 tampon',
            )
          }}
        >
          Valider une visite (+1 tampon)
        </button>
        {debloquee && (
          <button
            className="bouton w-full bg-green-700 hover:bg-green-800 active:bg-green-900"
            disabled={enCours}
            onClick={async () => {
              if (!(await executer(() => offrirRecompense(client.id))).ok) return
              const reportes = client.tampons - commerce.seuilTampons
              annoncer(
                `🎁 Récompense offerte : ${commerce.recompense}. ${
                  reportes > 0 ? `${reportes} tampon${reportes > 1 ? 's' : ''} reporté${reportes > 1 ? 's' : ''} sur la nouvelle carte.` : 'Carte remise à zéro.'
                }`,
              )
            }}
          >
            🎁 Offrir la récompense
          </button>
        )}
        <MessageErreur>{erreur && `Rien n’a été enregistré : ${erreur}`}</MessageErreur>
        {annonce && (
          <p className="alerte-succes apparition" role="status">
            {annonce}
          </p>
        )}
        <p className="text-xs text-gray-600">
          {debloquee
            ? 'Tant que la récompense n’est pas offerte, les visites sont enregistrées mais la carte reste pleine.'
            : mode === 'local'
              ? 'En vrai, vous scannez le QR du client ; dans la démo, un tap suffit.'
              : 'Vérifiez la carte du client (son QR ou son numéro) avant de valider.'}
        </p>
      </section>

      {mode === 'api' && <PointsEtAnniversaire client={client} commerce={commerce} />}

      <EncartWallet demo={estDemo} lienCarte={`#/carte/${client.id}`} />

      <a href={`#/carte/${client.id}`} className="bouton-secondaire w-full">
        Voir la carte comme le client ↗
      </a>

      <section className="carte">
        <h2 className="titre-carte">Historique</h2>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 py-2">
            <dt className="text-xs text-gray-600">Visites</dt>
            <dd className="text-xl font-bold tabular-nums">{client.visites.length}</dd>
          </div>
          <div className="rounded-xl bg-gray-50 py-2">
            <dt className="text-xs text-gray-600">Récompenses</dt>
            <dd className="text-xl font-bold tabular-nums">{client.recompensesOffertes?.length ?? 0}</dd>
          </div>
          <div className="rounded-xl bg-gray-50 py-2">
            <dt className="text-xs text-gray-600">Gains roulette</dt>
            <dd className="text-xl font-bold tabular-nums">{gains.length}</dd>
          </div>
        </dl>
        <ul className="mt-3 divide-y divide-gray-100 text-sm">
          {[...(client.recompensesOffertes ?? []).map((r) => ({ date: r.date, texte: `🎁 Récompense offerte : ${r.libelle}` })), ...gains.map((g) => ({ date: g.date, texte: `🎡 Roulette : ${g.lot}${g.code ? ` (code ${g.code})` : ''}` }))]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 10)
            .map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>{l.texte}</span>
                <span className="shrink-0 text-gray-600">{dateRelative(l.date)}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}
