# OurCraft

OurCraft est un panel d'administration web destiné au déploiement et à la gestion de serveurs Minecraft conteneurisés via Docker. L'application repose sur une architecture découplée comprenant une API REST/WebSocket sous FastAPI, une base de données PostgreSQL et une interface client sous React/TypeScript.

---

## Architecture Technique (Version 1)

- **Backend (`backend/`)** : API développée avec Python 3.11 et FastAPI. Elle pilote le démon Docker hôte via le SDK officiel (`docker-py`), gère la persistance des métadonnées avec SQLAlchemy (asynchrone via `asyncpg`) et assure le streaming des journaux ainsi que l'envoi de commandes RCON au travers de connexions WebSocket.
- **Frontend (`frontend/`)** : Application SPA construite avec React 19, TypeScript, Vite et TailwindCSS. L'état global (liste des serveurs, synchronisation des statuts et paramètres du démon) est géré avec Zustand.
- **Base de données (`db`)** : Instance PostgreSQL 15 légère (`postgres:15-alpine`) stockant l'inventaire des serveurs, leurs chemins hôtes, leurs ports attribués et leurs paramètres d'exécution.
- **Conteneurs Minecraft** : Chaque serveur est isolé dans un conteneur dédié basé sur l'image `itzg/minecraft-server`, avec montage direct du répertoire de données sur le système de fichiers de l'hôte.

### Fonctionnalités opérationnelles en V1

1. **Gestion du cycle de vie des serveurs** : Création avec attribution dynamique de port, démarrage, arrêt gracieux et suppression des conteneurs Docker.
2. **Console temps réel (WebSocket)** : Lecture en continu des flux de sortie du conteneur (`stdout`/`stderr`) et exécution de commandes d'administration via `rcon-cli`.
3. **Paramétrage serveur et conteneur** : Modification du port d'écoute, de la mémoire RAM allouée (`MEMORY`), du moteur de serveur (`PAPER`, `FORGE`, `FABRIC`, `VANILLA`, `PURPUR`, `SPIGOT`) et de la version de Minecraft, accompagnée d'un éditeur pour le fichier `server.properties`.
4. **Gestion des joueurs** : Relevé en temps réel des joueurs connectés et actions de modération rapides (`op`, `deop`, `kick`, `ban`, `pardon`).
5. **Explorateur de fichiers (Web FTP)** : Navigation sécurisée dans l'arborescence du serveur et édition directe des fichiers de configuration texte (`.yml`, `.json`, `.properties`, `.txt`, `.log`).

---

## Prérequis

### Matériel recommandé
- Processeur 64-bits (`x86_64` ou `ARM64` / Raspberry Pi 4 ou 5).
- 4 Go de RAM minimum (8 Go recommandés pour héberger plusieurs instances simultanément).
- Espace disque suffisant pour les images Docker et les mondes Minecraft.

### Logiciels requis
- **Système d'exploitation** : Linux 64-bits (Debian, Ubuntu, Raspberry Pi OS 64-bits, etc.).
- **Docker Engine** (v24.0+) et **Docker Compose** (v2.20+).
- **Git** (pour le clonage et la mise à jour du dépôt).
- *(Optionnel pour le développement hors Docker)* : Python 3.11+ et Node.js 20+.

---

## Installation et Lancement

### Option 1 : Lancement complet via Docker Compose (Recommandé)

1. **Cloner le dépôt** :
   ```bash
   git clone https://github.com/Xenon99o9/OurCraft.git
   cd OurCraft
   ```

2. **Construire et démarrer les services** :
   ```bash
   docker compose up -d --build
   ```

3. **Vérifier l'état des conteneurs** :
   ```bash
   docker compose ps
   ```

4. **Accéder à l'application** :
   - Interface Web (Frontend) : `http://localhost:5173` (ou `http://<IP_MACHINE>:5173` sur le réseau local)
   - Documentation API (Swagger UI) : `http://localhost:8000/docs`

5. **Configuration initiale du répertoire des serveurs** :
   Depuis l'interface web, ouvrez la page **Paramètres** (`/settings`), sélectionnez ou renseignez le chemin absolu du dossier hôte destiné à stocker les serveurs (par exemple `/home/<utilisateur>/minecraft`), puis validez.

---

### Option 2 : Lancement manuel en local (Environnement de développement)

#### 1. Base de données PostgreSQL
Démarrez uniquement le service PostgreSQL via Docker :
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
Dans un second terminal :
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
