// Carte réelle d'Asian Home Paris — 7 catégories, 39 plats (docs/menu-reel.json).
// Source : Uber Eats, boutique « Asian Home » (crawls 01/09 et 21/10/2026),
// fermée depuis le 06/02/2026 ; détails et limites dans docs/MENU-REEL.md.
//
// AUCUN PRIX N'A PU ÊTRE VÉRIFIÉ : tous les prix sont null et s'affichent
// « Prix sur place » — jamais de montant inventé. Aucun allergène indiqué
// nulle part non plus (listes vides). Photos : uniquement les vraies photos
// du restaurant dans public/visuels/ (voir public/visuels/SOURCES.md).
//
// - « Mi Prat » ← menu-nouilles-crevettes.jpg : identification PROBABLE
//   (nouilles sautées aux crevettes ; conviendrait aussi au Pad Thai crevettes).
// - « Tiramisu » : cité dans des avis clients, absent de la carte Uber Eats —
//   à confirmer sur place ; affiché sans description (rien d'inventé).
// - menu-plat-riz.jpg : plat thaï non identifié — photo d'ambiance uniquement,
//   jamais rattachée à un plat nommé.
import type { Menu } from '../types'
import { ID_ASIAN_HOME } from '../lib/visuels.ts'

/** Plats signature mis en avant (best-sellers cités dans les avis et sur Instagram). */
export const PLATS_SIGNATURE = ['Dynamite', 'Thaï-sty Krusty', 'Duo Love Bao', 'Loc Lac', '8 Maki Dragon', '8 Maki Tiger'] as const

export const estSignature = (nom: string): boolean => (PLATS_SIGNATURE as readonly string[]).includes(nom)

