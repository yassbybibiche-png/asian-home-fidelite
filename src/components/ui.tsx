import { useMemo, useState, type ReactNode } from 'react'
import qrcode from 'qrcode-generator'
import type { Commerce } from '../types'
import { initiales } from '../lib/format'
import { estLogoLocal, logoCommerce } from '../lib/visuels'
import { ETATS_WALLET, EXPLICATION_WALLET, LIBELLE_WALLET, MENTIONS_RGPD } from '../lib/integrations'

export function LogoCommerce({ commerce, taille = 'md' }: { commerce: Pick<Commerce, 'id' | 'nom' | 'logo'>; taille?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'h-9 w-9 text-sm', md: 'h-11 w-11 text-base', lg: 'h-16 w-16 text-xl' }[taille]
  const logo = logoCommerce(commerce)
  if (logo && (/^https?:\/\//i.test(logo) || logo.startsWith('/'))) {
    // Logo local d'Asian Home (blanc sur noir) : fond sombre, jamais sur blanc.
    return <img src={logo} alt={`Logo ${commerce.nom}`} className={`${dims} shrink-0 rounded-xl object-cover ring-1 ring-gray-200 ${estLogoLocal(logo) ? 'bg-gray-950' : 'bg-white'}`} />
  }
  return (
    <span
      className={`${dims} inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-marque-500 to-marque-700 font-bold tracking-wide text-white shadow-sm ring-1 ring-black/5`}
      aria-hidden
    >
      {(logo || initiales(commerce.nom)).slice(0, 3).toUpperCase()}
    </span>
  )
}

export function Etoiles({ note }: { note: number }) {
  return (
    <span className="whitespace-nowrap tracking-wider text-amber-500" role="img" aria-label={`${note} sur 5`}>
      {'★'.repeat(note)}
      <span className="text-gray-300">{'★'.repeat(5 - note)}</span>
    </span>
  )
}

export function BadgeDemo({ children = 'Démo' }: { children?: ReactNode }) {
  return <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{children}</span>
}

export function EnTete({ titre, sousTitre, action }: { titre: string; sousTitre?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-titre text-[1.75rem] font-bold tracking-tight text-gray-900">{titre}</h1>
        {sousTitre && <p className="mt-1 text-[0.95rem] text-gray-600">{sousTitre}</p>}
      </div>
      {action}
    </div>
  )
}

export function Interrupteur({ actif, onChange, libelle, aide }: { actif: boolean; onChange: (v: boolean) => void; libelle: string; aide?: string }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2">
      <span>
        <span className="block font-medium">{libelle}</span>
        {aide && <span className="block text-sm text-gray-500">{aide}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={actif}
        onClick={() => onChange(!actif)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${actif ? 'bg-marque-500' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${actif ? 'translate-x-6' : ''}`} />
      </button>
    </label>
  )
}

export function Vide({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-gray-300 bg-white/60 p-6 text-center text-gray-600">{children}</p>
}

const CHEMINS: Record<string, string> = {
  accueil: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  clients: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M15.5 3.13a3.5 3.5 0 010 6.75',
  roulette: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4',
  avis: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9z',
  reglages: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  offre: 'M20 12v8H4v-8M2 7h20v5H2zM12 20V7M12 7a3 3 0 10-3-3c0 1.7 3 3 3 3zm0 0a3 3 0 113-3c0 1.7-3 3-3 3z',
  admin: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
  plus: 'M5 12h.01M12 12h.01M19 12h.01',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
  caisse: 'M4 10h16v10H4zM7 10V6h10v4M8 14h2M14 14h2M8 17h8',
  equipe: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9',
  messages: 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5',
  menuCarte: 'M6 3h12v18H6zM9 7h6M9 11h6M9 15h4',
}

export function Icone({ nom, className = 'h-6 w-6' }: { nom: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={nom === 'plus' ? 3.5 : 1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={CHEMINS[nom]} />
    </svg>
  )
}

/** QR code dessiné en SVG, généré localement (aucun appel réseau). */
export function QrCode({ texte, className = 'h-48 w-48', titre }: { texte: string; className?: string; titre?: string }) {
  const { d, taille } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(texte)
    qr.make()
    const n = qr.getModuleCount()
    let chemin = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) chemin += `M${x + 4} ${y + 4}h1v1h-1z`
    // Marge blanche de 4 modules autour (zone de silence exigée par la norme QR).
    return { d: chemin, taille: n + 8 }
  }, [texte])
  return (
    <svg viewBox={`0 0 ${taille} ${taille}`} className={`${className} bg-white`} role="img" aria-label={titre ?? 'QR code'} shapeRendering="crispEdges">
      <path d={d} fill="#111827" />
    </svg>
  )
}

/** Copie dans le presse-papiers, avec repli pour les navigateurs sans API Clipboard (http local). */
export async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte)
    return true
  } catch {
    const zone = document.createElement('textarea')
    zone.value = texte
    zone.setAttribute('readonly', '')
    zone.style.position = 'fixed'
    zone.style.opacity = '0'
    document.body.appendChild(zone)
    try {
      zone.select()
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      zone.remove()
    }
  }
}

/** Message d'erreur d'une action (annoncé aux lecteurs d'écran). */
export function MessageErreur({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200" role="alert">
      <span aria-hidden className="font-bold">
        !
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Propose un fichier au téléchargement (généré dans le navigateur ou reçu du serveur). */
export function telecharger(nom: string, contenu: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenu], { type }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function BoutonCopier({ texte, libelle = 'Copier le message', className = 'bouton-secondaire' }: { texte: string; libelle?: string; className?: string }) {
  const [resultat, setResultat] = useState<'' | 'ok' | 'echec'>('')
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        setResultat((await copier(texte)) ? 'ok' : 'echec')
        setTimeout(() => setResultat(''), 2000)
      }}
    >
      {resultat === 'ok' ? '✓ Copié' : resultat === 'echec' ? 'Copie impossible : sélectionnez le texte' : libelle}
    </button>
  )
}

/**
 * Wallet : simple encart d'information, JAMAIS un bouton « Ajouter » (aucun pass n'existe).
 * Apple Wallet en suspens, Google Wallet à brancher ; en attendant, la carte web et son QR suffisent.
 */
export function EncartWallet({ demo = false, lienCarte }: { demo?: boolean; lienCarte?: string }) {
  return (
    <section className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-700 ring-1 ring-gray-200" aria-label={LIBELLE_WALLET}>
      <p className="flex items-center gap-2 font-semibold text-gray-900">
        <span aria-hidden>👛</span> {LIBELLE_WALLET} {demo && <BadgeDemo>Démo</BadgeDemo>}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {ETATS_WALLET.map((e) => (
          <li key={e}>· {e}</li>
        ))}
      </ul>
      <p className="mt-1.5">{EXPLICATION_WALLET}</p>
      {lienCarte && (
        <a href={lienCarte} className="mt-1 flex min-h-11 items-center font-semibold text-marque-700 underline">
          Ouvrir la carte publique (QR) ↗
        </a>
      )}
    </section>
  )
}

/** Mentions RGPD courtes (Plus, Offre). */
export function BlocRgpd() {
  return (
    <section className="carte">
      <h2 className="titre-carte">Données personnelles (RGPD)</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600">
        {MENTIONS_RGPD.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </section>
  )
}
