import { joursDepuis } from './stats'

const formatDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export function dateCourte(iso: string): string {
  return formatDate.format(new Date(iso))
}

/** « aujourd'hui », « hier », « il y a 5 j », puis la date. */
export function dateRelative(iso: string): string {
  const j = joursDepuis(iso)
  if (j <= 0) return 'aujourd’hui'
  if (j === 1) return 'hier'
  if (j < 30) return `il y a ${j} j`
  return dateCourte(iso)
}

export function initiales(nom: string): string {
  return (
    nom
      .replace(/[’']/g, ' ')
      .split(/\s+/)
      .filter((m) => m.length > 2 || /^[A-ZÀ-Ý]/.test(m))
      .filter((m) => !/^(le|la|les|des|du|de|l)$/i.test(m))
      .slice(0, 2)
      .map((m) => m[0].toUpperCase())
      .join('') || nom.slice(0, 2).toUpperCase()
  )
}
