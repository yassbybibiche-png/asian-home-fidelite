import { useState } from 'react'
import { useDonneesCommerce, useStore } from '../store'
import { calculerChiffres, noteMoyenne } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { Etoiles, Vide } from '../components/ui'

function Chiffre({ valeur, libelle, aide }: { valeur: string | number; libelle: string; aide: string }) {
  return (
    <div className="carte relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-marque-500 to-marque-300" aria-hidden />
      <div className="surtitre">{libelle}</div>
      <div className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900 tabular-nums">{valeur}</div>
      <div className="mt-0.5 text-xs text-gray-600">{aide}</div>
    </div>
  )
}

function Raccourci({ href, icone, libelle }: { href: string; icone: string; libelle: string }) {
  return (
    <a href={href} className="bouton-secondaire min-h-14 flex-col gap-0.5 px-2 py-2 text-sm">
      <span className="text-xl" aria-hidden>
        {icone}
      </span>
      {libelle}
    </a>
  )
}

export default function TableauDeBord() {
  const { commerce, clients, avis, tirages } = useDonneesCommerce()
  const { estDemo } = useStore()
  const chiffres = calculerChiffres(clients, avis)
  const moyenne = noteMoyenne(avis)
  const prenom = (id: string) => clients.find((c) => c.id === id)?.prenom ?? 'Client'
  const [toutLesGains, setToutLesGains] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <p className="surtitre">Bonjour</p>
        <h1 className="font-titre text-[1.75rem] font-bold tracking-tight">Tableau de bord</h1>
        <p className="mt-0.5 text-gray-600">
          {commerce.nom}
          {moyenne !== null && (
            <>
              {' · '}
              <span className="font-semibold text-gray-800">{moyenne.toLocaleString('fr-FR')}</span> ★ sur {avis.length} avis
            </>
          )}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Chiffre valeur={chiffres.clientsActifs} libelle="Clients actifs" aide="venus ces 30 derniers jours" />
        <Chiffre valeur={chiffres.visitesCeMois} libelle="Visites ce mois" aide="tampons validés" />
        <Chiffre valeur={chiffres.avisCeMois} libelle="Avis ce mois" aide={estDemo ? 'sur Google (démo)' : 'saisis dans l’app'} />
        <Chiffre valeur={`${chiffres.tauxRetour} %`} libelle="Taux de retour" aide="clients venus 2 fois ou +" />
      </section>

      <nav className="grid grid-cols-3 gap-2" aria-label="Actions rapides">
        <Raccourci href="#/clients" icone="✓" libelle="Valider une visite" />
        <Raccourci href="#/qr" icone="▦" libelle="QR vitrine" />
        <Raccourci href="#/avis" icone="★" libelle="Répondre aux avis" />
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="titre-carte">Derniers avis</h2>
            <a href="#/avis" className="lien">
              Tout voir
            </a>
          </div>
          {avis.length === 0 ? (
            <Vide>Aucun avis pour l’instant.</Vide>
          ) : (
            <ul className="space-y-2">
              {avis.slice(0, 3).map((a) => (
                <li key={a.id} className="carte">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{a.auteur}</span>
                    <Etoiles note={a.note} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-gray-700">{a.texte || <em className="text-gray-500">Note sans commentaire</em>}</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {dateRelative(a.date)} · {a.reponse ? (a.reponseAuto ? 'Répondu (auto)' : 'Répondu') : a.brouillon ? 'Brouillon' : 'Sans réponse'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="titre-carte">{toutLesGains ? `Historique des gains (${tirages.length})` : 'Derniers gains roulette'}</h2>
            {tirages.length > 5 && (
              <button className="lien" onClick={() => setToutLesGains((t) => !t)}>
                {toutLesGains ? 'Réduire' : 'Tout voir'}
              </button>
            )}
          </div>
          {tirages.length === 0 ? (
            <Vide>Aucun tirage pour l’instant.</Vide>
          ) : (
            <ul className="carte divide-y divide-gray-100 py-1 sm:py-1">
              {(toutLesGains ? tirages : tirages.slice(0, 5)).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-semibold">{prenom(t.clientId)}</span>
                    <span className="block text-gray-700">🎁 {t.lot}</span>
                    {t.code && <span className="block font-mono text-sm text-gray-600">code {t.code}</span>}
                  </span>
                  <span className="shrink-0 text-sm text-gray-600">{dateRelative(t.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
