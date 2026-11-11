// Version anglaise des pages clientes (P2-Q1) : #/jouer, #/carte, #/menu. Le back-office reste en français.
// Logique pure (testée sans React) : le français est la clé, l'anglais la traduction ; une chaîne absente du
// dictionnaire reste en français (jamais de texte vide). Les noms de plats et de lots ne sont pas traduits.

export type Langue = 'fr' | 'en'

/** Choix mémorisé sur ce téléphone (localStorage). */
export const CLE_LANGUE = 'fideliz:langue'

/** Pages où le commutateur FR / EN est proposé (pages publiques du client final). */
export const PAGES_TRADUITES = ['jouer', 'carte', 'menu'] as const

export function estPageTraduite(page: string): boolean {
  return (PAGES_TRADUITES as readonly string[]).includes(page)
}

export function langueValide(v: unknown): Langue {
  return v === 'en' ? 'en' : 'fr'
}

export function lireLangue(stockage: Pick<Storage, 'getItem'> | null | undefined): Langue {
  try {
    return langueValide(stockage?.getItem(CLE_LANGUE))
  } catch {
    return 'fr'
  }
}

export function memoriserLangue(stockage: Pick<Storage, 'setItem'> | null | undefined, langue: Langue): void {
  try {
    stockage?.setItem(CLE_LANGUE, langue)
  } catch {
    // Stockage indisponible (navigation privée stricte) : le choix vaut pour cette page seulement.
  }
}

/** Libellés du commutateur : chaque langue est nommée dans sa propre langue. */
export const LIBELLES_LANGUE: Record<Langue, { court: string; long: string }> = {
  fr: { court: 'FR', long: 'Français' },
  en: { court: 'EN', long: 'English' },
}

/**
 * Dictionnaire français → anglais des chaînes principales : titres, boutons, navigation, messages de gain / perdu.
 * Les modèles `{x}` sont remplis par `traduire(modele, langue, { x })`.
 */
