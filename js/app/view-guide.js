// Guide de tri : l'essentiel des règles EcoDDS, lisible en quelques secondes.

import { html, icon } from "../shared/ui.js";
import { topbar } from "./common.js";
import { memoryCount } from "./memory.js";

const FAMILIES = [
  ["Pâteux", "Peintures, enduits, mastics, colles"],
  ["Aérosols", "Peinture, insecticide, dégrippant"],
  ["Autres DDS liquides", "Solvants, traitement du bois, antigel, diluants"],
  ["Phytos et biocides", "Jardin et maison, certains produits piscine"],
  ["Acides", "Acides identifiés, toujours séparés des bases"],
  ["Bases", "Soude, ammoniaque, déboucheurs, pH+"],
  ["Comburants", "Chlore solide, brome, oxygène actif"]
];

export const guideView = {
  tab: "guide",
  render() {
    const mem = memoryCount();
    return html`${topbar({ title: "Guide de tri" })}
      <div class="guide wrap">
        <div class="danger-rule">${icon("alert")}<p>Ne jamais mélanger acides et bases. Isoler les comburants et les contenants qui fuient. Gants et lunettes pour tout produit non identifié.</p></div>

        <section class="guide-block">
          <h2>Trois questions, dans l'ordre</h2>
          <ol>
            <li>De quelle famille est le produit ? Lisez l'étiquette, pas seulement la marque.</li>
            <li>Le contenant respecte-t-il le seuil EcoDDS ? Au-delà, il passe en hors EcoDDS.</li>
            <li>Est-ce un faux ami ou un produit hors périmètre ? Dans le doute, prenez-le en photo.</li>
          </ol>
        </section>

        <section class="guide-block">
          <h2>Bacs EcoDDS</h2>
          <div class="families">${FAMILIES.map(([b, s]) => html`<div class="family"><b>${b}</b><span>${s}</span></div>`)}
            <div class="family hors"><b>Bacs dédiés</b><span>Filtres à huile de voiture, bidons de combustible vides</span></div>
          </div>
        </section>

        <section class="guide-block">
          <h2>Pas dans les bacs EcoDDS</h2>
          <p>Détergents et nettoyants ménagers, lessive, savon, eau de Javel, lave-glace, huile moteur, liquide de frein, cosmétiques, plâtre et ciment, médicaments (pharmacie), cartouches de gaz, extincteurs, bombes anti-crevaison. Un produit sans étiquette lisible va toujours en hors EcoDDS.</p>
        </section>

        <section class="guide-block">
          <h2>Cas fréquents</h2>
          <ul>
            <li><b>Piscine</b> : chlore et brome en galets en comburants, chlore liquide et pH+ en bases, pH− en acides, algicide en phytos. Détartrant de ligne d'eau et testeur de pH : hors EcoDDS.</li>
            <li><b>Voiture</b> : seuls peinture carrosserie, dégivrant, anti-goudron, liquide de refroidissement, antigel et polish vont en EcoDDS ; les filtres à huile de voiture ont leur bac dédié. Tout le reste (huile moteur, liquide de frein…) : hors EcoDDS.</li>
            <li><b>Peintre</b> : pinceaux, rouleaux, bacs et spatules dans le bac outillage. Chiffons souillés et seaux divers : refusés.</li>
            <li><b>Jardin</b> : mention « Emploi autorisé dans les jardins » : EcoDDS. Logo ADIVALOR ou « utilisable en agriculture biologique » : hors EcoDDS.</li>
          </ul>
        </section>

        <section class="guide-block">
          <h2>Refusés en déchèterie</h2>
          <p>Acide picrique (explosif), arsénite de soude. Acide fluorhydrique : à isoler et signaler.</p>
        </section>

        ${mem ? html`<section class="guide-block"><h2>Mémoire de l'équipe</h2><p>${mem} marque${mem > 1 ? "s" : ""} déjà reconnue${mem > 1 ? "s" : ""} par les agents de ce site, réutilisée${mem > 1 ? "s" : ""} automatiquement lors des photos.</p></section>` : ""}
      </div>`.toString();
  }
};