/** La carte réelle, prête à afficher ou à enregistrer comme menu du commerce. */
export function menuReelAsianHome(): Menu {
  return {
    commerceId: ID_ASIAN_HOME,
    majLe: '',
    categories: [
      {
        id: "reel-cat-1",
        nom: "Nos Entrées",
        produits: [
          { id: "reel-c1-p1", nom: "Choux", prix: null, allergenes: [] },
          { id: "reel-c1-p2", nom: "Soupe Miso", prix: null, allergenes: [] },
          { id: "reel-c1-p3", nom: "Riz Nature", prix: null, allergenes: [] },
          { id: "reel-c1-p4", nom: "Tartare Saumon, Avocat", prix: null, allergenes: [] },
          { id: "reel-c1-p5", nom: "Riz Thaï", prix: null, allergenes: [] },
        ],
      },
      {
        id: "reel-cat-2",
        nom: "Asian Street Food",
        produits: [
          { id: "reel-c2-p1", nom: "Thaï-sty Krusty", prix: null, description: "Un savoureux riz blanc ou thaï généreusement nappé de notre sauce maison, accompagné de crousti poulet fondant à l'intérieur, croustillant à l'extérieur, le tout relevé par une seconde sauce maison pleine de caractère. Servi avec une boisson.", allergenes: [] },
          { id: "reel-c2-p2", nom: "Dynamite", prix: null, description: "Dynamite Poulet ou Crevettes au choix, nos best-sellers ! Des bouchées croustillantes garnies de poulet ou de crevettes fondantes, enrobées dans une sauce dynamite maison légèrement épicée, crémeuse et addictive.", allergenes: [] },
          { id: "reel-c2-p3", nom: "Duo Love Bao", prix: null, description: "Duo de Bao Burgers : poulet & crevette, accompagné de concombre croquant. 2 pcs.", allergenes: [] },
          { id: "reel-c2-p4", nom: "Brochettes bœuf fromage", prix: null, description: "Fait maison, 2 pièces.", allergenes: [] },
          { id: "reel-c2-p5", nom: "Nemus au poulet x4", prix: null, allergenes: [] },
          { id: "reel-c2-p6", nom: "Gyoza crevette x4", prix: null, allergenes: [] },
          { id: "reel-c2-p7", nom: "Crevettes tempura", prix: null, description: "4 pièces.", allergenes: [] },
        ],
      },
      {
        id: "reel-cat-3",
        nom: "Côté thaï",
        produits: [
          { id: "reel-c3-p1", nom: "Bo Bun", prix: null, description: "Vermicelle de riz, bœuf ou poulet ou crevette, nems, légumes.", allergenes: [] },
          { id: "reel-c3-p2", nom: "Loc Lac", prix: null, description: "Riz rouge, poulet ou bœuf caramélisé, œuf, salade.", photo: "/visuels/menu-loc-lac.jpg", allergenes: [] },
          { id: "reel-c3-p3", nom: "Tigre qui pleure", prix: null, description: "Émincé de bœuf sauce thaï, riz nature ou riz thaï.", allergenes: [] },
          { id: "reel-c3-p4", nom: "Pad Thai", prix: null, description: "Poulet, bœuf ou crevette, nouilles de riz, légumes sautés.", allergenes: [] },
          { id: "reel-c3-p5", nom: "Khao Prat", prix: null, description: "Poulet, bœuf ou crevette, riz thaï sauté wok.", allergenes: [] },
          { id: "reel-c3-p6", nom: "Curry Vert", prix: null, description: "Poulet ou crevette, riz blanc, velouté de curry, légumes croquants.", allergenes: [] },
          { id: "reel-c3-p7", nom: "Mi Prat", prix: null, description: "Poulet, bœuf ou crevette, nouilles sautées, légumes sautés.", photo: "/visuels/menu-nouilles-crevettes.jpg", allergenes: [] },
          { id: "reel-c3-p8", nom: "Crousti Poulet", prix: null, description: "Poulet croustillant doré façon thaï, riz nature ou riz thaï.", allergenes: [] },
          { id: "reel-c3-p9", nom: "Bœuf Basilic", prix: null, description: "Bœuf mariné façon thaï, légumes, basilic, riz nature.", allergenes: [] },
        ],
      },
      {
        id: "reel-cat-4",
        nom: "Côté Jap",
        produits: [
          { id: "reel-c4-p1", nom: "Maki Pink par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p2", nom: "California par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p3", nom: "Maki Black par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p4", nom: "Sushi par 2", prix: null, description: "2 pièces.", allergenes: [] },
          { id: "reel-c4-p5", nom: "Maki Green par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p6", nom: "Sashimi par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p7", nom: "Sashimi Thon par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p8", nom: "Maki Neige par 6", prix: null, allergenes: [] },
          { id: "reel-c4-p9", nom: "8 Maki Dragon", prix: null, description: "Poulet croustillant, avocat, cheese, sauce chili-thaï, avocat, nappé d'une sauce mayo spicy faite maison, oignons frits.", photo: "/visuels/menu-makis.jpg", allergenes: [] },
          { id: "reel-c4-p10", nom: "8 Maki Tiger", prix: null, description: "Crevette tempura, avocat, cheese, saumon mi-cuit, avocat, nappé d'une sauce mayo spicy faite maison.", photo: "/visuels/menu-makis.jpg", allergenes: [] },
        ],
      },
      {
        id: "reel-cat-5",
        nom: "Nos Poke Bowl",
        produits: [
          { id: "reel-c5-p1", nom: "Poke Bowl", prix: null, description: "Composez votre pokebowl avec des ingrédients frais et savoureux, servi avec riz vinaigré et une boisson.", allergenes: [] },
        ],
      },
      {
        id: "reel-cat-6",
        nom: "Desserts",
        produits: [
          { id: "reel-c6-p1", nom: "Mango Stick", prix: null, description: "Mangue et riz coco.", photo: "/visuels/menu-mango-sticky-rice.jpg", allergenes: [] },
          { id: "reel-c6-p2", nom: "Tiramisu", prix: null, allergenes: [] },
        ],
      },
      {
        id: "reel-cat-7",
        nom: "Boissons",
        produits: [
          { id: "reel-c7-p1", nom: "Boisson 33cl", prix: null, allergenes: [] },
          { id: "reel-c7-p2", nom: "Asian Drink", prix: null, allergenes: [] },
          { id: "reel-c7-p3", nom: "Cocktail Koh Samui", prix: null, description: "Cocktail signature — visible sur l'affiche du reel Instagram DY2lhwmIIN1.", allergenes: [] },
          { id: "reel-c7-p4", nom: "Cocktail Tokyo", prix: null, description: "Cocktail signature — visible sur l'affiche du reel Instagram DY2lhwmIIN1.", allergenes: [] },
          { id: "reel-c7-p5", nom: "Piña Colada", prix: null, description: "Cocktail signature — visible sur l'affiche du reel Instagram DY2lhwmIIN1 ; citée dans les offerings de la fiche Google.", allergenes: [] },
        ],
      },
    ],
  }
}

export const COMPTE_CATEGORIES_REELLES = 7
export const COMPTE_PLATS_REELS = 39
