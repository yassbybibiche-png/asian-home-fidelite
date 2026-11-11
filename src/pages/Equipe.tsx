import { useState, type FormEvent } from 'react'
import { MESSAGE_MODE_SERVEUR, useAction, useDonneesCommerce, useStore } from '../store'
import { urlAbsolue } from '../router'
import type { MembreEquipe } from '../types'
import { dateRelative } from '../lib/format'
import { BoutonCopier, EnTete, MessageErreur, Vide } from '../components/ui'
import { QrCode } from '../components/QrCode'
import { Confirmation } from '../components/Confirmation'
import type { Recapitulatif } from '../lib/ecransCommercant'

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

/** Équipe : membres + code à 4 chiffres (réaffichable une seule fois, PIN gérant), lien de la caisse. */
export default function Equipe() {
  const { mode, avecPin } = useStore()
  const { commerce, membres } = useDonneesCommerce()
  const { executer, enCours, erreur } = useAction()
  const [nom, setNom] = useState('')
  const [code, setCode] = useState('')
  const [annonce, setAnnonce] = useState('')
  // Codes saisis sur CET appareil depuis l'ouverture de la page (ajout ou changement) : seule source possible d'un
  // réaffichage, le serveur ne gardant que le haché. En mémoire seulement, effacé dès qu'il a été réaffiché une fois.
  const [codesRecents, setCodesRecents] = useState<Record<string, string>>({})
  const retenirCode = (membreId: string, c: string | null) =>
    setCodesRecents((x) => {
      const { [membreId]: _ancien, ...reste } = x
      return c ? { ...reste, [membreId]: c } : reste
    })
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
      retenirCode(r.valeur.membre.id, code)
      setAnnonce(`✓ ${nom.trim()} ajouté(e). Transmettez son code de vive voix : il pourra être réaffiché une seule fois (PIN gérant), tant que cette page reste ouverte.`)
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
              <LigneMembre key={m.id} membre={m} codeRecent={codesRecents[m.id]} onCode={(c) => retenirCode(m.id, c)} />
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
        <p className="text-sm text-gray-600">Les codes sont enregistrés chiffrés (hachés) : personne ne peut les relire, ni dans l’app ni dans le journal.</p>
      </form>
    </div>
  )
}

function LigneMembre({ membre, codeRecent, onCode }: { membre: MembreEquipe; codeRecent?: string; onCode(c: string | null): void }) {
  const { avecPin } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [edition, setEdition] = useState(false)
  const [nom, setNom] = useState(membre.nom)
  const [code, setCode] = useState('')
  const [demande, setDemande] = useState(false)

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    const champs: { nom?: string; code?: string } = {}
    if (nom.trim() && nom.trim() !== membre.nom) champs.nom = nom.trim()
    if (code) champs.code = code
    if (!Object.keys(champs).length) return setEdition(false)
    const r = await executer(() => avecPin((a, api) => api.majMembre(membre.commerceId, a, membre.id, champs)))
    if (r.ok) {
      if (champs.code) onCode(champs.code)
      setEdition(false)
      setCode('')
    }
  }

  async function supprimer() {
    setDemande(false)
    await executer(() => avecPin((a, api) => api.supprimerMembre(membre.commerceId, a, membre.id)))
  }

  const recapRetrait: Recapitulatif = {
    titre: 'Retirer ce membre ?',
    lignes: [
      ['Membre', membre.nom],
      ['Code', 'Ne pourra plus ouvrir la caisse'],
    ],
    confirmer: 'Retirer le membre',
    avertissement: 'Son code n’ouvrira plus la caisse.',
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
          <button className="min-h-11 rounded-xl px-3 text-sm font-semibold text-red-800 ring-1 ring-red-200" onClick={() => setDemande(true)} disabled={enCours}>
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
      {demande && <Confirmation recap={recapRetrait} enCours={enCours} onConfirmer={() => void supprimer()} onAnnuler={() => setDemande(false)} />}
      <ReaffichageCode membre={membre} codeRecent={codeRecent} onConsomme={() => onCode(null)} />
    </li>
  )
}

/**
 * « Réafficher le code une fois » (P1-C6) : PIN gérant exigé et vérifié par le serveur, qui journalise le réaffichage.
 * Le code vient de la mémoire de cette page (saisi ici à l'ajout ou au changement) et en est effacé dès qu'il s'affiche.
 */
function ReaffichageCode({ membre, codeRecent, onConsomme }: { membre: MembreEquipe; codeRecent?: string; onConsomme(): void }) {
  const { api } = useStore()
  const { executer, enCours, erreur } = useAction()
  const [ouvert, setOuvert] = useState(false)
  const [pin, setPin] = useState('')
  const [affiche, setAffiche] = useState<string | null>(null)

  async function reafficher(e: FormEvent) {
    e.preventDefault()
    if (!api || !codeRecent || !/^\d{4,12}$/.test(pin)) return
    const r = await executer(() => api.journaliserReaffichage(membre.commerceId, pin, membre.id))
    setPin('')
    if (!r.ok) return
    setAffiche(codeRecent)
    onConsomme()
  }

  if (affiche)
    return (
      <div className="mt-3 space-y-2 rounded-xl bg-amber-50 p-3 text-center ring-1 ring-amber-200" role="status">
        <p className="text-sm text-amber-900">Code de {membre.nom} — affiché une seule fois (réaffichage journalisé) :</p>
        <p className="font-mono text-3xl font-bold tracking-[0.4em]">{affiche}</p>
        <button type="button" className="bouton-secondaire min-h-11 w-full" onClick={() => setAffiche(null)}>
          Masquer définitivement
        </button>
      </div>
    )
  if (!codeRecent) return null
  return ouvert ? (
    <form onSubmit={reafficher} className="mt-3 space-y-2 rounded-xl bg-gray-50 p-3">
      <label className="etiquette" htmlFor={`pin-reaffichage-${membre.id}`}>
        PIN gérant (requis pour réafficher le code)
      </label>
      <input
        id={`pin-reaffichage-${membre.id}`}
        className="champ tracking-[0.4em]"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={12}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
      />
      <MessageErreur>{erreur}</MessageErreur>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="bouton-secondaire min-h-11" onClick={() => (setOuvert(false), setPin(''))}>
          Annuler
        </button>
        <button className="bouton min-h-11" disabled={enCours || !/^\d{4,12}$/.test(pin)}>
          {enCours ? 'Vérification…' : 'Réafficher'}
        </button>
      </div>
    </form>
  ) : (
    <button type="button" className="mt-2 min-h-11 text-sm font-semibold text-magenta-700 underline" onClick={() => setOuvert(true)}>
      Réafficher le code une fois
    </button>
  )
}
