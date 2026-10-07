import os
import docker
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Imports Base de données
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from database.database import AsyncSessionLocal
from database.models import MinecraftServer, Node

app = FastAPI(title="OurCraft API")

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
    async with AsyncSessionLocal() as session:
        yield session

# --- MODÈLES DE DONNÉES (Pour recevoir les JSON du Front-end) ---
class ScanRequest(BaseModel):
    base_path: str

class ServerLaunchConfig(BaseModel):
    name: str
    host_path: str  
    port: int = 25565

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
    # 1. On lit les serveurs dans PostgreSQL
    result = await db.execute(select(MinecraftServer))
    db_servers = result.scalars().all()
    
    # 2. On interroge Docker pour connaître leur état en direct
    client = docker.from_env()
    containers = {c.name: c for c in client.containers.list(all=True)}
    
    server_list = []
    for s in db_servers:
        container_name = f"ourcraft_{s.name}" # Le préfixe de nos serveurs
        c = containers.get(container_name)
        
        server_list.append({
            "id": str(s.id),
            "name": s.name,
            "status": c.status if c else "offline", # S'il n'y a pas de conteneur, il est hors ligne
            "image": "itzg/minecraft-server",
            "path": s.path,
            "port": s.server_port
        })
        
    return server_list

@app.post("/api/servers/scan")
async def scan_directories(request: ScanRequest, db: AsyncSession = Depends(get_db)):
    """Scanne un dossier pour trouver de nouveaux serveurs et les ajoute à la BDD"""
    base_path = request.base_path
    
    if not os.path.exists(base_path) or not os.path.isdir(base_path):
        raise HTTPException(status_code=400, detail=f"Dossier introuvable : {base_path}")

    # Sécurité : Créer le Node local s'il n'existe pas
    result = await db.execute(select(Node).filter_by(id=1))
    node = result.scalars().first()
    if not node:
        node = Node(id=1, name="Machine Locale", ip_address="127.0.0.1", ssh_username="local")
        db.add(node)
        await db.commit()

    found_servers = []
    for folder_name in os.listdir(base_path):
        folder_path = os.path.join(base_path, folder_name)
        
        if os.path.isdir(folder_path):
            res = await db.execute(select(MinecraftServer).filter_by(path=folder_path))
            existing_server = res.scalars().first()
            
            if not existing_server:
                new_server = MinecraftServer(
                    node_id=1,
                    name=folder_name,
                    path=folder_path,
                    server_port=25565
                )
                db.add(new_server)
                found_servers.append(folder_name)

    await db.commit()
    return {"message": f"Scan terminé.", "nouveaux_serveurs_ajoutes": len(found_servers), "liste": found_servers}

@app.post("/api/servers/launch")
async def launch_minecraft_server(config: ServerLaunchConfig):
    """Crée le conteneur s'il n'existe pas, ou le redémarre s'il est arrêté"""
    try:
        client = docker.from_env()
        container_name = f"ourcraft_{config.name}"
        
        # 1. On essaie de trouver le conteneur s'il existe déjà
        try:
            container = client.containers.get(container_name)
            container.start() # On l'allume simplement
            return {"status": "success", "message": f"Serveur '{config.name}' redémarré avec succès !"}
            
        except docker.errors.NotFound:
            # 2. S'il n'existe pas, on le crée (c'est ici que le dossier vide va se remplir)
            container = client.containers.run(
                image="itzg/minecraft-server:latest",
                name=container_name,
                environment={
                    "EULA": "TRUE",
                    "TYPE": "PAPER",
                    "VERSION": "LATEST"
                },
                ports={f"{config.port}/tcp": config.port},
                volumes={
                    config.host_path: {'bind': '/data', 'mode': 'rw'}
                },
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
        
        # On demande à Docker d'arrêter le conteneur (avec 10s pour sauvegarder)
        container.stop(timeout=10)
        return {"status": "success", "message": f"Serveur '{server_name}' arrêté."}
    except docker.errors.NotFound:
        raise HTTPException(status_code=404, detail="Le conteneur n'est pas en cours d'exécution.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))