export const TRADUCTIONS_EN: Record<string, string> = {
  // ---- Accès à la carte (P0-S7) ----
  'tampons sur cette carte': 'stamps on this card',
  'Gain du jour à retirer : {lot}, code {code}': 'Today’s prize to collect: {lot}, code {code}',
  'Accès limité sur ce téléphone': 'Limited access on this phone',
  'Ce lien d’accès a expiré ou a déjà servi : demandez-en un nouveau.': 'This access link has expired or was already used: ask for a new one.',
  'Votre carte n’est plus ouverte sur ce téléphone': 'Your card is no longer open on this phone',
  'Pour des raisons de sécurité, l’accès a expiré ou a été retiré. Retrouvez votre carte avec votre téléphone ou votre e-mail, ou demandez au comptoir le QR d’accès à votre carte : vous pourrez ensuite tourner la roue.':
    'For security reasons, access has expired or was removed. Find your card with your phone number or e-mail, or ask at the counter for your card’s access QR code: you can then spin the wheel.',
  'Pour voir votre carte complète (points, messages, historique), ouvrez-la sur le téléphone utilisé à l’inscription, ou demandez au comptoir de vous montrer le QR d’accès à votre carte.':
    'To see your full card (points, messages, history), open it on the phone you signed up with, or ask at the counter to show you your card’s access QR code.',
  'Ce lien ne suffira plus à ouvrir la carte après le {date}.': 'This link will no longer open the card after {date}.',
  'Votre carte est maintenant protégée sur ce téléphone. Après le {date}, son ancien lien ou son ancien QR ne l’ouvriront plus seuls : gardez-la ici (ou ajoutez-la à l’écran d’accueil).':
    'Your card is now protected on this phone. After {date}, its old link or old QR code alone will no longer open it: keep it here (or add it to your home screen).',
  'Déconnecter cette carte de tous les téléphones, celui-ci compris ? Pour la rouvrir en entier, il faudra un lien d’accès du comptoir.':
    'Sign this card out of every phone, this one included? To open it in full again, you will need an access link from the counter.',
  'Sécurité de ma carte': 'My card’s security',
  'Téléphone perdu ou carte ouverte ailleurs ? Déconnectez-la partout : seul un lien d’accès du comptoir la rouvrira.':
    'Lost your phone, or card opened elsewhere? Sign it out everywhere: only an access link from the counter will open it again.',
  'Déconnecter tous mes appareils': 'Sign out all my devices',
  // ---- Commutateur ----
  'Langue': 'Language',
  // ---- Jeu (#/jouer) ----
  'Tournez la roue et gagnez un cadeau !': 'Spin the wheel and win a gift!',
  // Variante B du test A/B « accroche » (P2-Q3) : le libellé du lot n'est pas traduit (comme sur la roue).
  'Tournez la roue : {lot} à gagner !': 'Spin the wheel: {lot} to win!',
  'À gagner': 'Prizes',
  'Lots de la roue': 'Wheel prizes',
  'Roue de la chance : {n} lots à gagner, détaillés ci-dessous': 'Wheel of fortune: {n} prizes to win, listed below',
  '🎡 Tourner la roue{prenom} !': '🎡 Spin the wheel{prenom}!',
  'La roue tourne…': 'The wheel is spinning…',
  'Tirage en cours…': 'Drawing…',
  'Réessayer': 'Try again',
  'Réessayer maintenant': 'Try again now',
  'Serveur injoignable': 'Server unreachable',
  'Serveur injoignable — vérifiez la connexion.': 'Server unreachable — check your connection.',
  '1 participation par visite validée au comptoir, 1 tirage par jour. Tirage effectué par le serveur.':
    '1 spin per visit validated at the counter, 1 draw per day. The draw is made by the server.',
  'Données stockées dans ce navigateur uniquement. 1 participation par visite validée, 1 tirage par jour.':
    'Data stored in this browser only. 1 spin per validated visit, 1 draw per day.',
  'Données stockées dans ce navigateur uniquement.': 'Data stored in this browser only.',
  'QR code inconnu': 'Unknown QR code',
  'Ce QR code ne correspond à aucun commerce.': 'This QR code does not match any business.',
  'Le jeu de ce commerce n’est plus disponible.': 'This business’s game is no longer available.',
  'Aucun lot n’est configuré pour le moment.': 'No prizes have been set up yet.',
  'Un instant, la roue arrive.': 'One moment, the wheel is on its way.',
  'Vérification de votre carte…': 'Checking your card…',
  'Voir ma carte de fidélité': 'See my loyalty card',
  '📖 Voir le menu en attendant': '📖 See the menu while you wait',
  'C’est validé ? Vérifier maintenant': 'Validated? Check now',
  'Pour débloquer la roue': 'To unlock the wheel',
  'Plus que deux petites étapes avant de tourner la roue :': 'Just two quick steps before you spin the wheel:',
  'Présentez votre carte de fidélité en caisse.': 'Show your loyalty card at the counter.',
  'Revenez ici : la roue se débloque toute seule.': 'Come back here: the wheel unlocks by itself.',
  'En attente de validation…': 'Waiting for validation…',
  'Connexion perdue : impossible de vérifier votre visite pour le moment. Nous réessayons automatiquement dès le retour du réseau.':
    'Connection lost: your visit cannot be checked right now. We will try again automatically as soon as the network is back.',
  'Visite validée — à vous de jouer !': 'Visit validated — your turn to play!',
  '1 visite validée = 1 participation par jour.': '1 validated visit = 1 spin per day.',
  'Bonjour{prenom} !': 'Hello{prenom}!',
  'Vous avez déjà joué aujourd’hui{prenom} !': 'You have already played today{prenom}!',
  'Résultat du jour :': 'Today’s result:',
  '✓ Lot déjà remis au comptoir. Bon appétit !': '✓ Prize already collected at the counter. Enjoy your meal!',
  '1 tirage par personne et par jour. Prochaine chance à votre prochaine visite validée, dès demain.':
    '1 spin per person per day. Next chance at your next validated visit, from tomorrow.',
  'Re-bonjour': 'Welcome back',
  'Continuer en tant que {prenom}': 'Continue as {prenom}',
  'Continuer avec ma carte': 'Continue with my card',
  'Ce n’est pas moi': 'This is not me',
  'Pour jouer, votre téléphone ou votre e-mail suffit': 'To play, your phone number or e-mail is all you need',
  'Clavier du champ': 'Keyboard type',
  '📱 Téléphone': '📱 Phone',
  '✉️ E-mail': '✉️ E-mail',
  'Téléphone ou e-mail': 'Phone or e-mail',
  'Déjà client ? Le même numéro ou e-mail retrouve votre carte de fidélité.': 'Already a customer? The same number or e-mail finds your loyalty card.',
  'J’accepte de recevoir les offres de {commerce} par SMS ou e-mail (désinscription à tout moment).':
    'I agree to receive offers from {commerce} by text or e-mail (unsubscribe at any time).',
  'Vos données servent uniquement à votre carte de fidélité, jamais revendues :': 'Your data is only used for your loyalty card, never sold:',
  'Un instant…': 'One moment…',
  'C’est parti': 'Let’s go',
  'Saisissez un numéro (10 chiffres) ou un e-mail valide.': 'Enter a valid phone number (10 digits) or e-mail.',
  '✓ E-mail valide': '✓ Valid e-mail',
  '✓ Numéro valide': '✓ Valid number',
  'E-mail incomplet (ex. marie@exemple.fr).': 'Incomplete e-mail (e.g. marie@exemple.fr).',
  'Cet e-mail n’a pas l’air valide (ex. marie@exemple.fr).': 'This e-mail does not look valid (e.g. marie@exemple.fr).',
  'Ce numéro n’a pas l’air valide (ex. 06 12 34 56 78).': 'This number does not look valid (e.g. 06 12 34 56 78).',
  'Apple Wallet et Google Wallet arrivent bientôt ; en attendant, l’icône sur votre écran d’accueil ouvre directement votre carte.':
    'Apple Wallet and Google Wallet are coming soon; meanwhile, the icon on your home screen opens your card directly.',
  'Votre prénom (optionnel)': 'Your first name (optional)',
  'Votre prénom, pour que l’équipe vous reconnaisse ? (optionnel)': 'Your first name, so the team recognises you? (optional)',
  'Merci {prenom}, votre carte est à votre nom.': 'Thank you {prenom}, the card is now in your name.',
  // Résultat : gain / perdu.
  '{bravo}, vous avez gagné :': '{bravo}, you won:',
  'Bravo': 'Well done',
  'Pas de lot cette fois{prenom}… mais votre visite compte !': 'No prize this time{prenom}… but your visit counts!',
  'Votre visite du jour est bien enregistrée sur votre carte de fidélité : un tampon de plus vers votre récompense.':
    'Today’s visit is saved on your loyalty card: one more stamp towards your reward.',
  'Prochaine chance à votre prochaine visite validée au comptoir, dès demain.': 'Next chance at your next visit validated at the counter, from tomorrow.',
  'Montrez cet écran au comptoir pour profiter de votre lot.': 'Show this screen at the counter to collect your prize.',
  'Montrez ce code au serveur :': 'Show this code to the waiter:',
  'Le code est vérifié en caisse et ne sert qu’une fois.': 'The code is checked at the till and can only be used once.',
  'Copier le code': 'Copy the code',
  '✓ Copié': '✓ Copied',
  'Copie impossible : sélectionnez le texte': 'Copy failed: select the text',
  '📲 Garder ma carte sur mon téléphone': '📲 Keep my card on my phone',
  'Ouvrir ma carte': 'Open my card',
  'Politique de confidentialité': 'Privacy policy',
  'Démo': 'Demo',
  // Invitation à l'avis (après le jeu).
  'Vous avez aimé votre passage ?': 'Did you enjoy your visit?',
  'Votre avis compte — touchez une étoile pour ajuster, puis laissez votre avis sur Google.': 'Your opinion matters — tap a star to adjust, then leave your review on Google.',
  'Votre note': 'Your rating',
  '{n} étoile': '{n} star',
  '{n} étoiles': '{n} stars',
  'Décevant': 'Disappointing',
  'Moyen': 'Average',
  'Bien': 'Good',
  'Très bien': 'Very good',
  'Excellent': 'Excellent',
  'Laisser un avis 1★ sur Google': 'Leave a 1★ review on Google',
  'Laisser un avis 2★ sur Google': 'Leave a 2★ review on Google',
  'Laisser un avis 3★ sur Google': 'Leave a 3★ review on Google',
  'Laisser un avis 4★ sur Google': 'Leave a 4★ review on Google',
  'Laisser un avis 5★ sur Google': 'Leave a 5★ review on Google',
  'Google s’ouvre dans un nouvel onglet : sélectionnez-y vos étoiles et publiez votre avis.': 'Google opens in a new tab: choose your stars there and post your review.',
  'Sur Google, vous confirmez vous-même vos étoiles avant de publier.': 'On Google, you confirm your stars yourself before posting.',
  'Avis publié ? Revenir à ma carte de fidélité': 'Review posted? Back to my loyalty card',
  'Le lot n’est pas conditionné à l’avis — gagnez d’abord, avis libre ensuite.': 'The prize never depends on a review — win first, review freely afterwards.',
  // ---- Carte (#/carte) ----
  'Carte de fidélité': 'Loyalty card',
  'Titulaire': 'Holder',
  'tampons': 'stamps',
  'points': 'points',
  'point': 'point',
  'Tampons : {n} sur {total}': 'Stamps: {n} of {total}',
  'Tampon {i} : obtenu': 'Stamp {i}: earned',
  'Tampon {i} : à obtenir': 'Stamp {i}: to earn',
  'Tampon {i} : récompense': 'Stamp {i}: reward',
  'Progression vers la récompense': 'Progress towards the reward',
  'Carte complète': 'Card complete',
  'Récompense en attente': 'Reward waiting',
  'À demander au comptoir.': 'Ask for it at the counter.',
  'Objectif :': 'Goal:',
  'À retirer au comptoir': 'To collect at the counter',
  'Code à montrer :': 'Code to show:',
  'Valable aujourd’hui seulement': 'Valid today only',
  'Sans date limite': 'No expiry date',
  'Vos points': 'Your points',
  'À présenter en caisse pour valider votre visite': 'Show at the till to validate your visit',
  'Dernière visite :': 'Last visit:',
  'aucune pour l’instant': 'none yet',
  'Messages': 'Messages',
  'Historique des visites et des lots': 'Visit and prize history',
  'Aucune visite pour l’instant : votre premier tampon arrive au comptoir.': 'No visits yet: your first stamp is waiting at the counter.',
  'Votre lien personnel': 'Your personal link',
  'Votre lien personnel :': 'Your personal link:',
  'Copier mon lien': 'Copy my link',
  '🎡 Tourner la roue du jour': '🎡 Spin today’s wheel',
  '📖 Voir le menu': '📖 See the menu',
  'Le restaurant': 'The restaurant',
  'Carte introuvable': 'Card not found',
  'Ce lien ne correspond à aucune carte de fidélité.': 'This link does not match any loyalty card.',
  'Carte indisponible': 'Card unavailable',
  'La carte de fidélité de ce commerce n’est plus disponible.': 'This business’s loyalty card is no longer available.',
  'Un instant, votre carte arrive.': 'One moment, your card is on its way.',
  'Carte à jour.': 'Card up to date.',
  'Hors ligne : carte affichée telle qu’au dernier chargement.': 'Offline: card shown as last loaded.',
  'Votre profil': 'Your profile',
  'Enregistrer mon profil': 'Save my profile',
  'J’ai oublié de scanner': 'I forgot to scan',
  'Date de la visite': 'Date of the visit',
  'Montant payé (€)': 'Amount paid (€)',
  'N° de ticket (optionnel)': 'Receipt number (optional)',
  'Envoyer ma demande': 'Send my request',
  'Mes données personnelles': 'My personal data',
  'Recevoir mes données': 'Get my data',
  'Demander la suppression': 'Request deletion',
  'Votre téléphone ou e-mail (celui de l’inscription)': 'Your phone or e-mail (the one used to sign up)',
  'Retrouver ma carte': 'Find my card',
  'Téléphone ou e-mail donné à l’inscription': 'Phone or e-mail given when signing up',
  // ---- Menu (#/menu) ----
  'Menu': 'Menu',
  'Menu introuvable': 'Menu not found',
  'Ce lien ne correspond à aucun commerce.': 'This link does not match any business.',
  'Menu indisponible': 'Menu unavailable',
  'Le menu de ce commerce n’est plus disponible.': 'This business’s menu is no longer available.',
  'Un instant, le menu arrive.': 'One moment, the menu is on its way.',
  'Menu à venir': 'Menu coming soon',
  'Le commerce n’a pas encore publié son menu.': 'The business has not published its menu yet.',
  'Cuisine asiatique halal · Thaï, Japon, Vietnam, Chine': 'Halal Asian cuisine · Thai, Japanese, Vietnamese, Chinese',
  'Contacter le restaurant': 'Contact the restaurant',
  'C’est l’heure du Menu Midi !': 'It’s Lunch Menu time!',
  'Formules du lundi au vendredi, jusqu’à 14h30.': 'Set menus Monday to Friday, until 2:30 pm.',
  'Voir': 'See',
  'Rechercher un plat': 'Search for a dish',
  '🔍 Rechercher un plat… (ex : dynamite, maki)': '🔍 Search for a dish… (e.g. dynamite, maki)',
  'Catégories': 'Categories',
  'Toutes': 'All',
  'Aucun plat ne correspond à « {recherche} ».': 'No dish matches “{recherche}”.',
  '{n} plat': '{n} dish',
  '{n} plats': '{n} dishes',
  ' pour « {recherche} »': ' for “{recherche}”',
  'Prix sur place': 'Price on site',
  'Prix :': 'Price:',
  'sur place': 'on site',
  'Description à venir — demandez conseil à l’équipe.': 'Description coming soon — ask the team for advice.',
  'Allergènes :': 'Allergens:',
  '★ Signature': '★ Signature',
  '★ Plat signature — l’un des best-sellers du restaurant.': '★ Signature dish — one of the restaurant’s best-sellers.',
  'Allergènes : demandez conseil à l’équipe en cas de doute.': 'Allergens: ask the team for advice if in doubt.',
  'Photo du plat : {nom}': 'Photo of the dish: {nom}',
}

