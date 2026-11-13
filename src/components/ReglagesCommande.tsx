// Réglages → « Commande à table » (Expérience 10/10, lot 2). Composant à part : Réglages.tsx est un seul formulaire
// dont les champs et sections sont inventoriés par les tests (P1-C7) ; cette section s'enregistre par son propre
// bouton (PATCH du seul champ `commande`), le formulaire principal n'envoie jamais `commande`.
// Les jetons des QR sont tirés par le serveur : après l'enregistrement, la section relit le commerce renvoyé pour
// afficher les QR, et recharge l'état du store.
import { useState, type KeyboardEvent } from 'react'
import { MESSAGE_MODE_SERVEUR, useAction, useStore } from '../store'
import type { TableCommande } from '../types'
import { BoutonCopier, Interrupteur, MessageErreur, Vide } from './ui'
import { QrCode } from './QrCode'
import { lienTable, NOM_TABLE_MAX, problemeTables, TABLES_MAX } from '../lib/tablesCommande'

/** Table en cours d'édition : `jeton` = celui d'une table déjà enregistrée (renommer garde le QR). */
type TableEditee = { cle: string; nom: string; jeton?: string }

const versEdition = (tables: readonly TableCommande[]): TableEditee[] => tables.map((t) => ({ cle: t.jeton, nom: t.nom, jeton: t.jeton }))
const baseApp = () => `${window.location.origin}${window.location.pathname}`

