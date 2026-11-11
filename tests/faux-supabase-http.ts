// Faux PostgREST minimal sur HTTP, juste de quoi laisser `server/index.ts` démarrer avec Supabase configuré
// (P0-S9 : les tests spawn en production doivent désormais fournir SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
// Il ne simule PAS une base : chaque lecture rend une liste vide, chaque écriture renvoie la ligne écrite.
// Suffisant pour le démarrage — `initialiser` (meta absente → seed du commerce Asian Home) et
// `exigerMigrationsAudit` (select limit 0 → pas d'erreur → migrations présentes) — et rien de plus. Pour des tests
// métier sur Supabase, utiliser le faux PostgREST complet de tests/supabase.test.ts (fetch injecté, en mémoire).
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export async function demarrerFauxSupabaseHttp(): Promise<{ serveur: Server; url: string; fermer: () => Promise<void> }> {
  const serveur: Server = createServer((req, res) => {
    let corps = ''
    req.on('data', (c) => (corps += c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.method === 'POST' || req.method === 'PATCH') {
        // Upsert / insert : PostgREST renvoie la ou les lignes écrites.
        res.statusCode = 201
        res.end(JSON.stringify(corps ? [JSON.parse(corps)] : []))
      } else {
        // Lecture : base vide (y compris les `select ... limit 0` des vérifications de migrations).
        res.setHeader('content-range', '*/0')
        res.end('[]')
      }
    })
  })
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`
  return { serveur, url, fermer: () => new Promise<void>((ok) => serveur.close(() => ok())) }
}
