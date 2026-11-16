# 🎮 OurCraft — Panel d'Administration de Serveurs Minecraft

**OurCraft** est un panel web moderne, léger et open-source permettant de créer, héberger et administrer plusieurs serveurs Minecraft conteneurisés via Docker. Il est conçu pour fonctionner sur n'importe quelle machine Linux (PC, serveur dédié, VPS, NAS ou Raspberry Pi) avec un déploiement **Zero-Config**.

---

## ✨ Fonctionnalités principales

- **Déploiement "Zero-Config" (Plug & Play)** :
  - Un simple `git clone` suivi de `docker compose up -d --build` suffit : aucune modification de `docker-compose.yml` ni de fichier `.env` n'est requise.
  - Choix et création automatique du dossier d'installation des serveurs directement dans l'interface Web (**⚙️ Paramètres**), avec détection automatique des répertoires disponibles sur la machine (`/home/<user>/minecraft`, `/srv/minecraft`, `/opt/minecraft`, etc.).
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

## 🚀 Installation & Démarrage rapide

### 1. Prérequis
- Une machine sous Linux (x86_64 ou ARM64 : PC, VPS, serveur domestique, Raspberry Pi...).
- **Docker** et **Docker Compose** installés :

```bash
# Installer Docker si ce n'est pas déjà fait
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

---

### 2. Cloner et lancer OurCraft

Aucune modification de fichier n'est nécessaire : `docker-compose.yml` embarque déjà des valeurs par défaut pour PostgreSQL et monte automatiquement les répertoires standards (`/home`, `/srv`, `/mnt` et `/opt`).

```bash
git clone https://github.com/Xenon99o9/OurCraft.git
cd OurCraft
docker compose up -d --build
```

Vérifiez que les 3 conteneurs (`panel_db`, `panel_backend`, `panel_frontend`) sont actifs :
```bash
docker compose ps
```

---

### 3. Configuration et utilisation dans l'interface Web

1. **Ouvrir le Panel Web** :
   - En local sur la machine : `http://localhost:5173`
   - Depuis un autre appareil du réseau : `http://<IP_DE_LA_MACHINE>:5173`
   *(L'interface détecte automatiquement l'hôte ou l'adresse IP utilisée).*

2. **Choisir le dossier des serveurs** :
   - Cliquez sur **⚙️ Paramètres** en haut à droite (ou sur le badge `Dossier actif` dans l'en-tête).
   - Sélectionnez en un clic l'un des chemins détectés sur votre machine (ex: `📁 /home/<votre_user>/minecraft` ou `📁 /srv/minecraft`) ou saisissez le chemin absolu de votre choix.
   - Cliquez sur **Sauvegarder (et créer le dossier)** : OurCraft crée automatiquement le répertoire sur le disque.
   - *(Optionnel)* Cliquez sur **🔍 Importer les serveurs existants de ce dossier** si vous avez déjà des serveurs Minecraft présents dans ce répertoire.

3. **Créer, configurer et lancer un serveur Minecraft** :
   - Sur l'accueil, cliquez sur **+ Nouveau Serveur** (ex: `survie`).
   - Ouvrez la carte du serveur → onglet **⚙️ Paramètres** pour ajuster la **RAM** (`2G`, `4G`, `8G`...), le **Moteur** (`PAPER`, `FABRIC`, `FORGE`, `VANILLA`, `PURPUR`...), la **Version** et les règles de `server.properties`.
   - Cliquez sur **▶ Démarrer** et suivez le démarrage en direct dans l'onglet **💻 Console**.
   - Rejoignez ensuite votre serveur dans Minecraft via **Multijoueur** → `<IP_DE_LA_MACHINE>:25565` !

---

## 🔄 Mise à jour

Pour récupérer les dernières nouveautés du dépôt sans perdre vos serveurs ni votre configuration locale :

```bash
cd OurCraft
git pull
docker compose up -d --build
```

---

## 🛠️ Commandes utiles

```bash
# Voir les logs du backend en direct
docker compose logs -f backend

# Arrêter le panel OurCraft (sans supprimer les serveurs ni la base de données)
docker compose down

# Lister tous les conteneurs (panel + serveurs Minecraft)
docker ps -a
```
