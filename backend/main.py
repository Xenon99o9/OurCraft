import os
import re
import json
import time
import hmac
import base64
import hashlib
import secrets
import shutil
import zipfile
import urllib.request
import urllib.parse
import docker
import asyncio
import threading
from datetime import datetime
from typing import Dict, Any, Optional
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Query, Header, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Imports Base de données
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from database.database import AsyncSessionLocal, engine, Base
from database.models import MinecraftServer, Node, ScheduledTask, User, BlockedIP


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
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30) DEFAULT 'admin' NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions_json TEXT DEFAULT '{}' NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(30) DEFAULT 'discord' NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS auto_stop_enabled BOOLEAN DEFAULT FALSE NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS auto_stop_minutes INTEGER DEFAULT 30 NOT NULL;"
                ))
                await conn.execute(text(
                    "ALTER TABLE minecraft_servers ADD COLUMN IF NOT EXISTS max_backups INTEGER DEFAULT 5 NOT NULL;"
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
    scheduler_task = asyncio.create_task(scheduler_background_loop())
    yield
    scheduler_task.cancel()


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
    engine_overrides: Optional[Dict[str, str]] = None

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
    backup_before_convert: Optional[bool] = True
    auto_stop_enabled: Optional[bool] = False
    auto_stop_minutes: Optional[int] = 30
    max_backups: Optional[int] = 5

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
    server_type: str = "VANILLA"
    version: str = "LATEST"
    ram: str = "2G"
    port: Optional[int] = None

class AddonInstallRequest(BaseModel):
    project_id: str
    title: Optional[str] = None

class BackupCreateRequest(BaseModel):
    label: Optional[str] = "snapshot"

class ScheduleCreateRequest(BaseModel):
    name: str
    action_type: str       # "restart", "backup", "command", "stop", "start"
    schedule_type: str     # "daily" ("HH:MM") ou "interval" (minutes)
    schedule_value: str    # ex: "04:00" ou "60"
    payload: Optional[str] = ""


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
        is_running = bool(c and c.status == "running")

        # Lecture du max-players dans server.properties
        max_players = 20
        props_file = os.path.join(s.path, "server.properties")
        if os.path.exists(props_file):
            try:
                with open(props_file, "r", encoding="utf-8", errors="replace") as pf:
                    for line in pf:
                        if line.strip().startswith("max-players="):
                            max_players = int(line.strip().split("=", 1)[1].strip())
                            break
            except Exception:
                pass

        online_players: list[str] = []
        if is_running and c:
            try:
                exec_res = c.exec_run("rcon-cli list")
                clean_out = ANSI_ESCAPE_RE.sub("", exec_res.output.decode("utf-8", errors="replace")).strip()
                m = re.search(r"There are (\d+)\s+(?:of a max of|/)\s*(\d+)\s+players online:?(.*)", clean_out, re.IGNORECASE | re.DOTALL)
                if m:
                    max_players = int(m.group(2))
                    names_part = m.group(3).strip()
                    if names_part:
                        online_players = [p.strip() for p in names_part.split(",") if p.strip()]
            except Exception:
                pass
        
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
            "auto_stop_enabled": bool(getattr(s, "auto_stop_enabled", False)),
            "auto_stop_minutes": int(getattr(s, "auto_stop_minutes", 30) or 30),
            "max_backups": int(getattr(s, "max_backups", 5) or 5),
            "players_online": len(online_players),
            "players_max": max_players,
            "player_names": online_players,
        })
        
    return server_list

