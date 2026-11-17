# OurCraft — Panel d'Administration de Serveurs Minecraft

OurCraft est un panel d'administration web destiné au déploiement, à la supervision et à la gestion de serveurs Minecraft conteneurisés via Docker. L'application repose sur une architecture découplée comprenant une API REST/WebSocket sous FastAPI, une base de données PostgreSQL et une interface client sous React/TypeScript.

---

## Fonctionnalités

### 1. Tableau de bord et Gestion des Serveurs
- **Création sur mesure** : Choix du moteur (`VANILLA`, `PAPER`, `FABRIC`, `FORGE`, `NEOFORGE`, `PURPUR`, `SPIGOT`), de la version exacte de Minecraft, de la RAM allouée et du port d'écoute (avec proposition automatique du prochain port libre).
- **Importation et Conversion de serveurs existants** : Détection automatique du moteur et de la version des serveurs déjà présents sur le disque, avec possibilité de convertir un serveur (ex: Vanilla vers Paper ou Fabric/Forge) en migrant automatiquement les dimensions Nether (`DIM-1`) et The End (`DIM1`).
- **Actions rapides sur les cartes** : Démarrage/arrêt en un clic, copie rapide de l'adresse `IP:Port` et affichage en direct du nombre de joueurs connectés avec leurs avatars.

### 2. Administration d'un Serveur (8 Onglets dédiés)
- **Console Temps Réel & RCON** : Streaming des logs du conteneur via WebSocket, coloration syntaxique et barre de commande RCON avec historique au clavier (`Flèche Haut` / `Flèche Bas`).
- **Monitoring en Direct** : Jauges et courbes temps réel de la consommation CPU (%), de la mémoire RAM (Mo utilisés / alloués), du trafic réseau RX/TX et des threads JVM.
- **Gestionnaire de Mods & Plugins (Modrinth)** : Recherche directe sur l'API officielle Modrinth filtrée selon le moteur et la version du serveur, installation en un clic dans `/mods` ou `/plugins`, et activation/désactivation (`.jar` / `.jar.disabled`).
- **Joueurs & Modération** : Liste des joueurs en ligne en temps réel, actions rapides (`OP`, `De-OP`, `Kick`, `Ban`, `Pardon`) et gestion visuelle des fichiers `ops.json`, `whitelist.json` et `banned-players.json`.
- **Explorateur de Fichiers (Web FTP)** : Navigation sécurisée dans l'arborescence `/data`, glisser-déposer (Drag & Drop) pour téléverser des fichiers depuis le PC, et éditeur de code intégré (`.yml`, `.json`, `.properties`, `.txt`, `.log`) avec support du raccourci `Ctrl+S`.
- **Sauvegardes (Snapshots `.zip`) & Maps** : Compression en un clic du serveur (après `save-all`), téléchargement des archives `.zip` sur le PC, restauration en un clic, rotation automatique des archives les plus anciennes et importation directe d'une map externe (`world.zip`).
- **Planificateur de Tâches (Cron)** : Automatisation des redémarrages avec annonce en jeu, des snapshots récurrents ou de commandes RCON à heure fixe quotidienne ou par intervalle régulier.
- **Paramètres & Mise en Veille Automatique (Auto-Stop)** : Modification a posteriori du port, de la RAM, du moteur et de la version, éditeur visuel `server.properties`, réglage de la limite de rotation des snapshots et option de **mise en veille automatique** (arrêt propre du conteneur lorsqu'aucun joueur n'est connecté pendant X minutes).

### 3. Sécurité, Multi-Utilisateurs & Personnalisation
- **Comptes Multi-Utilisateurs** : Compte Administrateur central pouvant créer des sous-comptes et leur attribuer des permissions granulaires par serveur (`Voir`, `Power`, `Console & Joueurs`, `Mods & Backups`, `Web FTP`, `Paramètres`).
- **Thèmes par Compte** : 5 thèmes visuels (*Obsidian Indigo*, *Émeraude*, *Améthyste*, *Océan Nordique*, *Nether Crimson*) sauvegardés directement dans le profil PostgreSQL de chaque utilisateur.
- **Bouclier Réseau** : Analyse du trafic par adresse IP, historique des connexions entrantes et rejetées extrait des journaux, blocage d'IP global en un clic (`banned-ips.json` + `ban-ip` RCON) et mode *Lockdown d'Urgence* (Whitelist forcée).

---

## Architecture Technique

| Composant | Technologie | Port par défaut | Rôle |
| :--- | :--- | :--- | :--- |
| **Frontend** | React 19 + TypeScript + Vite + TailwindCSS + Zustand | `5173` | Interface d'administration Web |
| **Backend** | Python 3.11 + FastAPI + Docker SDK + SQLAlchemy (Async) | `8000` | API REST, WebSocket RCON/Logs, Cron & Pilotage Docker |
| **Base de données** | PostgreSQL 15 (`postgres:15-alpine`) | `5432` | Stockage des serveurs, utilisateurs, tâches et sécurité |
| **Serveurs Minecraft** | Image `itzg/minecraft-server:latest` | `25565+` | Conteneurs Minecraft isolés |

---

## Prérequis

### Matériel recommandé
- Processeur 64-bits (`x86_64` ou `ARM64` / Raspberry Pi 4 ou 5).
- 4 Go de RAM minimum (8 Go recommandés pour héberger plusieurs instances simultanément).

### Logiciels requis
- **Système d'exploitation** : Linux 64-bits (Debian, Ubuntu, Raspberry Pi OS 64-bits, etc.).
- **Docker Engine** (v24.0+) et **Docker Compose** (v2.20+).
- **Git**.

---

## Installation et Lancement

### Option 1 : Lancement via Docker Compose (Recommandé)

1. **Cloner le dépôt** :
   ```bash
   git clone https://github.com/Xenon99o9/OurCraft.git
   cd OurCraft
   ```

2. **Construire et démarrer les services** :
   ```bash
   docker compose up -d --build
   ```

3. **Accéder à l'application** :
   - En local : `http://localhost:5173`
   - Sur le réseau local : `http://<IP_MACHINE>:5173`
   - Documentation API (Swagger UI) : `http://<IP_MACHINE>:8000/docs`

4. **Première connexion** :
   - Créez votre compte **Administrateur Central** sur l'écran d'accueil.
   - Ouvrez **Paramètres** pour sélectionner le répertoire hôte destiné à stocker vos serveurs Minecraft et définir votre plage de ports dynamiques.

---

### Option 2 : Lancement manuel en local (Développement)

#### 1. Base de données PostgreSQL
```bash
docker compose up -d db
```

#### 2. Backend (FastAPI)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DATABASE_URL="postgresql://ourcraft:ourcraft_secret@localhost:5432/ourcraft_db"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

#### 3. Frontend (React / Vite)
```bash
cd frontend
npm install
npm run dev -- --host
```

---

## Commandes de maintenance

```bash
# Consulter les journaux du backend en temps réel
docker compose logs -f backend

# Arrêter les services du panel sans supprimer les données
docker compose down

# Mettre à jour le panel depuis le dépôt distant
git pull
docker compose up -d --build
```
