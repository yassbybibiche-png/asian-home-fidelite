import { useState } from 'react'
import { useDonneesCommerce, useStore } from '../store'
import { calculerChiffres, calculerChiffresCartes, noteMoyenne } from '../lib/stats'
import { dateRelative } from '../lib/format'
import { Etoiles, Vide } from '../components/ui'
import { Mesure } from '../components/Mesure'
import type { ActionJournal } from '../types'

const LIBELLES_JOURNAL: Record<ActionJournal, string> = {
  passage: 'Passage',
  recompense: 'Récompense',
  echange: 'Échange de points',
  message: 'Message',
  equipe: 'Équipe',
  menu: 'Menu',
  parrainage: 'Parrainage',
  rattrapage: 'Rattrapage',
  palier: 'Palier',
  reserve: 'Plat en réserve',
  defi: 'Défi',
  gain: 'Gain de la roue remis',
  consentement: 'Consentement relances',
  avisGoogle: 'Avis Google',
  rgpd: 'Données personnelles',
}

function Chiffre({ valeur, libelle, aide }: { valeur: string | number; libelle: string; aide: string }) {
  return (
    <div className="carte relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-marque-500 to-marque-300" aria-hidden />
      <div className="surtitre">{libelle}</div>
      <div className="mt-1 text-3xl font-extrabold tracking-tight text-gray-900 tabular-nums">{valeur}</div>
      <div className="mt-0.5 text-sm text-gray-600">{aide}</div>
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
  const { commerce, clients, avis, tirages, journal } = useDonneesCommerce()
  const { estDemo, mode } = useStore()
  const chiffres = calculerChiffres(clients, avis)
  const cartes = calculerChiffresCartes(clients)
  const [toutLeJournal, setToutLeJournal] = useState(false)
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

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Cartes de fidélité">
        <Chiffre valeur={cartes.cartesEmises} libelle="Cartes émises" aide="clients inscrits" />
        <Chiffre valeur={cartes.passagesTotal} libelle="Passages" aide={`dont ${cartes.passages30j} sur 30 jours`} />
        <Chiffre valeur={cartes.recompensesDonnees} libelle="Récompenses données" aide="cartes complètes + échanges de points" />
        <Chiffre valeur={cartes.pointsEnCirculation} libelle="Points en cours" aide="soldes des clients" />
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Programme de fidélité">
        <Chiffre
          valeur={clients.reduce((n, c) => n + (c.parrainagesGagnes?.length ?? 0), 0)}
          libelle="Parrainages réussis"
          aide="filleuls venus une 1re fois"
        />
        <Chiffre
          valeur={clients.filter((c) => c.visites.length >= 25).length}
          libelle="Clients VIP"
          aide="25 visites ou + (niveau rare)"
        />
        <Chiffre
          valeur={clients.reduce((n, c) => n + (c.demandesRattrapage ?? []).filter((d) => d.statut === 'en_attente').length, 0)}
          libelle="Rattrapages en attente"
          aide="visites oubliées à valider"
        />
        <Chiffre
          valeur={clients.reduce((n, c) => n + (c.defisReussis?.length ?? 0), 0)}
          libelle="Défis réussis"
          aide="3 visites en 14 jours"
        />
      </section>

      <Mesure />

      <nav className="grid grid-cols-3 gap-2" aria-label="Actions rapides">
        {mode === 'api' ? (
          <Raccourci href={`#/caisse/${commerce.id}`} icone="🧾" libelle="Caisse" />
        ) : (
          <Raccourci href="#/clients" icone="✓" libelle="Valider une visite" />
        )}
        <Raccourci href="#/qr" icone="▦" libelle="QR vitrine" />
        <Raccourci href="#/avis" icone="★" libelle="Répondre aux avis" />
        <Raccourci href="#/equipe" icone="👥" libelle="Équipe" />
        <Raccourci href="#/menuCarte" icone="📖" libelle="Menu" />
        <Raccourci href="#/messages" icone="✉" libelle="Messages" />
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="titre-carte mb-2">Clients les plus fidèles</h2>
          {cartes.plusFideles.length === 0 ? (
            <Vide>Aucun passage pour l’instant.</Vide>
          ) : (
            <ol className="carte divide-y divide-gray-100 py-1 sm:py-1">
              {cartes.plusFideles.map((c, i) => (
                <li key={c.id}>
                  <a href={`#/client/${c.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
                    <span className="font-semibold">
                      {i + 1}. {c.prenom}
                    </span>
                    <span className="shrink-0 text-sm text-gray-600 tabular-nums">
                      {c.passages} passage{c.passages > 1 ? 's' : ''} · {c.points} pts
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </section>

        {mode === 'api' && (
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="titre-carte">Journal de l’équipe</h2>
              {journal.length > 8 && (
                <button className="lien" onClick={() => setToutLeJournal((t) => !t)}>
                  {toutLeJournal ? 'Réduire' : `Tout voir (${journal.length})`}
                </button>
              )}
            </div>
            {journal.length === 0 ? (
              <Vide>Aucune action pour l’instant. Chaque passage, récompense et échange y sera tracé (qui, quel client, quand).</Vide>
            ) : (
              <ul className="carte divide-y divide-gray-100 py-1 text-sm sm:py-1">
                {(toutLeJournal ? journal : journal.slice(0, 8)).map((e) => (
                  <li key={e.id} className="py-2.5">
                    <p className="flex justify-between gap-3">
                      <span>
                        <strong>{e.auteur.nom}</strong> · {LIBELLES_JOURNAL[e.action]}
                        {e.clientPrenom && <> · {e.clientPrenom}</>}
                      </span>
                      <span className="shrink-0 text-gray-600">{dateRelative(e.date)}</span>
                    </p>
                    <p className="text-gray-700">{e.details}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

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
                  <p className="mt-1 line-clamp-2 text-gray-700">{a.texte || <em className="text-gray-600">Note sans commentaire</em>}</p>
                  <p className="mt-1 text-sm text-gray-600">
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
