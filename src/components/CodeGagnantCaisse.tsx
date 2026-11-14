import { lazy, Suspense, useCallback, useRef, useState, type FormEvent } from 'react'
import { ErreurApi, type GainCaisse } from '../data/api'
import { messageErreur } from '../store'
import { messageGain, normaliserCodeGagnant } from '../lib/roulette'
import { nomAffiche } from '../lib/inscriptionJeu'
import { MessageErreur } from './ui'

/** Scan du code gagnant (P1-4) : chargé en différé, hors bundle initial — il ne sert que quand la caisse appuie sur « Scanner le code ». */
const ScanCodeGagnant = lazy(() => import('./ScanCodeGagnant').then((m) => ({ default: m.ScanCodeGagnant })))

/**
 * Code gagnant de la roue (P0-U3) : le client le montre, l'équipe le saisit, vérifie le lot puis le marque remis.
 * P1-4 : le code est aussi affiché en QR sur le téléphone du client (voir QrCodeGain) : la caisse peut le scanner
 * (vérification automatique à la lecture) ; la saisie manuelle reste le repli, caméra refusée ou non.
 * Module différé (hors bundle initial) : la caisse charge cette section à l'ouverture, comme les autres écrans
 * commerçant ; le temps du chargement, un repli de même forme garde la mise en page.
 */
export function CodeGagnantCaisse({ onGain }: { onGain(quoi: 'verifier' | 'remettre', code: string): Promise<GainCaisse> }) {
  const [saisi, setSaisi] = useState('')
  const [gain, setGain] = useState<GainCaisse | null>(null)
  const [remisIci, setRemisIci] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [scannerGain, setScannerGain] = useState(false)
  const saisieRef = useRef<HTMLInputElement>(null)
  const code = normaliserCodeGagnant(saisi)

  const appeler = useCallback(
    async (quoi: 'verifier' | 'remettre', c: string) => {
      setEnCours(true)
      setErreur(null)
      try {
        setGain(await onGain(quoi, c))
        setRemisIci(quoi === 'remettre')
      } catch (e) {
        setErreur(messageErreur(e))
        // Remise refusée (déjà remise par une autre caisse entre-temps…) : on réaffiche l'état à jour du code.
        if (quoi === 'remettre' && e instanceof ErreurApi && (e.statut === 409 || e.statut === 410)) {
          setGain(await onGain('verifier', c).catch(() => null))
        } else setGain(null)
      } finally {
        setEnCours(false)
      }
    },
    [onGain],
  )

  function verifier(e: FormEvent) {
    e.preventDefault()
    if (!code || enCours) return
    void appeler('verifier', code)
  }

  /** Code scanné (QR du gain) : le panneau se referme, le code remplit la saisie et il est vérifié tout de suite,
   * sans frappe. Mémorisé : le panneau de scan redémarre sa caméra à chaque changement d'`onCode`, il ne doit pas
   * bouger pendant le scan. */
  const surCodeVerifie = useCallback(
    (codeLu: string) => {
      setScannerGain(false)
      setSaisi(codeLu)
      setErreur(null)
      void appeler('verifier', codeLu)
    },
    [appeler],
  )

  const date = gain && new Date(gain.date)
  return (
    <section className="carte space-y-3" aria-labelledby="caisse-gain-titre">
      <h2 id="caisse-gain-titre" className="titre-carte">
        🎡 Code gagnant de la roue
      </h2>
      {scannerGain ? (
        <Suspense fallback={<p className="text-sm text-gray-600">Ouverture de la caméra…</p>}>
          <ScanCodeGagnant
            onCode={surCodeVerifie}
            onFermer={() => setScannerGain(false)}
            onSaisieManuelle={() => (setScannerGain(false), setTimeout(() => saisieRef.current?.focus(), 0))}
          />
        </Suspense>
      ) : (
        <>
          <button type="button" className="bouton-secondaire w-full" onClick={() => setScannerGain(true)}>
            📷 Scanner le code
          </button>
          <form onSubmit={verifier} className="flex gap-2">
            <label className="sr-only" htmlFor="caisse-code-gagnant">
              Code gagnant (6 caractères)
            </label>
            <input
              ref={saisieRef}
              id="caisse-code-gagnant"
              className="champ min-w-0 flex-1 text-center font-mono text-xl tracking-[0.3em] uppercase"
              placeholder="ABC234"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={11}
              value={saisi}
              onChange={(e) => {
                setSaisi(e.target.value.toUpperCase())
                setGain(null)
                setErreur(null)
              }}
              aria-invalid={!!erreur}
              aria-describedby="caisse-code-aide"
            />
            <button type="submit" className="bouton shrink-0" disabled={!code || enCours}>
              {enCours ? '…' : 'Vérifier'}
            </button>
          </form>
        </>
      )}
      <p id="caisse-code-aide" className="text-sm text-gray-600">
        6 lettres ou chiffres, affichés sur le téléphone du client. Majuscules et espaces sans importance. Gain utilisable du lendemain du tirage à 30 jours, code valable 10 minutes après activation par le client.
      </p>
      <MessageErreur>{erreur}</MessageErreur>
      {gain && date && (
        <div className="space-y-2 rounded-xl bg-gray-50 p-3 ring-1 ring-gray-200">
          <p className="font-titre text-2xl font-bold">{gain.lot}</p>
          <p className="text-sm text-gray-700">
            {gain.client ? <strong>{nomAffiche(gain.client.prenom)}</strong> : 'Client supprimé'} · tiré le {date.toLocaleDateString('fr-FR')} à{' '}
            {date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} · code <span className="font-mono">{gain.code}</span>
          </p>
          {gain.statut === 'utilisable' ? (
            <button className="bouton min-h-14 w-full bg-green-700 text-lg hover:bg-green-800 active:bg-green-900" disabled={enCours} onClick={() => void appeler('remettre', gain.code)}>
              🎁 Marquer remis
            </button>
          ) : remisIci ? (
            <p className="alerte-succes apparition" role="status">
              ✓ Lot remis{gain.client ? ` à ${nomAffiche(gain.client.prenom)}` : ''} : {gain.lot}. Le code ne pourra plus resservir.
            </p>
          ) : (
            !erreur && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200" role="alert">
                {messageGain(gain)}
              </p>
            )
          )}
        </div>
      )}
    </section>
  )
}
