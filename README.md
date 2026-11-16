# 🎮 OurCraft — Panel d'Administration de Serveurs Minecraft

**OurCraft** est un panel web moderne et léger permettant de créer, héberger et administrer plusieurs serveurs Minecraft conteneurisés via Docker, pensé pour être déployé en **zéro configuration fichier** sur un **Raspberry Pi** ou n'importe quel serveur Linux.

---

## ✨ Fonctionnalités principales

- **Déploiement "Zero-Config" (Plug & Play)** :
  - Un simple `git clone` / `git pull` suivi de `docker compose up -d --build` suffit : aucune modification de `docker-compose.yml` ni de `.env` n'est obligatoire.
  - Choix et création automatique du dossier d'installation des serveurs directement dans l'interface Web (**⚙️ Paramètres**), avec détection automatique des dossiers utilisateurs de la machine (`/home/pi/minecraft`, `/srv/minecraft`, etc.).
- **💻 Onglet Console (Temps réel)** :
  - Flux de logs en direct via **WebSocket** avec coloration syntaxique automatique.
  - Envoi de commandes serveur en direct via `rcon-cli`.
- **⚙️ Onglet Paramètres (Docker & `server.properties`)** :
  - Modification a posteriori du **Port**, de la **RAM allouée** (`MEMORY`), du **Type de serveur** (`PAPER`, `PURPUR`, `VANILLA`, `FABRIC`, `FORGE`, `NEOFORGE`, `SPIGOT`) et de la **Version Minecraft** (`LATEST` ou version précise) avec recréation transparente du conteneur sans perte de données.
  - Éditeur visuel complet pour `server.properties` (MOTD, Gamemode, Difficulté, Max Players, View Distance, Seed, Online-Mode/Cracké, PVP, Whitelist, Allow-Flight, Command Blocks, Hardcore, et clés personnalisées).
- **👥 Onglet Joueurs** :
  - Liste des joueurs connectés actualisée en temps réel avec avatars Minecraft.
  - Boutons d'action rapide (**OP / De-OP**, **Kick**, **Ban**) reliés directement au WebSocket.
  - Gestion visuelle des listes `ops.json` et `banned-players.json` (avec débannissement rapide).
- **📁 Onglet Fichiers (Web FTP)** :
  - Explorateur d'arborescence sécurisé (protection anti *Path Traversal*) avec fil d'Ariane (`/data/plugins/...`).
  - Éditeur de code intégré pour lire, créer et modifier les fichiers `.yml`, `.json`, `.properties`, `.toml`, `.txt`, `.log` directement depuis le navigateur (avec raccourci `Ctrl+S`).

---

## 🏗️ Architecture Technique

| Composant | Technologie | Port par défaut | Rôle |
| :--- | :--- | :--- | :--- |
| **Frontend** | React 19 + TypeScript + Vite + TailwindCSS + Zustand | `5173` | Interface d'administration Web |
| **Backend** | Python 3.11 + FastAPI + Docker SDK + SQLAlchemy (Async) | `8000` | API REST, WebSocket RCON/Logs & Pilotage Docker |
| **Base de données** | PostgreSQL 15 (`postgres:15-alpine`) | `5432` | Stockage des serveurs, ports et configurations |
| **Serveurs Minecraft** | Image `itzg/minecraft-server:latest` | `25565 - 25575` | Conteneurs Minecraft créés à la volée |

---

## 🚀 Installation & Test sur Raspberry Pi (Sans toucher au code)

### 1. Prérequis sur le Raspberry Pi
- Un **Raspberry Pi 4 ou 5** sous **Raspberry Pi OS 64-bits**.
- **Docker** et **Docker Compose** installés :

```bash
ssh <ton_user>@<IP_DU_PI>

# Installer Docker si ce n'est pas déjà fait
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

### 2. Cloner (ou mettre à jour) et lancer OurCraft

Aucune modification de fichier n'est nécessaire : `docker-compose.yml` embarque déjà des valeurs par défaut pour PostgreSQL et monte automatiquement `/home`, `/srv`, `/mnt` et `/opt`.

```bash
# Première installation :
git clone <url_de_ton_repo> ~/OurCraft
cd ~/OurCraft

# (Ou si déjà cloné : git pull)

# Lancement des conteneurs :
docker compose up -d --build
```

---

### 3. Finir toute la configuration dans l'application Web

1. **Ouvrir l'interface Web depuis ton PC** :
   Rends-toi sur :
   ```text
   http://<IP_DU_PI>:5173
   ```
   *(Exemple : `http://192.168.1.50:5173` — l'interface détecte automatiquement l'adresse IP du Raspberry Pi).*

2. **Choisir le dossier des serveurs dans l'interface** :
   - Clique sur **⚙️ Paramètres** en haut à droite (ou sur le badge `Dossier actif` dans l'en-tête).
   - Clique sur l'une des suggestions détectées automatiquement sur ton Raspberry Pi (ex: `📁 /home/pi/minecraft`) ou tape le chemin de ton choix (`/home/...`, `/mnt/...`, `/srv/...`).
   - Clique sur **Sauvegarder (et créer le dossier)** : OurCraft crée le dossier tout seul sur le disque du Pi.
   - *(Optionnel)* Si tu avais déjà des dossiers de serveurs à cet emplacement, clique sur **🔍 Importer les serveurs existants de ce dossier**.

3. **Créer, configurer et lancer ton serveur Minecraft** :
   - Sur l'accueil, clique sur **+ Nouveau Serveur** (ex: `survie`).
   - Ouvre la carte du serveur → onglet **⚙️ Paramètres** pour choisir la **RAM** (ex: `2G` ou `4G`), le **Moteur** (`PAPER`, `FABRIC`, `FORGE`, `VANILLA`), la **Version** et les règles de `server.properties`.
   - Clique sur **▶ Démarrer** et suis le lancement en direct dans l'onglet **💻 Console**.
   - Rejoins ensuite ton serveur dans Minecraft via **Multijoueur** → `<IP_DU_PI>:25565` !

---

## 🔄 Mettre à jour sur le Raspberry Pi

Lorsque de nouvelles fonctionnalités sont poussées sur GitHub, il suffit de faire sur le Raspberry Pi :

```bash
cd ~/OurCraft
git pull
docker compose up -d --build
```
*(Ta configuration locale `config.json` et ta base de données PostgreSQL sont préservées automatiquement lors du `git pull`).*
