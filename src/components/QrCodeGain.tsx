import { lazy, Suspense } from 'react'
import { ErreurQr } from './CarteFidelite'
import { useLangue } from './Langue'

/**
 * QR du code gagnant (P1-4) : le même code que celui affiché en texte sur la carte du client, en QR pour que la
 * caisse le scanne au lieu de le taper. Module différé comme le QR personnel : `qrcode-generator` ne pèse pas sur
 * le bundle initial, et la frontière d'erreur locale ne montre qu'un repli sous le code (le code en texte reste
 * lisible, la page reste debout).
 */
const QrCode = lazy(() => import('./QrCode').then((m) => ({ default: m.QrCode })))

export function QrCodeGain({ code }: { code: string }) {
  const { t } = useLangue()
  return (
    <>
      <ErreurQr message={t('QR indisponible — le code ci-dessus suffit, la caisse peut le saisir.')}>
        <Suspense fallback={<div className="h-40 w-40 bg-white" aria-hidden="true" />}>
          <QrCode texte={code} className="h-40 w-40" titre={t('QR code du gain à présenter au comptoir')} />
        </Suspense>
      </ErreurQr>
      <p className="text-sm text-gray-600">{t('Ou présentez ce QR au comptoir.')}</p>
    </>
  )
}