def detect_server_engine_and_version(folder_path: str) -> tuple[str, str]:
    """Détecte automatiquement le moteur (VANILLA, PAPER, FORGE, FABRIC...) et la version Minecraft d'un dossier existant"""
    detected_type = None
    detected_version = None

    try:
        entries = os.listdir(folder_path)
    except Exception:
        return ("VANILLA", "LATEST")

    lower_entries = {e.lower(): e for e in entries}

    # 1. Inspecter version_history.json (Paper / Purpur / Spigot)
    vh_path = os.path.join(folder_path, "version_history.json")
    if os.path.exists(vh_path):
        try:
            with open(vh_path, "r", encoding="utf-8", errors="replace") as f:
                vh_text = f.read()
            if "purpur" in vh_text.lower():
                detected_type = "PURPUR"
            elif "paper" in vh_text.lower():
                detected_type = "PAPER"
            m_ver = re.search(r"MC:\s*(1\.\d+(?:\.\d+)?)", vh_text)
            if m_ver:
                detected_version = m_ver.group(1)
        except Exception:
            pass

    # 2. Inspecter les fichiers/dossiers caractéristiques
    if not detected_type:
        if ".fabric" in lower_entries or any(e.startswith("fabric-server") for e in lower_entries):
            detected_type = "FABRIC"
        elif os.path.exists(os.path.join(folder_path, "libraries", "net", "neoforged")) or any("neoforge" in e for e in lower_entries):
            detected_type = "NEOFORGE"
        elif os.path.exists(os.path.join(folder_path, "libraries", "net", "minecraftforge")) or any("forge" in e and e.endswith(".jar") for e in lower_entries):
            detected_type = "FORGE"
        elif "purpur.yml" in lower_entries or any(e.startswith("purpur") and e.endswith(".jar") for e in lower_entries):
            detected_type = "PURPUR"
        elif "paper.yml" in lower_entries or os.path.exists(os.path.join(folder_path, "config", "paper-global.yml")) or any(e.startswith("paper") and e.endswith(".jar") for e in lower_entries):
            detected_type = "PAPER"
        elif "spigot.yml" in lower_entries or any(e.startswith("spigot") and e.endswith(".jar") for e in lower_entries):
            detected_type = "SPIGOT"

    # 3. Inspecter le sous-dossier versions/ (créé par Vanilla / Paper 1.18+)
    versions_dir = os.path.join(folder_path, "versions")
    if not detected_version and os.path.isdir(versions_dir):
        try:
            for v_dir in sorted(os.listdir(versions_dir), reverse=True):
                if re.match(r"^1\.\d+(?:\.\d+)?$", v_dir):
                    detected_version = v_dir
                    break
        except Exception:
            pass

    # 4. Inspecter les noms de fichiers .jar à la racine
    for e_low in lower_entries:
        if e_low.endswith(".jar"):
            m_jar_ver = re.search(r"(1\.\d+(?:\.\d+)?)", e_low)
            if m_jar_ver and not detected_version:
                detected_version = m_jar_ver.group(1)
            if not detected_type:
                if "vanilla" in e_low or "minecraft_server" in e_low or e_low == "server.jar":
                    detected_type = "VANILLA"

    # 5. Inspecter logs/latest.log en dernier recours
    log_path = os.path.join(folder_path, "logs", "latest.log")
    if os.path.exists(log_path) and (not detected_type or not detected_version):
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as lf:
                head_lines = "".join([lf.readline() for _ in range(40)])
            if not detected_version:
                m_log_v = re.search(r"(?:minecraft server version|MC:|Minecraft)\s*(1\.\d+(?:\.\d+)?)", head_lines, re.IGNORECASE)
                if m_log_v:
                    detected_version = m_log_v.group(1)
            if not detected_type:
                hl = head_lines.lower()
                if "paper" in hl:
                    detected_type = "PAPER"
                elif "fabric" in hl:
                    detected_type = "FABRIC"
                elif "neoforge" in hl:
                    detected_type = "NEOFORGE"
                elif "forge" in hl:
                    detected_type = "FORGE"
                elif "spigot" in hl:
                    detected_type = "SPIGOT"
                elif "default game type" in hl or "starting minecraft server" in hl:
                    detected_type = "VANILLA"
        except Exception:
            pass

    # Si aucune trace de Paper/Forge/Fabric/Spigot n'est présente, c'est un serveur VANILLA !
    return (detected_type or "VANILLA", detected_version or "LATEST")


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

            det_type, det_version = detect_server_engine_and_version(folder_path)

            candidates.append({
                "name": folder_name,
                "path": folder_path,
                "already_imported": already_imported,
                "is_minecraft_dir": has_properties or has_world,
                "detected_port": detected_port,
                "detected_type": det_type,
                "detected_version": det_version,
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
                    det_type, det_version = detect_server_engine_and_version(folder_path)
                    chosen_type = det_type
                    if request.engine_overrides and folder_name in request.engine_overrides:
                        chosen_type = request.engine_overrides[folder_name].strip().upper()
                        if chosen_type != det_type:
                            await asyncio.to_thread(
                                prepare_engine_conversion_sync,
                                folder_path,
                                det_type,
                                chosen_type,
                                True
                            )

                    new_server = MinecraftServer(
                        node_id=1,
                        name=folder_name,
                        path=folder_path,
                        server_port=assigned_port,
                        ram="2G",
                        server_type=chosen_type,
                        version=det_version
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


# --- ONGLET PARAMÈTRES : DOCKER, CONVERSION DE MOTEUR & SERVER.PROPERTIES ---

BUKKIT_ENGINES = {"PAPER", "PURPUR", "SPIGOT"}
VANILLA_OR_MODDED_ENGINES = {"VANILLA", "FABRIC", "FORGE", "NEOFORGE"}


def prepare_engine_conversion_sync(
    server_path: str,
    old_type: str,
    new_type: str,
    create_backup: bool = True
) -> list[str]:
    """
    Convertit proprement un serveur d'un moteur à un autre (ex: VANILLA <-> PAPER <-> FORGE/FABRIC) :
    1. Crée un snapshot .zip automatique de sécurité avant conversion (si le dossier contient déjà des données).
    2. Migre les dimensions Nether (DIM-1) et End (DIM1) entre le format Vanilla/Moddé (world/DIM-1)
       et le format Paper/Spigot/Purpur (world_nether/DIM-1) pour ne jamais perdre les mondes.
    3. Nettoie les anciens exécutables .jar de moteur à la racine afin qu'itzg/minecraft-server
       télécharge proprement le nouveau moteur.
    """
    actions_done = []
    if not os.path.exists(server_path):
        return actions_done

    old_t = (old_type or "VANILLA").upper()
    new_t = (new_type or "PAPER").upper()

    has_files = any(
        e for e in os.listdir(server_path)
        if e != ".ourcraft_backups" and not e.startswith(".")
    )
    if create_backup and has_files and old_t != new_t:
        try:
            b_info = _create_backup_zip_sync(server_path, f"avant-conversion-{old_t}-vers-{new_t}")
            actions_done.append(f"Snapshot de sécurité créé ({b_info['name']})")
        except Exception:
            pass

    world_dir = os.path.join(server_path, "world")
    nether_bukkit = os.path.join(server_path, "world_nether", "DIM-1")
    end_bukkit = os.path.join(server_path, "world_the_end", "DIM1")
    nether_vanilla = os.path.join(world_dir, "DIM-1")
    end_vanilla = os.path.join(world_dir, "DIM1")

    # Cas 1 : Passage de PAPER / PURPUR / SPIGOT -> VANILLA / FORGE / FABRIC / NEOFORGE
    if old_t in BUKKIT_ENGINES and new_t in VANILLA_OR_MODDED_ENGINES:
        if os.path.exists(nether_bukkit) and not os.path.exists(nether_vanilla):
            os.makedirs(world_dir, exist_ok=True)
            shutil.move(nether_bukkit, nether_vanilla)
            actions_done.append("Dimension Nether migrée (world_nether -> world/DIM-1)")
        if os.path.exists(end_bukkit) and not os.path.exists(end_vanilla):
            os.makedirs(world_dir, exist_ok=True)
            shutil.move(end_bukkit, end_vanilla)
            actions_done.append("Dimension The End migrée (world_the_end -> world/DIM1)")

    # Cas 2 : Passage de VANILLA / FORGE / FABRIC -> PAPER / PURPUR / SPIGOT
    elif old_t in VANILLA_OR_MODDED_ENGINES and new_t in BUKKIT_ENGINES:
        if os.path.exists(nether_vanilla) and not os.path.exists(nether_bukkit):
            os.makedirs(os.path.dirname(nether_bukkit), exist_ok=True)
            shutil.move(nether_vanilla, nether_bukkit)
            actions_done.append("Dimension Nether adaptée pour Paper/Spigot (world/DIM-1 -> world_nether)")
        if os.path.exists(end_vanilla) and not os.path.exists(end_bukkit):
            os.makedirs(os.path.dirname(end_bukkit), exist_ok=True)
            shutil.move(end_vanilla, end_bukkit)
            actions_done.append("Dimension The End adaptée pour Paper/Spigot (world/DIM1 -> world_the_end)")

    # 3. Nettoyage des anciens fichiers .jar de serveur à la racine pour forcer le téléchargement du nouveau moteur
    if old_t != new_t:
        for entry in os.scandir(server_path):
            if entry.is_file() and entry.name.endswith(".jar"):
                low = entry.name.lower()
                if any(k in low for k in ("paper", "purpur", "spigot", "minecraft_server", "server.jar", "fabric-server", "forge", "neoforge")):
                    try:
                        os.remove(entry.path)
                        actions_done.append(f"Ancien binaire {entry.name} retiré")
                    except Exception:
                        pass

    return actions_done


@app.put("/api/servers/{server_name}/settings")
async def update_server_settings(
    server_name: str,
    settings: ServerSettingsUpdate,
    db: AsyncSession = Depends(get_db)
):
    """Modifie port, RAM, type et version du serveur, convertit le moteur si changé et recrée le conteneur"""
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

    old_type = (getattr(server, "server_type", "VANILLA") or "VANILLA").strip().upper()
    new_type = settings.server_type.strip().upper()
    new_ram = settings.ram.strip().upper()
    new_ver = settings.version.strip()

    docker_config_changed = (
        settings.port != server.server_port
        or new_ram != (getattr(server, "ram", "2G") or "2G").upper()
        or new_type != old_type
        or new_ver != (getattr(server, "version", "LATEST") or "LATEST")
    )

    client = docker.from_env()
    container_name = f"ourcraft_{server_name}"
    was_running = False
    if docker_config_changed:
        try:
            old_container = client.containers.get(container_name)
            was_running = old_container.status == "running"
            if was_running:
                old_container.exec_run("rcon-cli save-all")
                await asyncio.sleep(1)
                old_container.stop(timeout=10)
            old_container.remove()
        except docker.errors.NotFound:
            pass
        except docker.errors.APIError as e:
            raise HTTPException(status_code=500, detail=f"Erreur lors de l'arrêt du conteneur Docker : {str(e)}")

    conversion_notes = []
    if old_type != new_type:
        conversion_notes = await asyncio.to_thread(
            prepare_engine_conversion_sync,
            server.path,
            old_type,
            new_type,
            bool(settings.backup_before_convert)
        )

    server.server_port = settings.port
    server.ram = new_ram
    server.server_type = new_type
    server.version = new_ver
    if settings.auto_stop_enabled is not None:
        server.auto_stop_enabled = bool(settings.auto_stop_enabled)
    if settings.auto_stop_minutes is not None:
        server.auto_stop_minutes = max(1, int(settings.auto_stop_minutes))
    if settings.max_backups is not None:
        server.max_backups = max(1, int(settings.max_backups))

    await db.commit()
    await db.refresh(server)

    # Synchroniser server-port dans server.properties si le fichier existe
    props_path = os.path.join(server.path, "server.properties")
    if os.path.exists(props_path):
        try:
            update_properties_file(props_path, {"server-port": str(settings.port)})
        except Exception:
            pass

    if docker_config_changed and was_running:
        try:
            create_server_container(client, server)
        except docker.errors.APIError as e:
            raise HTTPException(status_code=500, detail=f"Paramètres sauvegardés, mais erreur au redémarrage Docker : {str(e)}")

    conv_msg = f" (Conversion {old_type} → {new_type} effectuée : {', '.join(conversion_notes)})" if conversion_notes else ""
    return {
        "status": "success",
        "message": (
            f"Paramètres appliqués et conteneur redémarré{conv_msg} !"
            if was_running
            else f"Paramètres sauvegardés{conv_msg} ! Ils seront appliqués au prochain démarrage."
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

    # Lecture des fichiers ops.json, banned-players.json et whitelist.json sur le disque
    ops_list = []
    banned_list = []
    whitelist_list = []
    whitelist_enabled = False

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

    wl_path = os.path.join(server.path, "whitelist.json")
    if os.path.exists(wl_path):
        try:
            with open(wl_path, "r", encoding="utf-8") as f:
                wl_data = json.load(f)
                whitelist_list = [entry.get("name") for entry in wl_data if isinstance(entry, dict) and entry.get("name")]
        except Exception:
            pass

    props_path = os.path.join(server.path, "server.properties")
    if os.path.exists(props_path):
        try:
            with open(props_path, "r", encoding="utf-8", errors="replace") as pf:
                whitelist_enabled = "white-list=true" in pf.read().lower()
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
                "whitelist": whitelist_list,
                "whitelist_enabled": whitelist_enabled,
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
            "whitelist": whitelist_list,
            "whitelist_enabled": whitelist_enabled,
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
            "whitelist": whitelist_list,
            "whitelist_enabled": whitelist_enabled,
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


@app.post("/api/servers/{server_name}/files/upload")
async def upload_server_file(
    server_name: str,
    request: Request,
    path: str = Query(..., description="Chemin relatif où enregistrer le fichier déposé"),
    db: AsyncSession = Depends(get_db)
):
    """Téléverse un fichier binaire ou texte (Drag & Drop dans le Web FTP)"""
    server = await get_server_or_404(server_name, db)
    target_file = resolve_safe_path(server.path, path)

    if os.path.isdir(target_file):
        raise HTTPException(status_code=400, detail="Le chemin cible est un dossier.")

    body = await request.body()
    try:
        os.makedirs(os.path.dirname(target_file), exist_ok=True)
        with open(target_file, "wb") as f:
            f.write(body)
        return {
            "status": "success",
            "message": f"Fichier '{os.path.basename(target_file)}' importé ({len(body)} octets) !",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors du téléversement : {str(e)}")


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
    if config_data.port is not None:
        if config_data.port in used_ports:
            raise HTTPException(status_code=400, detail=f"Le port {config_data.port} est déjà utilisé par un autre serveur.")
        available_port = config_data.port
    else:
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


# ==============================================================================
# BLOC 2 — FONCTIONNALITÉS AVANCÉES DU SERVEUR
# 1. MONITORING (CPU / RAM / RÉSEAU EN TEMPS RÉEL)
# ==============================================================================

def parse_ram_to_mb(ram_str: str) -> int:
    s = (ram_str or "2G").strip().upper()
    try:
        if s.endswith("G"):
            return int(float(s[:-1]) * 1024)
        if s.endswith("M"):
            return int(float(s[:-1]))
        return int(s)
    except Exception:
        return 2048


def _get_docker_stats_sync(container_name: str, allocated_ram_mb: int) -> dict:
    client = docker.from_env()
    try:
        container = client.containers.get(container_name)
        if container.status != "running":
            return {
                "online": False,
                "cpu_percent": 0.0,
                "ram_used_mb": 0,
                "ram_limit_mb": allocated_ram_mb,
                "ram_percent": 0.0,
                "net_rx_mb": 0.0,
                "net_tx_mb": 0.0,
                "pids": 0,
            }

        stats = container.stats(stream=False)

        # Calcul CPU %
        cpu_percent = 0.0
        cpu_stats = stats.get("cpu_stats", {})
        precpu_stats = stats.get("precpu_stats", {})
        cpu_delta = (
            cpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            - precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
        )
        system_delta = (
            cpu_stats.get("system_cpu_usage", 0)
            - precpu_stats.get("system_cpu_usage", 0)
        )
        online_cpus = (
            cpu_stats.get("online_cpus")
            or len(cpu_stats.get("cpu_usage", {}).get("percpu_usage") or [1])
        )
        if system_delta > 0 and cpu_delta > 0:
            cpu_percent = round((cpu_delta / system_delta) * online_cpus * 100.0, 1)

        # Calcul RAM (Mo)
        mem_stats = stats.get("memory_stats", {})
        mem_usage = mem_stats.get("usage", 0)
        mem_cache = mem_stats.get("stats", {}).get("inactive_file") or mem_stats.get("stats", {}).get("cache") or 0
        actual_mem = max(0, mem_usage - mem_cache)
        ram_used_mb = round(actual_mem / (1024 * 1024), 1)
        ram_limit_mb = max(allocated_ram_mb, 256)
        ram_percent = min(100.0, round((ram_used_mb / ram_limit_mb) * 100.0, 1))

        # Trafic Réseau
        networks = stats.get("networks", {})
        rx_bytes = sum(net.get("rx_bytes", 0) for net in networks.values())
        tx_bytes = sum(net.get("tx_bytes", 0) for net in networks.values())

        pids = stats.get("pids_stats", {}).get("current", 0)

        return {
            "online": True,
            "cpu_percent": cpu_percent,
            "ram_used_mb": ram_used_mb,
            "ram_limit_mb": ram_limit_mb,
            "ram_percent": ram_percent,
            "net_rx_mb": round(rx_bytes / (1024 * 1024), 2),
            "net_tx_mb": round(tx_bytes / (1024 * 1024), 2),
            "pids": pids,
        }
    except docker.errors.NotFound:
        return {
            "online": False,
            "cpu_percent": 0.0,
            "ram_used_mb": 0,
            "ram_limit_mb": allocated_ram_mb,
            "ram_percent": 0.0,
            "net_rx_mb": 0.0,
            "net_tx_mb": 0.0,
            "pids": 0,
        }


@app.get("/api/servers/{server_name}/stats")
async def get_server_stats(server_name: str, db: AsyncSession = Depends(get_db)):
    """Récupère en direct la consommation CPU, RAM et Réseau du conteneur Docker"""
    server = await get_server_or_404(server_name, db)
    allocated_mb = parse_ram_to_mb(getattr(server, "ram", "2G"))
    return await asyncio.to_thread(_get_docker_stats_sync, f"ourcraft_{server_name}", allocated_mb)


# ==============================================================================
# 2. MODS & PLUGINS (TÉLÉCHARGEUR INTÉGRÉ MODRINTH + GESTION LOCALE)
# ==============================================================================

def get_addon_context(server: MinecraftServer) -> dict:
    s_type = (getattr(server, "server_type", "PAPER") or "PAPER").upper()
    if s_type in {"FORGE", "FABRIC", "NEOFORGE"}:
        return {
            "folder": "mods",
            "kind": "mod",
            "label": "Mods",
            "loader": s_type.lower(),
            "project_type": "mod",
        }
    elif s_type in {"PAPER", "PURPUR", "SPIGOT"}:
        return {
            "folder": "plugins",
            "kind": "plugin",
            "label": "Plugins",
            "loader": s_type.lower(),
            "project_type": "plugin",
        }
    else:
        return {
            "folder": "mods",
            "kind": "mod",
            "label": "Mods / Addons",
            "loader": "fabric",
            "project_type": "mod",
        }


def _modrinth_get_json(url: str):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "OurCraft-Panel/2.0 (https://github.com/Xenon99o9/OurCraft)"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


@app.get("/api/servers/{server_name}/addons/installed")
async def list_installed_addons(server_name: str, db: AsyncSession = Depends(get_db)):
    """Liste les fichiers .jar (et .jar.disabled) installés dans /mods ou /plugins"""
    server = await get_server_or_404(server_name, db)
    ctx = get_addon_context(server)
    target_dir = resolve_safe_path(server.path, ctx["folder"])
    os.makedirs(target_dir, exist_ok=True)

    items = []
    for entry in os.scandir(target_dir):
        if entry.is_file() and (entry.name.endswith(".jar") or entry.name.endswith(".jar.disabled")):
            stat = entry.stat()
            enabled = entry.name.endswith(".jar")
            items.append({
                "filename": entry.name,
                "size": stat.st_size,
                "modified": int(stat.st_mtime),
                "enabled": enabled,
            })

    items.sort(key=lambda x: x["filename"].lower())
    return {
        "context": ctx,
        "server_type": getattr(server, "server_type", "PAPER"),
        "version": getattr(server, "version", "LATEST"),
        "items": items,
    }


@app.get("/api/servers/{server_name}/addons/search")
async def search_modrinth_addons(
    server_name: str,
    q: str = Query("", description="Recherche de mod ou plugin"),
    db: AsyncSession = Depends(get_db)
):
    """Recherche des Mods ou Plugins sur l'API officielle Modrinth filtrés pour le serveur"""
    server = await get_server_or_404(server_name, db)
    ctx = get_addon_context(server)
    mc_version = (getattr(server, "version", "LATEST") or "LATEST").strip()

    facets = [[f"categories:{ctx['loader']}"]]
    if mc_version.upper() != "LATEST":
        facets.append([f"versions:{mc_version}"])

    params = {
        "query": q.strip(),
        "limit": 18,
        "index": "relevance" if q.strip() else "downloads",
        "facets": json.dumps(facets),
    }
    url = f"https://api.modrinth.com/v2/search?{urllib.parse.urlencode(params)}"

    try:
        data = await asyncio.to_thread(_modrinth_get_json, url)
        hits = data.get("hits", [])
        # Si aucun résultat avec le filtre strict de version, on élargit au loader
        if not hits and mc_version.upper() != "LATEST":
            fallback_params = {
                "query": q.strip(),
                "limit": 18,
                "index": "relevance" if q.strip() else "downloads",
                "facets": json.dumps([[f"categories:{ctx['loader']}"]]),
            }
            url_fb = f"https://api.modrinth.com/v2/search?{urllib.parse.urlencode(fallback_params)}"
            data = await asyncio.to_thread(_modrinth_get_json, url_fb)
            hits = data.get("hits", [])

        results = []
        for h in hits:
            results.append({
                "project_id": h.get("project_id"),
                "slug": h.get("slug"),
                "title": h.get("title"),
                "description": h.get("description"),
                "author": h.get("author"),
                "downloads": h.get("downloads", 0),
                "icon_url": h.get("icon_url"),
                "categories": h.get("categories", []),
            })
        return {"context": ctx, "results": results}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur lors de la recherche Modrinth : {str(e)}")


def _download_addon_sync(project_id: str, loader: str, mc_version: str, target_dir: str) -> dict:
    # 1. Chercher les versions disponibles sur Modrinth pour ce projet
    params = {"loaders": json.dumps([loader])}
    if mc_version.upper() != "LATEST":
        params["game_versions"] = json.dumps([mc_version])

    url = f"https://api.modrinth.com/v2/project/{project_id}/version?{urllib.parse.urlencode(params)}"
    versions = _modrinth_get_json(url)

    # Fallback sans filtre game_version si LATEST ou version voisine compatible
    if not versions:
        url_fb = f"https://api.modrinth.com/v2/project/{project_id}/version?{urllib.parse.urlencode({'loaders': json.dumps([loader])})}"
        versions = _modrinth_get_json(url_fb)

    if not versions:
        url_any = f"https://api.modrinth.com/v2/project/{project_id}/version"
        versions = _modrinth_get_json(url_any)

    if not versions:
        raise ValueError("Aucune version téléchargeable trouvée pour ce projet.")

    chosen_version = versions[0]
    files = chosen_version.get("files", [])
    primary_file = next((f for f in files if f.get("primary")), files[0] if files else None)
    if not primary_file or not primary_file.get("url"):
        raise ValueError("Aucun fichier .jar attaché à cette version.")

    filename = os.path.basename(primary_file["filename"])
    if not filename.endswith(".jar"):
        filename += ".jar"

    os.makedirs(target_dir, exist_ok=True)
    dest_path = os.path.join(target_dir, filename)

    req = urllib.request.Request(
        primary_file["url"],
        headers={"User-Agent": "OurCraft-Panel/2.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp, open(dest_path, "wb") as out_f:
        shutil.copyfileobj(resp, out_f)

    return {
        "filename": filename,
        "version_number": chosen_version.get("version_number", ""),
        "size": os.path.getsize(dest_path),
    }


@app.post("/api/servers/{server_name}/addons/install")
async def install_modrinth_addon(
    server_name: str,
    payload: AddonInstallRequest,
    db: AsyncSession = Depends(get_db)
):
    """Télécharge et installe directement un Mod ou Plugin depuis Modrinth dans le dossier du serveur"""
    server = await get_server_or_404(server_name, db)
    ctx = get_addon_context(server)
    target_dir = resolve_safe_path(server.path, ctx["folder"])
    mc_version = (getattr(server, "version", "LATEST") or "LATEST").strip()

    try:
        info = await asyncio.to_thread(
            _download_addon_sync,
            payload.project_id,
            ctx["loader"],
            mc_version,
            target_dir
        )
        return {
            "status": "success",
            "message": f"'{info['filename']}' (v{info['version_number']}) installé dans /{ctx['folder']} !",
            "installed": info,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Échec de l'installation : {str(e)}")


@app.put("/api/servers/{server_name}/addons/{filename}/toggle")
async def toggle_installed_addon(
    server_name: str,
    filename: str,
    db: AsyncSession = Depends(get_db)
):
    """Active ou désactive un mod/plugin en le renommant (.jar <-> .jar.disabled)"""
    server = await get_server_or_404(server_name, db)
    ctx = get_addon_context(server)
    target_dir = resolve_safe_path(server.path, ctx["folder"])
    file_path = resolve_safe_path(target_dir, filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    if filename.endswith(".jar.disabled"):
        new_name = filename[:-9]  # retire .disabled
    elif filename.endswith(".jar"):
        new_name = filename + ".disabled"
    else:
        raise HTTPException(status_code=400, detail="Extension non supportée.")

    new_path = resolve_safe_path(target_dir, new_name)
    os.rename(file_path, new_path)
    return {"status": "success", "filename": new_name}


@app.delete("/api/servers/{server_name}/addons/{filename}")
async def delete_installed_addon(
    server_name: str,
    filename: str,
    db: AsyncSession = Depends(get_db)
):
    """Supprime un fichier .jar du dossier /mods ou /plugins"""
    server = await get_server_or_404(server_name, db)
    ctx = get_addon_context(server)
    target_dir = resolve_safe_path(server.path, ctx["folder"])
    file_path = resolve_safe_path(target_dir, filename)

    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    os.remove(file_path)
    return {"status": "success", "message": f"'{filename}' supprimé."}


# ==============================================================================
# 3. SAUVEGARDES / SNAPSHOTS (CRÉATION .ZIP, LISTE, RESTAURATION, SUPPRESSION)
# ==============================================================================

BACKUP_FOLDER_NAME = ".ourcraft_backups"


def _enforce_backup_rotation_sync(backup_dir: str, max_backups: int = 5):
    """Supprime automatiquement les plus anciennes archives .zip au-delà de la limite max_backups"""
    if max_backups <= 0 or not os.path.exists(backup_dir):
        return
    zips = []
    for entry in os.scandir(backup_dir):
        if entry.is_file() and entry.name.endswith(".zip") and not entry.name.startswith("_"):
            try:
                zips.append((entry.stat().st_mtime, entry.path))
            except Exception:
                pass
    zips.sort(key=lambda x: x[0], reverse=True)
    for _, old_zip_path in zips[max_backups:]:
        try:
            os.remove(old_zip_path)
        except Exception:
            pass


def _create_backup_zip_sync(server_path: str, label: str, max_backups: int = 5) -> dict:
    backup_dir = os.path.join(server_path, BACKUP_FOLDER_NAME)
    os.makedirs(backup_dir, exist_ok=True)

    safe_label = re.sub(r"[^a-zA-Z0-9_-]", "-", (label or "snapshot").strip())[:40] or "snapshot"
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    zip_filename = f"{timestamp}_{safe_label}.zip"
    zip_filepath = os.path.join(backup_dir, zip_filename)

    with zipfile.ZipFile(zip_filepath, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(server_path):
            # Ne jamais inclure le dossier des backups lui-même
            dirs[:] = [d for d in dirs if d != BACKUP_FOLDER_NAME]
            for file in files:
                abs_file = os.path.join(root, file)
                rel_file = os.path.relpath(abs_file, server_path)
                try:
                    zf.write(abs_file, rel_file)
                except Exception:
                    pass

    stat = os.stat(zip_filepath)
    _enforce_backup_rotation_sync(backup_dir, max_backups)
    return {
        "name": zip_filename,
        "size": stat.st_size,
        "created_at": int(stat.st_mtime),
    }


def _restore_backup_zip_sync(server_path: str, backup_name: str):
    backup_dir = os.path.join(server_path, BACKUP_FOLDER_NAME)
    zip_filepath = resolve_safe_path(backup_dir, backup_name)
    if not os.path.exists(zip_filepath):
        raise FileNotFoundError("Archive de sauvegarde introuvable.")

    # Nettoyer le contenu actuel du serveur (hormis le dossier .ourcraft_backups)
    for entry in os.scandir(server_path):
        if entry.name == BACKUP_FOLDER_NAME:
            continue
        if entry.is_dir(follow_symlinks=False):
            shutil.rmtree(entry.path, ignore_errors=True)
        else:
            try:
                os.remove(entry.path)
            except Exception:
                pass

    with zipfile.ZipFile(zip_filepath, "r") as zf:
        zf.extractall(server_path)


@app.get("/api/servers/{server_name}/backups")
async def list_server_backups(server_name: str, db: AsyncSession = Depends(get_db)):
    """Liste les snapshots (.zip) disponibles pour ce serveur"""
    server = await get_server_or_404(server_name, db)
    backup_dir = os.path.join(server.path, BACKUP_FOLDER_NAME)
    if not os.path.exists(backup_dir):
        return {"backups": []}

    backups = []
    for entry in os.scandir(backup_dir):
        if entry.is_file() and entry.name.endswith(".zip"):
            stat = entry.stat()
            backups.append({
                "name": entry.name,
                "size": stat.st_size,
                "created_at": int(stat.st_mtime),
            })

    backups.sort(key=lambda x: x["created_at"], reverse=True)
    return {"backups": backups}


@app.post("/api/servers/{server_name}/backups")
async def create_server_backup(
    server_name: str,
    payload: BackupCreateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Force un save-all en jeu (si allumé) puis compresse le serveur dans une archive .zip"""
    server = await get_server_or_404(server_name, db)

    # Si le conteneur tourne, on force la sauvegarde du monde sur le disque avant de zipper
    try:
        client = docker.from_env()
        container = client.containers.get(f"ourcraft_{server_name}")
        if container.status == "running":
            container.exec_run("rcon-cli save-all")
            await asyncio.sleep(1.0)
    except Exception:
        pass

    max_b = int(getattr(server, "max_backups", 5) or 5)
    try:
        info = await asyncio.to_thread(_create_backup_zip_sync, server.path, payload.label or "snapshot", max_b)
        return {
            "status": "success",
            "message": f"Snapshot '{info['name']}' créé avec succès (rotation automatique : {max_b} max) !",
            "backup": info,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création du snapshot : {str(e)}")


@app.post("/api/servers/{server_name}/backups/{backup_name}/restore")
async def restore_server_backup(
    server_name: str,
    backup_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Arrête le serveur s'il tourne, restaure l'archive .zip et le rallume s'il était en ligne"""
    server = await get_server_or_404(server_name, db)

    client = docker.from_env()
    was_running = False
    container = None
    try:
        container = client.containers.get(f"ourcraft_{server_name}")
        was_running = container.status == "running"
        if was_running:
            container.stop(timeout=10)
    except docker.errors.NotFound:
        pass

    try:
        await asyncio.to_thread(_restore_backup_zip_sync, server.path, backup_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la restauration : {str(e)}")

    if was_running and container:
        try:
            container.start()
        except Exception:
            pass

    return {
        "status": "success",
        "message": (
            f"Snapshot '{backup_name}' restauré et serveur redémarré !"
            if was_running
            else f"Snapshot '{backup_name}' restauré avec succès !"
        ),
    }


@app.delete("/api/servers/{server_name}/backups/{backup_name}")
async def delete_server_backup(
    server_name: str,
    backup_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Supprime une archive de sauvegarde"""
    server = await get_server_or_404(server_name, db)
    backup_dir = os.path.join(server.path, BACKUP_FOLDER_NAME)
    target_zip = resolve_safe_path(backup_dir, backup_name)

    if not os.path.exists(target_zip) or not os.path.isfile(target_zip):
        raise HTTPException(status_code=404, detail="Snapshot introuvable.")

    os.remove(target_zip)
    return {"status": "success", "message": f"Snapshot '{backup_name}' supprimé."}


@app.get("/api/servers/{server_name}/backups/{backup_name}/download")
async def download_server_backup(
    server_name: str,
    backup_name: str,
    db: AsyncSession = Depends(get_db)
):
    """Télécharge une archive de sauvegarde (.zip) sur le PC de l'utilisateur"""
    server = await get_server_or_404(server_name, db)
    backup_dir = os.path.join(server.path, BACKUP_FOLDER_NAME)
    target_zip = resolve_safe_path(backup_dir, backup_name)

    if not os.path.exists(target_zip) or not os.path.isfile(target_zip):
        raise HTTPException(status_code=404, detail="Snapshot introuvable.")

    return FileResponse(
        path=target_zip,
        media_type="application/zip",
        filename=backup_name,
    )


def _import_world_zip_sync(server_path: str, zip_bytes: bytes):
    """Sauvegarde l'ancien monde, puis extrait une archive de map (.zip) dans /world"""
    _create_backup_zip_sync(server_path, "avant-import-map")

    backup_dir = os.path.join(server_path, BACKUP_FOLDER_NAME)
    os.makedirs(backup_dir, exist_ok=True)
    tmp_zip = os.path.join(backup_dir, "_upload_world_tmp.zip")
    tmp_extract = os.path.join(backup_dir, "_upload_world_extract")

    if os.path.exists(tmp_extract):
        shutil.rmtree(tmp_extract, ignore_errors=True)

    with open(tmp_zip, "wb") as f:
        f.write(zip_bytes)

    try:
        with zipfile.ZipFile(tmp_zip, "r") as zf:
            zf.extractall(tmp_extract)

        # Trouver le dossier qui contient level.dat (soit à la racine du zip, soit dans un sous-dossier)
        source_world_dir = tmp_extract
        if not os.path.exists(os.path.join(tmp_extract, "level.dat")):
            for root, dirs, files in os.walk(tmp_extract):
                if "level.dat" in files:
                    source_world_dir = root
                    break

        target_world_dir = os.path.join(server_path, "world")
        if os.path.exists(target_world_dir):
            shutil.rmtree(target_world_dir, ignore_errors=True)

        shutil.copytree(source_world_dir, target_world_dir)
    finally:
        if os.path.exists(tmp_zip):
            os.remove(tmp_zip)
        if os.path.exists(tmp_extract):
            shutil.rmtree(tmp_extract, ignore_errors=True)


@app.post("/api/servers/{server_name}/world/import")
async def import_custom_world_zip(
    server_name: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Importe une map Minecraft (.zip) dans le dossier world/ du serveur (avec snapshot automatique avant)"""
    server = await get_server_or_404(server_name, db)
    zip_bytes = await request.body()
    if not zip_bytes:
        raise HTTPException(status_code=400, detail="Fichier .zip vide.")

    client = docker.from_env()
    was_running = False
    container = None
    try:
        container = client.containers.get(f"ourcraft_{server_name}")
        was_running = container.status == "running"
        if was_running:
            container.stop(timeout=10)
    except docker.errors.NotFound:
        pass

    try:
        await asyncio.to_thread(_import_world_zip_sync, server.path, zip_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Archive de map invalide : {str(e)}")

    if was_running and container:
        try:
            container.start()
        except Exception:
            pass

    return {
        "status": "success",
        "message": "Nouvelle map importée dans /world avec succès (une sauvegarde de l'ancien monde a été créée automatiquement) !",
    }


# ==============================================================================
# 4. PLANIFICATEUR / CRON (TÂCHES AUTOMATISÉES PAR SERVEUR)
# ==============================================================================

async def execute_scheduled_action(task: ScheduledTask, db: AsyncSession):
    """Exécute l'action d'une tâche planifiée (restart, backup, command, stop, start)"""
    res = await db.execute(select(MinecraftServer).filter_by(name=task.server_name))
    server = res.scalars().first()
    if not server:
        return

    client = docker.from_env()
    container_name = f"ourcraft_{server.name}"

    if task.action_type == "restart":
        try:
            container = client.containers.get(container_name)
            if container.status == "running":
                msg = (task.payload or "[OurCraft] Redémarrage automatique programmé dans 5 secondes...").strip()
                container.exec_run(f"rcon-cli say {msg}")
                await asyncio.sleep(5)
                container.restart(timeout=10)
            else:
                container.start()
        except docker.errors.NotFound:
            create_server_container(client, server)

    elif task.action_type == "backup":
        try:
            container = client.containers.get(container_name)
            if container.status == "running":
                container.exec_run("rcon-cli save-all")
                if task.payload:
                    container.exec_run(f"rcon-cli say {task.payload.strip()}")
                await asyncio.sleep(1)
        except Exception:
            pass
        max_b = int(getattr(server, "max_backups", 5) or 5)
        await asyncio.to_thread(_create_backup_zip_sync, server.path, f"auto-{task.name}", max_b)

    elif task.action_type == "command":
        try:
            container = client.containers.get(container_name)
            if container.status == "running" and task.payload:
                clean_cmd = task.payload.strip().lstrip("/")
                container.exec_run(f"rcon-cli {clean_cmd}")
        except Exception:
            pass

    elif task.action_type == "stop":
        try:
            container = client.containers.get(container_name)
            if container.status == "running":
                if task.payload:
                    container.exec_run(f"rcon-cli say {task.payload.strip()}")
                    await asyncio.sleep(3)
                container.stop(timeout=10)
        except Exception:
            pass

    elif task.action_type == "start":
        try:
            container = client.containers.get(container_name)
            if container.status != "running":
                container.start()
        except docker.errors.NotFound:
            create_server_container(client, server)


_idle_since_by_server: Dict[str, float] = {}


async def _check_auto_stop_idle_servers(session: AsyncSession):
    """Vérifie les serveurs avec mise en veille automatique (Auto-Stop) activée et les arrête si 0 joueur depuis X min"""
    res_srv = await session.execute(select(MinecraftServer).filter_by(auto_stop_enabled=True))
    auto_servers = res_srv.scalars().all()
    if not auto_servers:
        return

    client = docker.from_env()
    now_ts = time.time()

    for srv in auto_servers:
        container_name = f"ourcraft_{srv.name}"
        try:
            container = client.containers.get(container_name)
            if container.status != "running":
                _idle_since_by_server.pop(srv.name, None)
                continue

            exec_res = container.exec_run("rcon-cli list")
            clean_out = ANSI_ESCAPE_RE.sub("", exec_res.output.decode("utf-8", errors="replace")).strip()
            m = re.search(r"There are (\d+)\s+(?:of a max of|/)\s*(\d+)\s+players online", clean_out, re.IGNORECASE)
            if not m:
                # Le serveur est peut-être encore en train de démarrer
                continue

            online_count = int(m.group(1))
            if online_count > 0:
                _idle_since_by_server.pop(srv.name, None)
            else:
                if srv.name not in _idle_since_by_server:
                    _idle_since_by_server[srv.name] = now_ts
                else:
                    idle_mins = (now_ts - _idle_since_by_server[srv.name]) / 60.0
                    target_mins = max(1, int(getattr(srv, "auto_stop_minutes", 30) or 30))
                    if idle_mins >= target_mins:
                        print(f"[Auto-Stop] Serveur '{srv.name}' inactif depuis {int(idle_mins)} min -> mise en veille.")
                        container.exec_run("rcon-cli save-all")
                        await asyncio.sleep(1)
                        container.stop(timeout=10)
                        _idle_since_by_server.pop(srv.name, None)
        except Exception:
            _idle_since_by_server.pop(srv.name, None)


async def scheduler_background_loop():
    """Boucle d'arrière-plan qui vérifie toutes les 25s les tâches Cron et la mise en veille automatique"""
    while True:
        try:
            await asyncio.sleep(25)
            if not _db_initialized:
                continue

            now = datetime.now()
            current_hhmm = now.strftime("%H:%M")
            today_prefix = now.strftime("%Y-%m-%d")

            async with AsyncSessionLocal() as session:
                await _check_auto_stop_idle_servers(session)

                res = await session.execute(select(ScheduledTask).filter_by(enabled=True))
                tasks = res.scalars().all()

                for task in tasks:
                    should_run = False

                    if task.schedule_type == "daily":
                        # S'exécute une fois par jour lorsque HH:MM correspond
                        if task.schedule_value == current_hhmm and not (task.last_run or "").startswith(f"{today_prefix} {current_hhmm}"):
                            should_run = True

                    elif task.schedule_type == "interval":
                        # S'exécute toutes les X minutes
                        try:
                            interval_mins = max(1, int(task.schedule_value))
                            if not task.last_run:
                                should_run = True
                            else:
                                last_dt = datetime.strptime(task.last_run, "%Y-%m-%d %H:%M:%S")
                                elapsed_mins = (now - last_dt).total_seconds() / 60.0
                                if elapsed_mins >= interval_mins:
                                    should_run = True
                        except Exception:
                            should_run = True

                    if should_run:
                        task.last_run = now.strftime("%Y-%m-%d %H:%M:%S")
                        await session.commit()
                        try:
                            await execute_scheduled_action(task, session)
                        except Exception as e:
                            print(f"[Scheduler] Erreur tâche {task.name}: {e}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[Scheduler] Erreur boucle: {e}")


@app.get("/api/servers/{server_name}/schedules")
async def list_server_schedules(server_name: str, db: AsyncSession = Depends(get_db)):
    """Liste les tâches planifiées (Cron) d'un serveur"""
    await get_server_or_404(server_name, db)
    res = await db.execute(select(ScheduledTask).filter_by(server_name=server_name))
    tasks = res.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "action_type": t.action_type,
            "schedule_type": t.schedule_type,
            "schedule_value": t.schedule_value,
            "payload": t.payload,
            "enabled": t.enabled,
            "last_run": t.last_run,
        }
        for t in tasks
    ]


@app.post("/api/servers/{server_name}/schedules")
async def create_server_schedule(
    server_name: str,
    payload: ScheduleCreateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Crée une nouvelle tâche automatisée pour ce serveur"""
    await get_server_or_404(server_name, db)
    new_task = ScheduledTask(
        server_name=server_name,
        name=payload.name.strip(),
        action_type=payload.action_type,
        schedule_type=payload.schedule_type,
        schedule_value=payload.schedule_value.strip(),
        payload=(payload.payload or "").strip(),
        enabled=True,
        last_run="",
    )
    db.add(new_task)
    await db.commit()
    return {"status": "success", "message": f"Tâche '{new_task.name}' programmée avec succès !"}


@app.put("/api/servers/{server_name}/schedules/{task_id}/toggle")
async def toggle_server_schedule(
    server_name: str,
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Active ou met en pause une tâche planifiée"""
    res = await db.execute(select(ScheduledTask).filter_by(id=task_id, server_name=server_name))
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    task.enabled = not task.enabled
    await db.commit()
    return {"status": "success", "enabled": task.enabled}


@app.post("/api/servers/{server_name}/schedules/{task_id}/run")
async def run_server_schedule_now(
    server_name: str,
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Exécute immédiatement une tâche planifiée pour la tester"""
    res = await db.execute(select(ScheduledTask).filter_by(id=task_id, server_name=server_name))
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")

    task.last_run = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    await db.commit()
    await execute_scheduled_action(task, db)
    return {"status": "success", "message": f"Tâche '{task.name}' exécutée immédiatement !"}


@app.delete("/api/servers/{server_name}/schedules/{task_id}")
async def delete_server_schedule(
    server_name: str,
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Supprime une tâche planifiée"""
    res = await db.execute(select(ScheduledTask).filter_by(id=task_id, server_name=server_name))
    task = res.scalars().first()
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable.")
    await db.delete(task)
    await db.commit()
    return {"status": "success", "message": "Tâche supprimée."}


# ==============================================================================
# BLOC 3 — SÉCURITÉ ET ADMINISTRATION
# 1. AUTHENTIFICATION & COMPTES MULTI-UTILISATEURS (DROITS PAR SERVEUR)
# ==============================================================================

AUTH_SECRET = os.getenv("OURCRAFT_SECRET", "ourcraft-v2-secret-key-hmac-2026")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if "$" not in stored_hash:
        return False
    salt, expected_hex = stored_hash.split("$", 1)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return hmac.compare_digest(dk.hex(), expected_hex)


def create_auth_token(user_id: int, username: str, role: str) -> str:
    payload = json.dumps({
        "uid": user_id,
        "sub": username,
        "role": role,
        "exp": int(time.time()) + 86400 * 7,  # Valide 7 jours
    }).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(payload).decode("utf-8").rstrip("=")
    sig = hmac.new(AUTH_SECRET.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{sig}"


def decode_auth_token(token: str) -> Optional[dict]:
    try:
        if "." not in token:
            return None
        b64_payload, sig = token.split(".", 1)
        expected_sig = hmac.new(AUTH_SECRET.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        padding = "=" * (-len(b64_payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(b64_payload + padding).decode("utf-8"))
        if data.get("exp", 0) < int(time.time()):
            return None
        return data
    except Exception:
        return None


def serialize_user(u: User) -> dict:
    try:
        perms = json.loads(u.permissions_json or "{}")
    except Exception:
        perms = {}
    return {
        "id": u.id,
        "username": u.username,
        "role": getattr(u, "role", "admin") or "admin",
        "permissions": perms,
        "theme": getattr(u, "theme", "discord") or "discord",
    }


class ThemeUpdateRequest(BaseModel):
    theme: str


class AuthLoginRequest(BaseModel):
    username: str
    password: str


class UserCreateUpdateRequest(BaseModel):
    username: str
    password: Optional[str] = None
    role: str = "subuser"  # "admin" ou "subuser"
    permissions: Dict[str, Dict[str, bool]] = {}


@app.get("/api/auth/status")
async def get_auth_status(db: AsyncSession = Depends(get_db)):
    """Indique si au moins un compte existe déjà en base de données"""
    res = await db.execute(select(User))
    users = res.scalars().all()
    return {"has_users": len(users) > 0, "count": len(users)}


@app.post("/api/auth/setup")
async def setup_initial_admin(payload: AuthLoginRequest, db: AsyncSession = Depends(get_db)):
    """Crée le tout premier compte Administrateur central lors du premier lancement"""
    res = await db.execute(select(User))
    if res.scalars().first():
        raise HTTPException(status_code=400, detail="Un compte administrateur existe déjà.")

    username = payload.username.strip()
    if len(username) < 2 or len(payload.password) < 4:
        raise HTTPException(status_code=400, detail="Nom d'utilisateur ou mot de passe trop court.")

    admin_user = User(
        username=username,
        password_hash=hash_password(payload.password),
        role="admin",
        permissions_json="{}",
    )
    db.add(admin_user)
    await db.commit()
    await db.refresh(admin_user)

    token = create_auth_token(admin_user.id, admin_user.username, "admin")
    return {"token": token, "user": serialize_user(admin_user)}


@app.post("/api/auth/login")
async def login_user(payload: AuthLoginRequest, db: AsyncSession = Depends(get_db)):
    """Authentifie un compte Admin ou Sous-compte et renvoie son jeton et ses permissions"""
    res = await db.execute(select(User).filter_by(username=payload.username.strip()))
    user = res.scalars().first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Identifiants incorrects.")

    token = create_auth_token(user.id, user.username, user.role or "admin")
    return {"token": token, "user": serialize_user(user)}


@app.get("/api/auth/me")
async def get_current_user_profile(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """Vérifie le token actif et renvoie les droits à jour de l'utilisateur"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Non authentifié.")
    token = authorization.split(" ", 1)[1].strip()
    decoded = decode_auth_token(token)
    if not decoded:
        raise HTTPException(status_code=401, detail="Session expirée ou invalide.")

    res = await db.execute(select(User).filter_by(id=decoded["uid"]))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable.")
    return {"user": serialize_user(user)}


@app.put("/api/auth/theme")
async def update_user_theme(
    payload: ThemeUpdateRequest,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """Sauvegarde le thème visuel choisi directement sur le compte de l'utilisateur en BDD"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Non authentifié.")
    token = authorization.split(" ", 1)[1].strip()
    decoded = decode_auth_token(token)
    if not decoded:
        raise HTTPException(status_code=401, detail="Session expirée ou invalide.")

    res = await db.execute(select(User).filter_by(id=decoded["uid"]))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    user.theme = payload.theme.strip().lower()
    await db.commit()
    await db.refresh(user)
    return {"status": "success", "user": serialize_user(user)}


@app.get("/api/users")
async def list_all_users(db: AsyncSession = Depends(get_db)):
    """Liste tous les comptes (Admin central + sous-comptes) et leurs droits"""
    res = await db.execute(select(User))
    users = res.scalars().all()
    return [serialize_user(u) for u in users]


@app.post("/api/users")
async def create_sub_user(payload: UserCreateUpdateRequest, db: AsyncSession = Depends(get_db)):
    """Crée un sous-compte ou un co-administrateur avec des permissions par serveur"""
    username = payload.username.strip()
    if not username or not payload.password:
        raise HTTPException(status_code=400, detail="Nom d'utilisateur et mot de passe requis.")

    res = await db.execute(select(User).filter_by(username=username))
    if res.scalars().first():
        raise HTTPException(status_code=400, detail="Ce nom d'utilisateur existe déjà.")

    new_user = User(
        username=username,
        password_hash=hash_password(payload.password),
        role=payload.role if payload.role in {"admin", "subuser"} else "subuser",
        permissions_json=json.dumps(payload.permissions or {}),
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return {"status": "success", "user": serialize_user(new_user)}


@app.put("/api/users/{user_id}")
async def update_sub_user(
    user_id: int,
    payload: UserCreateUpdateRequest,
    db: AsyncSession = Depends(get_db)
):
    """Met à jour les droits par serveur, le rôle ou le mot de passe d'un utilisateur"""
    res = await db.execute(select(User).filter_by(id=user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    user.username = payload.username.strip() or user.username
    user.role = payload.role if payload.role in {"admin", "subuser"} else user.role
    user.permissions_json = json.dumps(payload.permissions or {})
    if payload.password and payload.password.strip():
        user.password_hash = hash_password(payload.password.strip())

    await db.commit()
    await db.refresh(user)
    return {"status": "success", "user": serialize_user(user)}


@app.delete("/api/users/{user_id}")
async def delete_sub_user(user_id: int, db: AsyncSession = Depends(get_db)):
    """Supprime un sous-compte (protège contre la suppression du dernier Admin)"""
    res = await db.execute(select(User).filter_by(id=user_id))
    user = res.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")

    if user.role == "admin":
        res_admins = await db.execute(select(User).filter_by(role="admin"))
        if len(res_admins.scalars().all()) <= 1:
            raise HTTPException(status_code=400, detail="Impossible de supprimer le dernier compte Administrateur.")

    await db.delete(user)
    await db.commit()
    return {"status": "success", "message": f"Compte '{user.username}' supprimé."}


# ==============================================================================
# 2. BOUCLIER RÉSEAU (ANALYSE TRAFIC, HISTORIQUE IP & BLOCAGE D'ATTAQUES)
# ==============================================================================

# Regex pour extraire les connexions IP des logs Minecraft (Vanilla / Paper / Spigot / Forge)
# Ex: [14:22:01] [Server thread/INFO]: Pseudo[/192.168.1.25:54321] logged in with entity id...
# Ex: [14:23:10] [User Authenticator #1/INFO]: Disconnecting com.mojang.authlib.GameProfile...[name=Pseudo] (/192.168.1.25:54321): You are banned
LOG_IP_LOGIN_RE = re.compile(
    r"\[(\d{2}:\d{2}:\d{2})\].*?:\s+([a-zA-Z0-9_.-]+)\[/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\]\s+logged in",
    re.IGNORECASE,
)
LOG_IP_DISCONNECT_RE = re.compile(
    r"\[(\d{2}:\d{2}:\d{2})\].*?(?:name=([a-zA-Z0-9_.-]+).*?)?\(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)\):\s*(.*)",
    re.IGNORECASE,
)


class BlockIPRequest(BaseModel):
    ip_address: str
    reason: Optional[str] = "Bloquée par le Bouclier Réseau OurCraft"
    source_server: Optional[str] = "Global"


class LockdownRequest(BaseModel):
    enabled: bool


@app.get("/api/security/overview")
async def get_security_overview(db: AsyncSession = Depends(get_db)):
    """Analyse globale du trafic, historique des connexions IP et liste noire du Bouclier Réseau"""
    res_servers = await db.execute(select(MinecraftServer))
    servers = res_servers.scalars().all()

    res_blocked = await db.execute(select(BlockedIP))
    db_blocked = res_blocked.scalars().all()
    blocked_map = {
        b.ip_address: {
            "id": b.id,
            "ip_address": b.ip_address,
            "reason": b.reason,
            "source_server": b.source_server,
            "created_at": b.created_at,
        }
        for b in db_blocked
    }

    # 1. Analyser les logs de chaque serveur pour extraire l'historique IP et synchroniser banned-ips.json
    connection_history = []
    ip_counter: Dict[str, dict] = {}
    lockdown_servers = 0

    for srv in servers:
        # Vérifier si white-list=true sur ce serveur
        props_path = os.path.join(srv.path, "server.properties")
        if os.path.exists(props_path):
            try:
                with open(props_path, "r", encoding="utf-8", errors="replace") as pf:
                    if "white-list=true" in pf.read().lower():
                        lockdown_servers += 1
            except Exception:
                pass

        # Lire banned-ips.json
        banned_ips_file = os.path.join(srv.path, "banned-ips.json")
        if os.path.exists(banned_ips_file):
            try:
                with open(banned_ips_file, "r", encoding="utf-8") as bf:
                    for entry in json.load(bf):
                        ip_val = entry.get("ip")
                        if ip_val and ip_val not in blocked_map:
                            blocked_map[ip_val] = {
                                "id": 0,
                                "ip_address": ip_val,
                                "reason": entry.get("reason", "Bannie dans banned-ips.json"),
                                "source_server": srv.name,
                                "created_at": entry.get("created", ""),
                            }
            except Exception:
                pass

        # Parser logs/latest.log pour extraire les IPs de connexion
        log_file = os.path.join(srv.path, "logs", "latest.log")
        if os.path.exists(log_file):
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as lf:
                    lines = lf.readlines()[-400:]
                for line in lines:
                    m_login = LOG_IP_LOGIN_RE.search(line)
                    if m_login:
                        time_str, player, ip_addr, src_port = m_login.groups()
                        is_blocked = ip_addr in blocked_map
                        connection_history.append({
                            "time": time_str,
                            "server": srv.name,
                            "player": player,
                            "ip": ip_addr,
                            "port": int(src_port),
                            "status": "blocked" if is_blocked else "accepted",
                            "details": "Connexion authentifiée en jeu",
                        })
                        info = ip_counter.setdefault(ip_addr, {"ip": ip_addr, "count": 0, "players": set(), "servers": set(), "rejected": 0})
                        info["count"] += 1
                        info["players"].add(player)
                        info["servers"].add(srv.name)
                        continue

                    m_disc = LOG_IP_DISCONNECT_RE.search(line)
                    if m_disc:
                        time_str, player, ip_addr, src_port, reason = m_disc.groups()
                        connection_history.append({
                            "time": time_str,
                            "server": srv.name,
                            "player": player or "Inconnu",
                            "ip": ip_addr,
                            "port": int(src_port),
                            "status": "rejected",
                            "details": reason.strip()[:80],
                        })
                        info = ip_counter.setdefault(ip_addr, {"ip": ip_addr, "count": 0, "players": set(), "servers": set(), "rejected": 0})
                        info["count"] += 1
                        info["rejected"] += 1
                        if player:
                            info["players"].add(player)
                        info["servers"].add(srv.name)
            except Exception:
                pass

    connection_history.reverse()

    # Résumé par adresse IP pour détecter d'éventuelles attaques / floods
    ip_summary = []
    suspicious_count = 0
    for ip_addr, data in ip_counter.items():
        risk = "normal"
        if ip_addr in blocked_map:
            risk = "blocked"
        elif data["rejected"] >= 5 or data["count"] >= 20 or len(data["players"]) >= 4:
            risk = "critical"
            suspicious_count += 1
        elif data["rejected"] >= 2 or data["count"] >= 10:
            risk = "elevated"

        ip_summary.append({
            "ip": ip_addr,
            "total_connections": data["count"],
            "rejected_attempts": data["rejected"],
            "players": sorted(list(data["players"])),
            "servers": sorted(list(data["servers"])),
            "risk": risk,
            "is_blocked": ip_addr in blocked_map,
        })

    ip_summary.sort(key=lambda x: (x["rejected_attempts"], x["total_connections"]), reverse=True)

    return {
        "threat_level": "critical" if suspicious_count > 0 else "normal",
        "suspicious_ips_count": suspicious_count,
        "blocked_ips": list(blocked_map.values()),
        "ip_summary": ip_summary,
        "connection_history": connection_history[:100],
        "lockdown_active": len(servers) > 0 and lockdown_servers == len(servers),
        "total_servers": len(servers),
    }


@app.post("/api/security/block-ip")
async def block_ip_address(payload: BlockIPRequest, db: AsyncSession = Depends(get_db)):
    """Bloque une adresse IP globalement (BDD + banned-ips.json + ban-ip RCON sur tous les serveurs actifs)"""
    ip_addr = payload.ip_address.strip()
    if not ip_addr:
        raise HTTPException(status_code=400, detail="Adresse IP invalide.")

    reason = (payload.reason or "Bloquée par le Bouclier Réseau OurCraft").strip()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    res = await db.execute(select(BlockedIP).filter_by(ip_address=ip_addr))
    existing = res.scalars().first()
    if not existing:
        db.add(BlockedIP(
            ip_address=ip_addr,
            reason=reason,
            source_server=payload.source_server or "Global",
            created_at=now_str,
        ))
        await db.commit()

    # Appliquer dans banned-ips.json et via RCON sur tous les serveurs
    res_servers = await db.execute(select(MinecraftServer))
    servers = res_servers.scalars().all()
    client = docker.from_env()

    for srv in servers:
        banned_ips_file = os.path.join(srv.path, "banned-ips.json")
        entries = []
        if os.path.exists(banned_ips_file):
            try:
                with open(banned_ips_file, "r", encoding="utf-8") as bf:
                    entries = json.load(bf)
            except Exception:
                entries = []

        if not any(isinstance(e, dict) and e.get("ip") == ip_addr for e in entries):
            entries.append({
                "ip": ip_addr,
                "created": now_str,
                "source": "OurCraft Shield",
                "expires": "forever",
                "reason": reason,
            })
            try:
                with open(banned_ips_file, "w", encoding="utf-8") as bf:
                    json.dump(entries, bf, indent=2)
            except Exception:
                pass

        try:
            container = client.containers.get(f"ourcraft_{srv.name}")
            if container.status == "running":
                container.exec_run(f"rcon-cli ban-ip {ip_addr} {reason}")
        except Exception:
            pass

    return {"status": "success", "message": f"L'adresse IP {ip_addr} a été bloquée sur l'ensemble des serveurs."}


@app.delete("/api/security/block-ip/{ip_address}")
async def unblock_ip_address(ip_address: str, db: AsyncSession = Depends(get_db)):
    """Débloque une adresse IP (BDD + banned-ips.json + pardon-ip RCON)"""
    ip_addr = ip_address.strip()
    res = await db.execute(select(BlockedIP).filter_by(ip_address=ip_addr))
    existing = res.scalars().first()
    if existing:
        await db.delete(existing)
        await db.commit()

    res_servers = await db.execute(select(MinecraftServer))
    servers = res_servers.scalars().all()
    client = docker.from_env()

    for srv in servers:
        banned_ips_file = os.path.join(srv.path, "banned-ips.json")
        if os.path.exists(banned_ips_file):
            try:
                with open(banned_ips_file, "r", encoding="utf-8") as bf:
                    entries = json.load(bf)
                entries = [e for e in entries if isinstance(e, dict) and e.get("ip") != ip_addr]
                with open(banned_ips_file, "w", encoding="utf-8") as bf:
                    json.dump(entries, bf, indent=2)
            except Exception:
                pass

        try:
            container = client.containers.get(f"ourcraft_{srv.name}")
            if container.status == "running":
                container.exec_run(f"rcon-cli pardon-ip {ip_addr}")
        except Exception:
            pass

    return {"status": "success", "message": f"L'adresse IP {ip_addr} a été débloquée."}


@app.post("/api/security/lockdown")
async def toggle_global_lockdown(payload: LockdownRequest, db: AsyncSession = Depends(get_db)):
    """Active ou désactive le Mode Bouclier d'Urgence (Whitelist forcée sur tous les serveurs)"""
    res_servers = await db.execute(select(MinecraftServer))
    servers = res_servers.scalars().all()
    client = docker.from_env()

    val_str = "true" if payload.enabled else "false"
    rcon_cmd = "whitelist on" if payload.enabled else "whitelist off"

    for srv in servers:
        props_path = os.path.join(srv.path, "server.properties")
        try:
            update_properties_file(props_path, {"white-list": val_str})
        except Exception:
            pass

        try:
            container = client.containers.get(f"ourcraft_{srv.name}")
            if container.status == "running":
                container.exec_run(f"rcon-cli {rcon_cmd}")
        except Exception:
            pass

    return {
        "status": "success",
        "lockdown_active": payload.enabled,
        "message": (
            "🛡️ Mode Bouclier d'Urgence ACTIVÉ : Whitelist forcée sur tous les serveurs !"
            if payload.enabled
            else "Mode Bouclier d'Urgence désactivé."
        ),
    }


