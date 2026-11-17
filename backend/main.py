import os
import re
import json
import docker
import asyncio
import threading
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Imports Base de données
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from database.database import AsyncSessionLocal, engine, Base
from database.models import MinecraftServer, Node


_db_initialized = False


async def ensure_db_schema():
    """S'assure que les tables et colonnes existent en BDD (avec retry si PostgreSQL démarre)"""
    global _db_initialized
    if _db_initialized:
        return
    last_err = None
    for _ in range(15):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
                await conn.execute(text(
                    "ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS ram VARCHAR(20) DEFAULT '2G' NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS server_type VARCHAR(50) DEFAULT 'PAPER' NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS version VARCHAR(50) DEFAULT 'LATEST' NOT NULL;"
                ))
            _db_initialized = True
            return
        except Exception as e:
            last_err = e
            await asyncio.sleep(1.5)
    print(f"[Startup] Attention: impossible d'initialiser la BDD après plusieurs essais: {last_err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_db_schema()
    yield


app = FastAPI(title="OurCraft API", lifespan=lifespan)

# --- MIDDLEWARE CORS (Pour autoriser le Front-end React) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DÉPENDANCE : Obtenir une connexion à la BDD pour chaque requête ---
async def get_db():
    if not _db_initialized:
        await ensure_db_schema()
    async with AsyncSessionLocal() as session:
        yield session

# --- MODÈLES DE DONNÉES (Pour recevoir les JSON du Front-end) ---
class ScanRequest(BaseModel):
    base_path: str
    selected_folders: Optional[list[str]] = None

class ServerLaunchConfig(BaseModel):
    name: str
    host_path: str  
    port: int = 25565
    ram: Optional[str] = "2G"
    server_type: Optional[str] = "PAPER"
    version: Optional[str] = "LATEST"

class ServerSettingsUpdate(BaseModel):
    port: int
    ram: str
    server_type: str
    version: str

class ServerPropertiesUpdate(BaseModel):
    properties: Dict[str, str]

class FileSaveRequest(BaseModel):
    path: str
    content: str

class AppSettings(BaseModel):
    base_path: str
    port_min: int
    port_max: int

class ServerCreateConfig(BaseModel):
    name: str
    server_type: str = "PAPER"
    version: str = "LATEST"
    ram: str = "2G"


# --- UTILITAIRES ---

EDITABLE_EXTENSIONS = {
    ".yml", ".yaml", ".json", ".properties", ".txt", ".log",
    ".toml", ".conf", ".cfg", ".ini", ".sh", ".md", ".csv", ".mcmeta"
}

DEFAULT_SERVER_PROPERTIES = {
    "motd": "Un serveur Minecraft propulse par OurCraft",
    "gamemode": "survival",
    "difficulty": "normal",
    "max-players": "20",
    "online-mode": "true",
    "pvp": "true",
    "white-list": "false",
    "allow-flight": "false",
    "spawn-protection": "16",
    "view-distance": "10",
    "simulation-distance": "10",
    "enable-command-block": "false",
    "hardcore": "false",
    "level-seed": "",
    "server-port": "25565",
}


async def get_server_or_404(server_name: str, db: AsyncSession) -> MinecraftServer:
    result = await db.execute(select(MinecraftServer).filter_by(name=server_name))
    server = result.scalars().first()
    if not server:
        raise HTTPException(status_code=404, detail=f"Serveur '{server_name}' introuvable.")
    return server


def resolve_safe_path(server_root: str, relative_path: str = "") -> str:
    """Résout un chemin relatif à l'intérieur du dossier du serveur et bloque tout Path Traversal (../)"""
    real_root = os.path.realpath(server_root)
    cleaned_rel = relative_path.lstrip("/\\")
    target_path = os.path.realpath(os.path.join(real_root, cleaned_rel))
    if os.path.commonpath([real_root, target_path]) != real_root:
        raise HTTPException(status_code=403, detail="Accès refusé : chemin en dehors du dossier du serveur.")
    return target_path


def update_properties_file(props_path: str, updates: Dict[str, str]):
    """Met à jour les clés dans server.properties tout en préservant les commentaires et l'ordre"""
    lines = []
    if os.path.exists(props_path):
        with open(props_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

    updated_keys = set()
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, _ = stripped.split("=", 1)
            key = key.strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}\n")
                updated_keys.add(key)
            else:
                new_lines.append(line if line.endswith("\n") else line + "\n")
        else:
            new_lines.append(line if line.endswith("\n") else line + "\n")

    for key, val in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={val}\n")

    os.makedirs(os.path.dirname(props_path), exist_ok=True)
    with open(props_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)


def create_server_container(client, server: MinecraftServer):
    """Crée et démarre un conteneur Docker itzg/minecraft-server avec la configuration du serveur"""
    container_name = f"ourcraft_{server.name}"
    ram = getattr(server, "ram", None) or "2G"
    server_type = getattr(server, "server_type", None) or "PAPER"
    version = getattr(server, "version", None) or "LATEST"
    port = server.server_port

    return client.containers.run(
        image="itzg/minecraft-server:latest",
        name=container_name,
        environment={
            "EULA": "TRUE",
            "TYPE": server_type.upper(),
            "VERSION": version,
            "MEMORY": ram.upper(),
            "SERVER_PORT": str(port),
        },
        ports={
            f"{port}/tcp": port,
            f"{port}/udp": port,
        },
        volumes={
            server.path: {'bind': '/data', 'mode': 'rw'}
        },
        dns=["1.1.1.1", "8.8.8.8"],
        detach=True
    )


# --- ROUTES ---

@app.get("/")
async def root():
    return {"message": "Bienvenue sur l'API de OurCraft !"}

@app.get("/api/containers")
async def list_local_containers():
    """Liste brute de tous les conteneurs Docker de la machine"""
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        return [{"id": c.short_id, "name": c.name, "status": c.status} for c in containers]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/servers")
async def get_minecraft_servers(db: AsyncSession = Depends(get_db)):
    """Croise les serveurs en BDD avec leur état réel dans Docker"""
    result = await db.execute(select(MinecraftServer))
    db_servers = result.scalars().all()
    
    client = docker.from_env()
    containers = {c.name: c for c in client.containers.list(all=True)}
    
    server_list = []
    for s in db_servers:
        container_name = f"ourcraft_{s.name}"
        c = containers.get(container_name)
        
        server_list.append({
            "id": str(s.id),
            "name": s.name,
            "status": c.status if c else "offline",
            "image": "itzg/minecraft-server",
            "path": s.path,
            "port": s.server_port,
            "ram": getattr(s, "ram", "2G") or "2G",
            "server_type": getattr(s, "server_type", "PAPER") or "PAPER",
            "version": getattr(s, "version", "LATEST") or "LATEST",
        })
        
    return server_list

@app.get("/api/servers/import/candidates")
async def get_import_candidates(
    base_path: Optional[str] = Query(None, description="Dossier à analyser (par défaut le dossier configuré)"),
    db: AsyncSession = Depends(get_db)
):
    """Liste les sous-dossiers non encore importés pour la modale d'importation dédiée"""
    app_config = get_config()
    target_base = (base_path or app_config["base_path"]).strip()

    if not os.path.exists(target_base) or not os.path.isdir(target_base):
        return {"base_path": target_base, "exists": False, "candidates": []}

    res = await db.execute(select(MinecraftServer))
    existing_servers = res.scalars().all()
    existing_paths = {os.path.realpath(s.path) for s in existing_servers}
    existing_names = {s.name.lower() for s in existing_servers}

    candidates = []
    try:
        for folder_name in sorted(os.listdir(target_base)):
            if folder_name.startswith("."):
                continue
            folder_path = os.path.join(target_base, folder_name)
            if not os.path.isdir(folder_path):
                continue

            already_imported = (
                os.path.realpath(folder_path) in existing_paths
                or folder_name.lower() in existing_names
            )

            props_file = os.path.join(folder_path, "server.properties")
            has_properties = os.path.exists(props_file)
            has_world = os.path.exists(os.path.join(folder_path, "world"))
            detected_port = None
            if has_properties:
                try:
                    with open(props_file, "r", encoding="utf-8", errors="replace") as f:
                        for line in f:
                            if line.strip().startswith("server-port="):
                                detected_port = int(line.strip().split("=", 1)[1].strip())
                                break
                except Exception:
                    pass

            candidates.append({
                "name": folder_name,
                "path": folder_path,
                "already_imported": already_imported,
                "is_minecraft_dir": has_properties or has_world,
                "detected_port": detected_port,
            })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Impossible de lire le dossier : {str(e)}")

    return {
        "base_path": target_base,
        "exists": True,
        "candidates": candidates,
    }


@app.post("/api/servers/scan")
async def scan_directories(request: ScanRequest, db: AsyncSession = Depends(get_db)):
    """Importe les serveurs d'un dossier (tous ou uniquement ceux sélectionnés dans la modale d'importation)"""
    base_path = request.base_path.strip()
    
    if not os.path.exists(base_path) or not os.path.isdir(base_path):
        raise HTTPException(status_code=400, detail=f"Dossier introuvable : {base_path}")

    try:
        result = await db.execute(select(Node).filter_by(id=1))
        node = result.scalars().first()
        if not node:
            node = Node(id=1, name="Machine Locale", ip_address="127.0.0.1", ssh_username="local")
            db.add(node)
            await db.commit()

        app_config = get_config()
        port_min = int(app_config.get("port_min", 25565))
        port_max = int(app_config.get("port_max", 25575))

        res_ports = await db.execute(select(MinecraftServer.server_port))
        used_ports = {p for p in res_ports.scalars().all()}

        allowed_set = set(request.selected_folders) if request.selected_folders is not None else None

        found_servers = []
        for folder_name in sorted(os.listdir(base_path)):
            if folder_name.startswith("."):
                continue
            if allowed_set is not None and folder_name not in allowed_set:
                continue

            folder_path = os.path.join(base_path, folder_name)
            
            if os.path.isdir(folder_path):
                res = await db.execute(
                    select(MinecraftServer).filter(
                        (MinecraftServer.path == folder_path) | (MinecraftServer.name == folder_name)
                    )
                )
                existing_server = res.scalars().first()
                
                if not existing_server:
                    # 1. Tenter de lire le port existant dans server.properties s'il existe
                    assigned_port = None
                    props_file = os.path.join(folder_path, "server.properties")
                    if os.path.exists(props_file):
                        try:
                            with open(props_file, "r", encoding="utf-8", errors="replace") as f:
                                for line in f:
                                    if line.strip().startswith("server-port="):
                                        p_val = int(line.strip().split("=", 1)[1].strip())
                                        if p_val not in used_ports:
                                            assigned_port = p_val
                                        break
                        except Exception:
                            pass

                    # 2. Sinon attribuer le premier port libre de la plage configurée
                    if assigned_port is None:
                        for p in range(port_min, port_max + 1):
                            if p not in used_ports:
                                assigned_port = p
                                break
                    if assigned_port is None:
                        assigned_port = 25565

                    used_ports.add(assigned_port)

                    new_server = MinecraftServer(
                        node_id=1,
                        name=folder_name,
                        path=folder_path,
                        server_port=assigned_port,
                        ram="2G",
                        server_type="PAPER",
                        version="LATEST"
                    )
                    db.add(new_server)
                    found_servers.append(folder_name)

        await db.commit()
        return {
            "message": "Importation terminée.",
            "nouveaux_serveurs_ajoutes": len(found_servers),
            "liste": found_servers
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'importation : {str(e)}")

@app.post("/api/servers/launch")
async def launch_minecraft_server(config: ServerLaunchConfig, db: AsyncSession = Depends(get_db)):
    """Crée le conteneur s'il n'existe pas, ou le redémarre s'il est arrêté"""
    try:
        client = docker.from_env()
        container_name = f"ourcraft_{config.name}"
        
        # On récupère la config à jour en BDD si disponible
        res = await db.execute(select(MinecraftServer).filter_by(name=config.name))
        db_server = res.scalars().first()

        try:
            container = client.containers.get(container_name)
            container.start()
            return {"status": "success", "message": f"Serveur '{config.name}' redémarré avec succès !"}
            
        except docker.errors.NotFound:
            if db_server:
                create_server_container(client, db_server)
            else:
                client.containers.run(
                    image="itzg/minecraft-server:latest",
                    name=container_name,
                    environment={
                        "EULA": "TRUE",
                        "TYPE": (config.server_type or "PAPER").upper(),
                        "VERSION": config.version or "LATEST",
                        "MEMORY": (config.ram or "2G").upper(),
                        "SERVER_PORT": str(config.port),
                    },
                    ports={
                        f"{config.port}/tcp": config.port,
                        f"{config.port}/udp": config.port,
                    },
                    volumes={
                        config.host_path: {'bind': '/data', 'mode': 'rw'}
                    },
                    dns=["1.1.1.1", "8.8.8.8"],
                    detach=True 
                )
            return {"status": "success", "message": f"Nouveau serveur '{config.name}' créé et lancé !"}
            
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=f"Erreur Docker: {str(e)}")

@app.post("/api/servers/{server_name}/stop")
async def stop_minecraft_server(server_name: str):
    """Arrête proprement le conteneur d'un serveur"""
    try:
        client = docker.from_env()
        container_name = f"ourcraft_{server_name}"
        container = client.containers.get(container_name)
        
        container.stop(timeout=10)
        return {"status": "success", "message": f"Serveur '{server_name}' arrêté."}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Le conteneur n'est pas en cours d'exécution.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- ONGLET PARAMÈTRES : DOCKER & SERVER.PROPERTIES ---

@app.put("/api/servers/{server_name}/settings")
async def update_server_settings(
    server_name: str,
    settings: ServerSettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Modifie port, RAM, type et version du serveur, met à jour la BDD et recrée le conteneur si nécessaire"""
    server = await get_server_or_404(server_name, db)

    # Vérifier si le nouveau port est déjà pris par un autre serveur
    if settings.port != server.server_port:
        res = await db.execute(
            select(MinecraftServer).filter(
                MinecraftServer.server_port == settings.port,
                MinecraftServer.name != server_name
            )
        )
        if res.scalars().first():
            raise HTTPException(status_code=400, detail=f"Le port {settings.port} est déjà utilisé par un autre serveur.")

    server.server_port = settings.port
    server.ram = settings.ram.strip().upper()
    server.server_type = settings.server_type.strip().upper()
    server.version = settings.version.strip()

    await db.commit()
    await db.refresh(server)

    # Synchroniser server-port dans server.properties si le fichier existe
    props_path = os.path.join(server.path, "server.properties")
    if os.path.exists(props_path):
        try:
            update_properties_file(props_path, {"server-port": str(settings.port)})
        except Exception:
            pass

    # Si un conteneur existe déjà, on le recrée pour que Docker prenne en compte le nouveau port et les nouvelles variables d'env
    client = docker.from_env()
    container_name = f"ourcraft_{server_name}"
    was_running = False
    try:
        old_container = client.containers.get(container_name)
        was_running = old_container.status == "running"
        if was_running:
            old_container.stop(timeout=10)
        old_container.remove()
    except docker.errors.NotFound:
        pass
    except docker.errors.APIError as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la mise à jour du conteneur Docker : {str(e)}")

    if was_running:
        try:
            create_server_container(client, server)
        except docker.errors.APIError as e:
            raise HTTPException(status_code=500, detail=f"Paramètres sauvegardés, mais erreur au redémarrage Docker : {str(e)}")

    return {
        "status": "success",
        "message": (
            "Paramètres appliqués et conteneur redémarré avec la nouvelle configuration !"
            if was_running
            else "Paramètres sauvegardés ! Ils seront appliqués au prochain démarrage du serveur."
        ),
        "restarted": was_running,
    }


@app.get("/api/servers/{server_name}/properties")
async def get_server_properties(server_name: str, db: AsyncSession = Depends(get_db)):
    """Lit et parse le fichier server.properties du serveur"""
    server = await get_server_or_404(server_name, db)
    props_path = resolve_safe_path(server.path, "server.properties")

    properties = dict(DEFAULT_SERVER_PROPERTIES)
    properties["server-port"] = str(server.server_port)
    exists = os.path.exists(props_path)

    if exists:
        try:
            with open(props_path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith("#") and "=" in stripped:
                        k, v = stripped.split("=", 1)
                        properties[k.strip()] = v.strip()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Impossible de lire server.properties : {str(e)}")

    return {
        "exists": exists,
        "properties": properties
    }


@app.put("/api/servers/{server_name}/properties")
async def save_server_properties(
    server_name: str,
    payload: ServerPropertiesUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Sauvegarde les modifications dans server.properties"""
    server = await get_server_or_404(server_name, db)
    props_path = resolve_safe_path(server.path, "server.properties")

    try:
        update_properties_file(props_path, payload.properties)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'écriture dans server.properties : {str(e)}")

    return {
        "status": "success",
        "message": "Fichier server.properties sauvegardé ! Redémarrez le serveur pour appliquer les changements en jeu."
    }


# --- ONGLET JOUEURS : LISTE EN TEMPS RÉEL & INFOS OP / BAN ---

ANSI_ESCAPE_RE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])|§[0-9a-fk-orA-FK-OR]')

