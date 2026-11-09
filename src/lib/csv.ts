// Export CSV des clients : même fonction pour le serveur (GET /export.csv) et le mode local du front.
import type { Client } from '../types'

function celluleCsv(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v)
  // Anti-injection de formules (Excel / LibreOffice), sauf pour un numéro de téléphone « +33… ».
  if (/^[=+\-@\t\r]/.test(s) && !/^\+[\d\s.\-()]+$/.test(s)) s = `'${s}`
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV « à la française » (séparateur ;, BOM UTF-8) : s'ouvre tel quel dans Excel. */
export function clientsEnCsv(clients: Client[]): string {
  const entete = ['prenom', 'telephone', 'email', 'tampons', 'visites', 'derniereVisite', 'creeLe']
  const lignes = clients.map((c) =>
    [c.prenom, c.telephone, c.email, c.tampons, c.visites.length, c.derniereVisite, c.creeLe].map(celluleCsv).join(';'),
  )
  return '﻿' + [entete.join(';'), ...lignes].join('\r\n') + '\r\n'
}

/** Nom de fichier proposé au téléchargement (même forme que le serveur). */
export function nomFichierCsv(commerceId: string): string {
  return `clients-${commerceId}.csv`.replace(/[^\w.-]/g, '_')
}