export function ReglagesCommande() {
  const { commerce, mode, avecPin, recharger } = useStore()
  const { executer, enCours, erreur } = useAction()
  // Interrupteur et tables partent de l'état du store (commerce relu du serveur), puis du commerce renvoyé à
  // chaque enregistrement.
  const [enregistree, setEnregistree] = useState(commerce.commande ?? { active: false, tables: [] })
  const [active, setActive] = useState(enregistree.active)
  const [tables, setTables] = useState<TableEditee[]>(() => versEdition(enregistree.tables))
  const [nouveau, setNouveau] = useState('')
  const [enregistre, setEnregistre] = useState(false)
  const [impression, setImpression] = useState(false)

  if (mode === 'local')
    return (
      <section className="carte space-y-3" aria-labelledby="commande-table-titre">
        <h2 id="commande-table-titre" className="titre-carte">
          Commande à table
        </h2>
        <Vide>{MESSAGE_MODE_SERVEUR}</Vide>
      </section>
    )

  const probleme = problemeTables(tables.map((t) => t.nom))
  const modifie = active !== enregistree.active || JSON.stringify(tables.map((t) => [t.nom.trim(), t.jeton ?? ''])) !== JSON.stringify(enregistree.tables.map((t) => [t.nom, t.jeton]))
  const qrs = enregistree.tables

  const changer = (f: (t: TableEditee[]) => TableEditee[]) => (setTables(f), setEnregistre(false))
  function ajouterTable() {
    const nom = nouveau.trim()
    if (!nom || tables.length >= TABLES_MAX) return
    changer((t) => [...t, { cle: `n-${Date.now().toString(36)}-${t.length}`, nom }])
    setNouveau('')
  }
  // Entrée dans le champ : ajoute la table (sans soumettre le formulaire des Réglages qui entoure la section).
  const surEntree = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    ajouterTable()
  }

  async function enregistrer() {
    if (probleme || enCours) return
    const commande = { active, tables: tables.map((t) => ({ nom: t.nom.trim(), ...(t.jeton ? { jeton: t.jeton } : {}) })) }
    const r = await executer(() => avecPin((a, api) => api.majCommerce(commerce.id, a, { commande })))
    if (!r.ok) return
    const relue = r.valeur.commande ?? { active: false, tables: [] }
    setEnregistree(relue)
    setActive(relue.active)
    setTables(versEdition(relue.tables))
    setEnregistre(true)
    void recharger()
  }

  return (
    <section className="carte space-y-4" aria-labelledby="commande-table-titre" data-reglages-commande>
      <h2 id="commande-table-titre" className="titre-carte">
        Commande à table
      </h2>
      <p className="text-sm text-gray-600">
        Chaque table a son QR code : le client le scanne, choisit ses plats et envoie sa commande en cuisine. Le prix est toujours recalculé par le serveur
        depuis votre menu ; un plat sans prix ou marqué « Indisponible » (Menu) ne se commande pas en ligne. Le paiement reste sur place.
      </p>
      <Interrupteur
        actif={active}
        onChange={(v) => (setActive(v), setEnregistre(false))}
        libelle="Activer la commande à table"
        aide={active ? 'Les QR des tables permettent de commander.' : 'Désactivée : les QR des tables affichent « commande indisponible ».'}
      />

      <div className="space-y-2">
        <p className="etiquette">Tables ({tables.length})</p>
        {tables.length === 0 && <p className="text-sm text-gray-600">Aucune table pour l’instant : ajoutez-en une ci-dessous.</p>}
        <ul className="space-y-2">
          {tables.map((t, i) => (
            <li key={t.cle} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="sr-only" htmlFor={`table-${t.cle}`}>
                  Nom de la table {i + 1}
                </label>
                <input
                  id={`table-${t.cle}`}
                  className="champ"
                  maxLength={NOM_TABLE_MAX}
                  value={t.nom}
                  onChange={(e) => changer((ts) => ts.map((x) => (x.cle === t.cle ? { ...x, nom: e.target.value } : x)))}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                />
              </div>
              <button
                type="button"
                className="h-12 shrink-0 rounded-xl px-3 text-sm font-semibold text-red-800 ring-1 ring-red-200"
                onClick={() => changer((ts) => ts.filter((x) => x.cle !== t.cle))}
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="etiquette" htmlFor="nouvelle-table">
              Nouvelle table
            </label>
            <input id="nouvelle-table" className="champ" maxLength={NOM_TABLE_MAX} placeholder="ex : Table 4, Terrasse 2" value={nouveau} onChange={(e) => setNouveau(e.target.value)} onKeyDown={surEntree} />
          </div>
          <button type="button" className="bouton-secondaire shrink-0" disabled={!nouveau.trim() || tables.length >= TABLES_MAX} onClick={ajouterTable}>
            Ajouter
          </button>
        </div>
        <p className="text-sm text-gray-600">Supprimer une table invalide son QR code. Renommer une table garde le même QR.</p>
      </div>

      <MessageErreur>{probleme ?? (erreur && `Commande à table non enregistrée : ${erreur}`)}</MessageErreur>
      <button type="button" className="bouton w-full" disabled={!!probleme || enCours || (!modifie && !enregistre)} onClick={() => void enregistrer()}>
        {enCours ? 'Enregistrement…' : enregistre && !modifie ? '✓ Commande à table enregistrée' : 'Enregistrer la commande à table'}
      </button>

      {qrs.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="etiquette mb-0">QR codes des tables</p>
            <button type="button" className="bouton-secondaire min-h-11 px-4 py-2 text-sm" onClick={() => setImpression(true)}>
              🖨 Imprimer les QR
            </button>
          </div>
          {modifie && <p className="text-sm text-amber-800">Modifications non enregistrées : les QR ci-dessous sont ceux des tables enregistrées.</p>}
          <ul className="grid gap-3 sm:grid-cols-2">
            {qrs.map((t) => {
              const lien = lienTable(baseApp(), commerce.id, t.jeton)
              return (
                <li key={t.jeton} className="space-y-2 rounded-2xl bg-gray-50 p-3 text-center ring-1 ring-gray-200">
                  <p className="font-semibold">{t.nom}</p>
                  <div className="flex justify-center">
                    <QrCode texte={lien} className="h-36 w-36" titre={`QR code de commande : ${t.nom}`} />
                  </div>
                  <BoutonCopier texte={lien} libelle="Copier le lien" className="bouton-secondaire w-full min-h-11 py-2 text-sm" />
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="text-sm text-gray-600">
        Écran cuisine (commandes reçues, à accepter puis servir) :{' '}
        <a href="#/cuisine" className="font-semibold text-magenta-700 underline">
          #/cuisine
        </a>{' '}
        — il arrive avec la prochaine étape du chantier.
      </p>

      {impression && <PlancheQr tables={qrs} commerceId={commerce.id} nomCommerce={commerce.nom} onFermer={() => setImpression(false)} />}
    </section>
  )
}

/** Vue « Imprimer les QR » : une planche simple (nom de la table + QR), seule partie imprimée (`data-impression-qr`). */
function PlancheQr({ tables, commerceId, nomCommerce, onFermer }: { tables: readonly TableCommande[]; commerceId: string; nomCommerce: string; onFermer: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-white p-6 text-gray-900" data-impression-qr role="dialog" aria-modal="true" aria-label="Planche des QR codes des tables">
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <button type="button" className="bouton" onClick={() => window.print()}>
          Imprimer
        </button>
        <button type="button" className="bouton-secondaire" onClick={onFermer}>
          Fermer
        </button>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
        {tables.map((t) => (
          <div key={t.jeton} className="break-inside-avoid rounded-2xl p-3 text-center ring-1 ring-gray-300">
            <p className="text-xl font-bold">{t.nom}</p>
            <QrCode texte={lienTable(baseApp(), commerceId, t.jeton)} className="mx-auto my-2 aspect-square w-full max-w-48" titre={`QR code de commande : ${t.nom}`} />
            <p className="text-sm">Scannez pour commander · {nomCommerce}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
