# AGROVIA — Gestion Stock & Ventes PVC (web app)

Application web reprenant le classeur Excel `Gestion_Stock_Agrovia` (suivi des stocks de tuyaux PVC pression et journal des ventes / facturation / bordereaux de banque).

## Lancement

Aucune installation nécessaire : ouvrez simplement `index.html` dans un navigateur.

Ou servez le dossier localement :

```bash
cd agrovia-webapp
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

## Fonctionnalités

- **État et suivi des stocks PVC en temps réel** : 4 références (Ø 90 / 75 / 63 / 50 mm), stock initial 5 000 unités. Le « Total Vendu » ne compte que les ventes dont le règlement est **Validé** ; stock restant, taux de sortie et statut (Normal / Alerte / Rupture) sont recalculés automatiquement.
- **Journal des ventes** : ajout d'une vente avec numéro de facture auto-généré (`FAC-ANNÉE-XXXX`), prix unitaire pré-rempli selon le diamètre (18 500 / 14 000 / 11 500 / 8 500 XAF), total TTC calculé, n° de bordereau banque et statut de règlement.
- **Validation / annulation** d'un règlement directement depuis le tableau (avec contrôle de stock disponible), suppression d'une ligne.
- **Indicateurs** : stock restant global, unités vendues, chiffre d'affaires encaissé, montants en attente de règlement.
- **Export CSV** du journal des ventes (compatible Excel, séparateur `;`).
- **Sauvegarde locale** dans le navigateur (`localStorage`) et bouton de réinitialisation avec les données de démonstration issues du classeur.