/** Traduit un texte français (ou un modèle `{x}`) ; sans traduction connue, le français reste affiché. */
export function traduire(fr: string, langue: Langue, valeurs: Record<string, string | number> = {}): string {
  const modele = langue === 'en' ? (TRADUCTIONS_EN[fr] ?? fr) : fr
  return modele.replace(/\{(\w+)\}/g, (tout, cle: string) => (cle in valeurs ? String(valeurs[cle]) : tout))
}

/** « Encore 3 repas avant votre plat offert » → « 3 more meals until your free dish » (même règle que `texteProgression`). */
export function texteProgressionLangue<C extends { type: string; recompense: string }>(restants: number, commerce: C, langue: Langue, fr: (n: number, c: C) => string): string {
  if (langue === 'fr') return fr(restants, commerce)
  if (restants <= 0) return 'Card complete'
  const unite = commerce.type === 'restaurant' ? `meal${restants > 1 ? 's' : ''}` : `visit${restants > 1 ? 's' : ''}`
  const cible = /plat offert/i.test(commerce.recompense) ? 'your free dish' : 'your reward'
  return `${restants} more ${unite} until ${cible}`
}

/** « Valable aujourd’hui, mar. 10 nov. 2026 » / « Valid today, Tue 10 Nov 2026 » (même jour que `jourEnClair`). */
export function texteValiditeLangue(maintenant: Date, langue: Langue, fr: (d: Date) => string): string {
  if (langue === 'fr') return fr(maintenant)
  const jour = maintenant.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  return `Valid today, ${jour}`
}