@app.get("/api/servers/{server_name}/players")
async def get_server_players(server_name: str, db: AsyncSession = Depends(get_db)):
    """Récupère la liste des joueurs connectés en direct via rcon-cli list + la liste des OPs et Bannis"""
    server = await get_server_or_404(server_name, db)

    # Lecture des fichiers ops.json et banned-players.json sur le disque
    ops_list = []
    banned_list = []

    ops_path = os.path.join(server.path, "ops.json")
    if os.path.exists(ops_path):
        try:
            with open(ops_path, "r", encoding="utf-8") as f:
                ops_data = json.load(f)
                ops_list = [entry.get("name") for entry in ops_data if isinstance(entry, dict) and entry.get("name")]
        except Exception:
            pass

    banned_path = os.path.join(server.path, "banned-players.json")
    if os.path.exists(banned_path):
        try:
            with open(banned_path, "r", encoding="utf-8") as f:
                banned_data = json.load(f)
                banned_list = [entry.get("name") for entry in banned_data if isinstance(entry, dict) and entry.get("name")]
        except Exception:
            pass

    client = docker.from_env()
    try:
        container = client.containers.get(f"ourcraft_{server_name}")
        if container.status != "running":
            return {
                "online": False,
                "count": 0,
                "max": 20,
                "players": [],
                "ops": ops_list,
                "banned": banned_list,
            }

        exec_res = container.exec_run("rcon-cli list")
        raw_output = exec_res.output.decode("utf-8", errors="replace").strip()
        clean_output = ANSI_ESCAPE_RE.sub("", raw_output).strip()

        # Format standard : "There are X of a max of Y players online: Player1, Player2"
        # ou en 1.12 / custom : "There are X/Y players online:"
        count = 0
        max_players = 20
        players = []

        match = re.search(r"There are (\d+)\s+(?:of a max of|/)\s*(\d+)\s+players online:?(.*)", clean_output, re.IGNORECASE | re.DOTALL)
        if match:
            count = int(match.group(1))
            max_players = int(match.group(2))
            names_part = match.group(3).strip()
            if names_part:
                players = [p.strip() for p in names_part.split(",") if p.strip()]
        else:
            # Fallback si un plugin reformate la sortie de /list avec ":"
            if ":" in clean_output and count > 0:
                names_part = clean_output.split(":", 1)[1].strip()
                players = [p.strip() for p in names_part.split(",") if p.strip()]

        return {
            "online": True,
            "count": len(players) if players else count,
            "max": max_players,
            "players": players,
            "ops": ops_list,
            "banned": banned_list,
            "raw": clean_output,
        }

    except docker.errors.NotFound:
        return {
            "online": False,
            "count": 0,
            "max": 20,
            "players": [],
            "ops": ops_list,
            "banned": banned_list,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la récupération des joueurs : {str(e)}")


# --- ONGLET FICHIERS (WEB FTP) ---

@app.get("/api/servers/{server_name}/files")
async def list_server_files(
    server_name: str,
    path: str = Query("", description="Chemin relatif dans le dossier du serveur"),
    db: AsyncSession = Depends(get_db)
):
    """Liste les fichiers et dossiers d'un répertoire du serveur"""
    server = await get_server_or_404(server_name, db)
    target_dir = resolve_safe_path(server.path, path)

    if not os.path.exists(target_dir):
        raise HTTPException(status_code=404, detail="Dossier introuvable.")
    if not os.path.isdir(target_dir):
        raise HTTPException(status_code=400, detail="Le chemin spécifié n'est pas un dossier.")

    items = []
    try:
        for entry in os.scandir(target_dir):
            is_dir = entry.is_dir(follow_symlinks=False)
            ext = os.path.splitext(entry.name)[1].lower() if not is_dir else ""
            size = 0
            mtime = 0
            try:
                stat = entry.stat(follow_symlinks=False)
                size = stat.st_size if not is_dir else 0
                mtime = int(stat.st_mtime)
            except Exception:
                pass

            rel_entry_path = os.path.relpath(entry.path, os.path.realpath(server.path))
            if rel_entry_path == ".":
                rel_entry_path = entry.name

            items.append({
                "name": entry.name,
                "path": rel_entry_path.replace("\\", "/"),
                "is_dir": is_dir,
                "size": size,
                "modified": mtime,
                "editable": (not is_dir) and (ext in EDITABLE_EXTENSIONS or entry.name in {"eula.txt", "server.properties"}),
            })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de lecture du dossier : {str(e)}")

    # Tri : dossiers en premier, puis ordre alphabétique insensible à la casse
    items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

    real_root = os.path.realpath(server.path)
    current_rel = os.path.relpath(target_dir, real_root)
    if current_rel == ".":
        current_rel = ""

    return {
        "current_path": current_rel.replace("\\", "/"),
        "items": items,
    }


@app.get("/api/servers/{server_name}/files/content")
async def read_server_file(
    server_name: str,
    path: str = Query(..., description="Chemin relatif du fichier à lire"),
    db: AsyncSession = Depends(get_db)
):
    """Lit le contenu texte d'un fichier de configuration du serveur"""
    server = await get_server_or_404(server_name, db)
    target_file = resolve_safe_path(server.path, path)

    if not os.path.exists(target_file) or not os.path.isfile(target_file):
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    file_size = os.path.getsize(target_file)
    if file_size > 2 * 1024 * 1024:  # Limite à 2 Mo pour éviter de bloquer l'interface
        raise HTTPException(status_code=400, detail="Ce fichier est trop volumineux (> 2 Mo) pour être édité dans le navigateur.")

    try:
        with open(target_file, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {
            "path": path,
            "name": os.path.basename(target_file),
            "size": file_size,
            "content": content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Impossible de lire le fichier : {str(e)}")


@app.put("/api/servers/{server_name}/files/content")
async def write_server_file(
    server_name: str,
    request: FileSaveRequest,
    db: AsyncSession = Depends(get_db)
):
    """Sauvegarde le contenu modifié d'un fichier sur le disque"""
    server = await get_server_or_404(server_name, db)
    target_file = resolve_safe_path(server.path, request.path)

    if os.path.isdir(target_file):
        raise HTTPException(status_code=400, detail="Impossible d'écraser un dossier.")

    try:
        os.makedirs(os.path.dirname(target_file), exist_ok=True)
        with open(target_file, "w", encoding="utf-8") as f:
            f.write(request.content)
        return {
            "status": "success",
            "message": f"Fichier '{os.path.basename(target_file)}' sauvegardé avec succès !",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la sauvegarde : {str(e)}")


# --- WEBSOCKET CONSOLE & COMMANDES RCON ---

@app.websocket("/api/servers/{server_name}/ws")
async def websocket_logs(websocket: WebSocket, server_name: str):
    await websocket.accept()
    client = docker.from_env()
    
    try:
        container = client.containers.get(f"ourcraft_{server_name}")
        loop = asyncio.get_running_loop()

        def log_streamer():
            try:
                for line in container.logs(stream=True, follow=True, tail=50):
                    text = line.decode('utf-8', errors='replace').strip()
                    if text:
                        asyncio.run_coroutine_threadsafe(websocket.send_text(text), loop)
            except Exception:
                pass 

        thread = threading.Thread(target=log_streamer, daemon=True)
        thread.start()

        while True:
            command = await websocket.receive_text()
            clean_cmd = command.strip()
            if clean_cmd.startswith("/"):
                clean_cmd = clean_cmd[1:]
            if clean_cmd:
                container.exec_run(f"rcon-cli {clean_cmd}", detach=True)
            
    except WebSocketDisconnect:
        pass
    except docker.errors.NotFound:
        await websocket.send_text("[Système] Le serveur est éteint. Allumez-le pour voir la console.")
        await websocket.close()
    except Exception:
        await websocket.close()

@app.delete("/api/servers/{server_name}")
async def delete_minecraft_server(server_name: str, db: AsyncSession = Depends(get_db)):
    """Supprime un serveur de la BDD et détruit son conteneur Docker"""
    result = await db.execute(select(MinecraftServer).filter_by(name=server_name))
    server = result.scalars().first()
    
    if not server:
        raise HTTPException(status_code=404, detail="Serveur introuvable en base de données.")

    client = docker.from_env()
    try:
        container = client.containers.get(f"ourcraft_{server_name}")
        container.stop(timeout=5)
        container.remove()
    except docker.errors.NotFound:
        pass

    await db.delete(server)
    await db.commit()
    
    return {"status": "success", "message": f"Serveur '{server_name}' supprimé avec succès."}

CONFIG_FILE = "config.json"


def detect_suggested_paths() -> list[str]:
    """Détecte automatiquement les dossiers utilisateurs disponibles sur la machine hôte (PC, Raspberry Pi, etc.)"""
    suggestions = []
    if os.path.exists("/home") and os.path.isdir("/home"):
        try:
            for name in sorted(os.listdir("/home")):
                user_dir = os.path.join("/home", name)
                if os.path.isdir(user_dir) and not name.startswith("."):
                    suggestions.append(os.path.join(user_dir, "minecraft"))
                    suggestions.append(user_dir)
        except Exception:
            pass
    suggestions.append("/srv/minecraft")
    suggestions.append("/opt/minecraft")
    return suggestions


def get_default_base_path() -> str:
    """Choisit automatiquement le meilleur dossier par défaut sur la machine actuelle"""
    suggestions = detect_suggested_paths()
    return suggestions[0] if suggestions else "/srv/minecraft"


def get_config():
    default_path = get_default_base_path()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                data = json.load(f)
            base_path = data.get("base_path") or default_path
            return {
                "base_path": base_path,
                "port_min": data.get("port_min", 25565),
                "port_max": data.get("port_max", 25575),
                "path_exists": os.path.exists(base_path),
                "suggested_paths": detect_suggested_paths(),
            }
        except Exception:
            pass
    return {
        "base_path": default_path,
        "port_min": 25565,
        "port_max": 25575,
        "path_exists": os.path.exists(default_path),
        "suggested_paths": detect_suggested_paths(),
    }


@app.get("/api/settings")
async def read_settings():
    """Récupère les paramètres globaux du panel ainsi que les chemins détectés sur la machine"""
    return get_config()

@app.post("/api/servers/create")
async def create_minecraft_server(config_data: ServerCreateConfig, db: AsyncSession = Depends(get_db)):
    """Crée un nouveau serveur de zéro (Dossier + Port dynamique + BDD)"""
    server_name = config_data.name
    
    # 0. Sécurité : Créer le Node local s'il n'existe pas encore (ex: nouvelle installation sur Raspberry Pi)
    node_res = await db.execute(select(Node).filter_by(id=1))
    if not node_res.scalars().first():
        db.add(Node(id=1, name="Machine Locale", ip_address="127.0.0.1", ssh_username="local"))
        await db.commit()

    res = await db.execute(select(MinecraftServer).filter_by(name=server_name))
    if res.scalars().first():
        raise HTTPException(status_code=400, detail="Un serveur avec ce nom existe déjà.")

    app_config = get_config()
    base_path = app_config["base_path"]
    
    res = await db.execute(select(MinecraftServer.server_port))
    used_ports = {p for p in res.scalars().all()}
    
    available_port = None
    for port in range(app_config["port_min"], app_config["port_max"] + 1):
        if port not in used_ports:
            available_port = port
            break
            
    if not available_port:
        raise HTTPException(status_code=400, detail="Plus aucun port disponible dans la plage configurée.")

    server_path = os.path.join(base_path, server_name)
    try:
        os.makedirs(server_path, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de création du dossier : {str(e)}")

    new_server = MinecraftServer(
        node_id=1,
        name=server_name,
        path=server_path,
        server_port=available_port,
        ram=(config_data.ram or "2G").strip().upper(),
        server_type=(config_data.server_type or "PAPER").strip().upper(),
        version=(config_data.version or "LATEST").strip()
    )
    db.add(new_server)
    await db.commit()
    
    return {
        "status": "success",
        "message": f"Serveur '{server_name}' ({new_server.server_type} {new_server.version}) créé sur le port {available_port} !"
    }

@app.post("/api/settings")
async def save_settings(config: AppSettings):
    """Sauvegarde les paramètres globaux du panel et crée automatiquement le dossier sur le disque"""
    cleaned_path = config.base_path.strip()
    if not cleaned_path.startswith("/"):
        raise HTTPException(status_code=400, detail="Le chemin du dossier doit être un chemin absolu (commençant par /).")

    try:
        os.makedirs(cleaned_path, exist_ok=True)
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Impossible de créer ou d'accéder au dossier '{cleaned_path}' : {str(e)}"
        )

    saved_data = {
        "base_path": cleaned_path,
        "port_min": config.port_min,
        "port_max": config.port_max,
    }
    with open(CONFIG_FILE, "w") as f:
        json.dump(saved_data, f, indent=4)
    return {
        "status": "success",
        "message": f"Paramètres sauvegardés et dossier '{cleaned_path}' prêt !",
        "settings": get_config(),
    }
