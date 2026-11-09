import { useState } from 'react'
import { useAction, useStore } from '../store'
import { useRoute } from '../router'
import { recompenseDebloquee } from '../lib/fidelite'
import { dateCourte, dateRelative } from '../lib/format'
import { CarteFidelite } from '../components/CarteFidelite'
import { BoutonWallet, EnTete, MessageErreur, Vide } from '../components/ui'

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
      <a href="#/clients" className="inline-flex min-h-11 items-center font-semibold text-marque-600">
        ‹ Clients
      </a>
      <EnTete titre={client.prenom} sousTitre={`${client.telephone ?? client.email} · client depuis le ${dateCourte(client.creeLe)}`} />

      <CarteFidelite client={client} commerce={commerce} />

      <section className="carte space-y-2">
        <h2 className="font-bold">En caisse</h2>
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
            className="bouton w-full bg-green-600 hover:bg-green-700 active:bg-green-800"
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
          <p className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-900 ring-1 ring-green-200" role="status">
            {annonce}
          </p>
        )}
        <p className="text-xs text-gray-500">
          {debloquee
            ? 'Tant que la récompense n’est pas offerte, les visites sont enregistrées mais la carte reste pleine.'
            : mode === 'local'
              ? 'En vrai, vous scannez le QR du client ; dans la démo, un tap suffit.'
              : 'Vérifiez la carte du client (son QR ou son numéro) avant de valider.'}
        </p>
      </section>

      <BoutonWallet demo={estDemo} lienCarte={`#/carte/${client.id}`} />

      <a href={`#/carte/${client.id}`} className="bouton-secondaire w-full">
        Voir la carte comme le client ↗
      </a>

      <section className="carte">
        <h2 className="font-bold">Historique</h2>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-xs text-gray-500">Visites</dt>
            <dd className="text-xl font-bold">{client.visites.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Récompenses</dt>
            <dd className="text-xl font-bold">{client.recompensesOffertes?.length ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Gains roulette</dt>
            <dd className="text-xl font-bold">{gains.length}</dd>
          </div>
        </dl>
        <ul className="mt-3 divide-y divide-gray-100 text-sm">
          {[...(client.recompensesOffertes ?? []).map((r) => ({ date: r.date, texte: `🎁 Récompense offerte : ${r.libelle}` })), ...gains.map((g) => ({ date: g.date, texte: `🎡 Roulette : ${g.lot}${g.code ? ` (code ${g.code})` : ''}` }))]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 10)
            .map((l, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>{l.texte}</span>
                <span className="shrink-0 text-gray-500">{dateRelative(l.date)}</span>
              </li>
            ))}
        </ul>
      </section>
    </div>
  )
}
