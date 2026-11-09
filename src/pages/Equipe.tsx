import { useState, type FormEvent } from 'react'
import { MESSAGE_MODE_SERVEUR, useAction, useDonneesCommerce, useStore } from '../store'
import { urlAbsolue } from '../router'
import type { MembreEquipe } from '../types'
import { dateRelative } from '../lib/format'
import { BoutonCopier, EnTete, MessageErreur, QrCode, Vide } from '../components/ui'

const CODE = /^\d{4}$/

function ChampCode({ id, valeur, onChange, libelle }: { id: string; valeur: string; onChange(v: string): void; libelle: string }) {
  return (
    <div>
      <label className="etiquette" htmlFor={id}>
        {libelle}
      </label>
      <input
        id={id}
        className="champ tracking-[0.4em]"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={4}
        value={valeur}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </div>
  )
}

/** Équipe : membres + code à 4 chiffres (jamais réaffiché), lien de la caisse. */
export default function Equipe() {
  const { mode, avecPin } = useStore()
  const { commerce, membres } = useDonneesCommerce()
  const { executer, enCours, erreur } = useAction()
  const [nom, setNom] = useState('')
  const [code, setCode] = useState('')
  const [annonce, setAnnonce] = useState('')
  const lienCaisse = urlAbsolue('caisse', commerce.id)

  if (mode === 'local') {
    return (
      <div>
        <EnTete titre="Équipe" />
        <Vide>{MESSAGE_MODE_SERVEUR}</Vide>
      </div>
    )
  }

  async function ajouter(e: FormEvent) {
    e.preventDefault()
    if (!nom.trim() || !CODE.test(code)) return
    const r = await executer(() => avecPin((a, api) => api.ajouterMembre(commerce.id, a, nom.trim(), code)))
    if (r.ok) {
      setAnnonce(`✓ ${nom.trim()} ajouté(e). Son code ne sera plus jamais affiché : transmettez-le de vive voix.`)
      setNom('')
      setCode('')
    }
  }

  return (
    <div className="space-y-5">
      <EnTete titre="Équipe" sousTitre="Chaque membre ouvre la caisse avec son code à 4 chiffres ; chaque passage est tracé à son nom." />

      <section className="carte space-y-3">
        <h2 className="titre-carte">Caisse du comptoir</h2>
        <p className="text-sm text-gray-600">Ouvrez ce lien sur la tablette ou le téléphone du comptoir (à mettre en favori). Il fonctionne aussi hors ligne : les actions sont envoyées au retour du réseau.</p>
        <div className="flex justify-center">
          <div className="rounded-2xl bg-white p-2 ring-1 ring-gray-200">
            <QrCode texte={lienCaisse} className="h-36 w-36" titre="QR code de la caisse" />
          </div>
        </div>
        <a href={`#/caisse/${commerce.id}`} className="bouton w-full">
          Ouvrir la caisse
        </a>
        <BoutonCopier texte={lienCaisse} libelle="Copier le lien de la caisse" className="bouton-secondaire w-full" />
      </section>

      <section className="carte space-y-3">
        <h2 className="titre-carte">Membres ({membres.length})</h2>
        {membres.length === 0 ? (
          <Vide>Aucun membre : ajoutez-vous d’abord (votre propre code), puis vos employés.</Vide>
        ) : (
          <ul className="divide-y divide-gray-100">
            {membres.map((m) => (
              <LigneMembre key={m.id} membre={m} />
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={ajouter} className="carte space-y-3">
        <h2 className="titre-carte">Ajouter un membre</h2>
        <div>
          <label className="etiquette" htmlFor="membre-nom">
            Prénom ou nom
          </label>
          <input id="membre-nom" className="champ" value={nom} maxLength={40} onChange={(e) => setNom(e.target.value)} />
        </div>
        <ChampCode id="membre-code" libelle="Code à 4 chiffres (unique dans l’équipe)" valeur={code} onChange={setCode} />
        <MessageErreur>{erreur}</MessageErreur>
        {annonce && (
          <p className="alerte-succes" role="status">
            {annonce}
          </p>
        )}
        <button className="bouton w-full" disabled={enCours || !nom.trim() || !CODE.test(code)}>
          {enCours ? 'Ajout…' : 'Ajouter'}
        </button>
        <p className="text-xs text-gray-600">Les codes sont enregistrés chiffrés (hachés) : personne ne peut les relire, ni dans l’app ni dans le journal.</p>
      </form>
    </div>
  )
}

function LigneMembre({ membre }: { membre: MembreEquipe }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [edition, setEdition] = useState(false)
  const [nom, setNom] = useState(membre.nom)
  const [code, setCode] = useState('')

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    const champs: { nom?: string; code?: string } = {}
    if (nom.trim() && nom.trim() !== membre.nom) champs.nom = nom.trim()
    if (code) champs.code = code
    if (!Object.keys(champs).length) return setEdition(false)
    const r = await executer(() => avecPin((a, api) => api.majMembre(membre.commerceId, a, membre.id, champs)))
    if (r.ok) {
      setEdition(false)
      setCode('')
    }
  }

  async function supprimer() {
    if (!window.confirm(`Retirer ${membre.nom} de l’équipe ? Son code n’ouvrira plus la caisse.`)) return
    await executer(() => avecPin((a, api) => api.supprimerMembre(membre.commerceId, a, membre.id)))
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-semibold">{membre.nom}</span>
          <span className="block text-sm text-gray-600">Code : •••• · ajouté {dateRelative(membre.creeLe)}</span>
        </span>
        <span className="flex shrink-0 gap-1">
          <button className="min-h-11 rounded-xl px-3 text-sm font-semibold text-gray-700 ring-1 ring-gray-300" onClick={() => setEdition((x) => !x)} aria-expanded={edition}>
            Modifier
          </button>
          <button className="min-h-11 rounded-xl px-3 text-sm font-semibold text-red-800 ring-1 ring-red-200" onClick={() => void supprimer()} disabled={enCours}>
            Retirer
          </button>
        </span>
      </div>
      {edition && (
        <form onSubmit={enregistrer} className="mt-3 space-y-3 rounded-xl bg-gray-50 p-3">
          <div>
            <label className="etiquette" htmlFor={`nom-${membre.id}`}>
              Nom
            </label>
            <input id={`nom-${membre.id}`} className="champ" value={nom} maxLength={40} onChange={(e) => setNom(e.target.value)} />
          </div>
          <ChampCode id={`code-${membre.id}`} libelle="Nouveau code (laisser vide pour garder l’actuel)" valeur={code} onChange={setCode} />
          <button className="bouton w-full" disabled={enCours || (!!code && !CODE.test(code)) || !nom.trim()}>
            Enregistrer
          </button>
        </form>
      )}
      <MessageErreur>{erreur}</MessageErreur>
    </li>
  )
}
