// Parcours HTTP complet (V2 refait après V3 + routes V3) contre un serveur lancé : `npm run serveur`, puis
// `node scripts/preuve-http-v3.mjs [http://localhost:3001]`. PIN admin de développement 000000 (jamais en production).
const base = (process.argv[2] ?? 'http://localhost:3001') + '/api/v1'
const ADMIN = { 'X-Admin-PIN': process.env.ADMIN_PIN ?? '000000' }

async function appel(titre, methode, chemin, corps, entetes = {}) {
  const r = await fetch(base + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  })
  const brut = Buffer.from(await r.arrayBuffer())
  const type = r.headers.get('content-type') ?? ''
  const contenu = type.includes('json') ? JSON.parse(brut.toString('utf8')) : brut.toString('utf8')
  const apercu = type.includes('csv') ? `[CSV ${brut.length} o, 3 premiers octets ${brut.subarray(0, 3).toString('hex')}] ${contenu.slice(1, 80).replace(/\r?\n/g, ' | ')}` : JSON.stringify(contenu)
  console.log(`${methode} ${chemin} — ${titre}\n  → HTTP ${r.status} ${apercu.slice(0, 400)}\n`)
  return { statut: r.status, contenu }
}

const nom = `Preuve V3 ${new Date().toISOString().slice(0, 19)}`
await appel('santé + état des intégrations', 'GET', '/sante')
const { contenu: cree } = await appel('créer commerce + PIN (admin)', 'POST', '/commerces', { nom, type: 'restaurant', pin: '4321' }, ADMIN)
const id = cree.commerce.id
const PIN = { 'X-Commerce-PIN': '4321' }
const { contenu: insc } = await appel('inscrire un client', 'POST', `/commerces/${id}/clients`, { prenom: 'Lina', contact: '06 12 34 56 78' }, PIN)
const cid = insc.client.id
await appel('tirage SANS visite du jour → 409 attendu', 'POST', `/commerces/${id}/tirages`, { contact: '0612345678' })
await appel('valider la visite', 'POST', `/commerces/${id}/clients/${cid}/visite`, undefined, PIN)
await appel('tirage (lot tiré par le serveur)', 'POST', `/commerces/${id}/tirages`, { contact: '+33 6 12 34 56 78' })
await appel('2e tirage, autre format du numéro → 409 attendu', 'POST', `/commerces/${id}/tirages`, { contact: '0033612345678' })
await appel('carte publique (sans contact)', 'GET', `/cartes/${cid}`)
await appel('export CSV (PIN)', 'GET', `/commerces/${id}/export.csv`, undefined, PIN)
await appel('export CSV sans PIN → 401 attendu', 'GET', `/commerces/${id}/export.csv`)
console.log('--- V3 ---\n')
await appel('pass Google Wallet sans configuration → 501 attendu', 'GET', `/commerces/${id}/clients/${cid}/pass.json`, undefined, PIN)
await appel('pass Apple → 404 attendu (en suspens, aucune route)', 'GET', `/commerces/${id}/clients/${cid}/pass.pkpass`, undefined, PIN)
await appel('relance SMS sans prestataire → 501 attendu', 'POST', `/commerces/${id}/clients/${cid}/relance`, { canal: 'sms' }, PIN)
await appel('relance e-mail sans prestataire → 501 attendu', 'POST', `/commerces/${id}/clients/${cid}/relance`, { canal: 'email' }, PIN)
const { contenu: ah } = await appel('Asian Home Paris (DEMO=0)', 'GET', '/commerces/c-asian-home-paris/etat', undefined, ADMIN)
console.log(`  Asian Home Paris : ${ah.avis.length} avis, ${ah.clients.length} client(s), ${ah.tirages.length} tirage(s) ; demo=${ah.commerce.demo}`)
