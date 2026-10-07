import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncAttrs
from sqlalchemy.orm import DeclarativeBase

# On récupère l'URL fournie par Docker et on ajoute le driver asynchrone "asyncpg"
DATABASE_URL = os.getenv("DATABASE_URL", "").replace("postgresql://", "postgresql+asyncpg://")

# Création du moteur asynchrone (echo=True permet de voir les requêtes SQL dans la console pour le dev)
engine = create_async_engine(DATABASE_URL, echo=True)

# L'usine à sessions pour interagir avec la BDD
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# Classe de base pour nos modèles
class Base(AsyncAttrs, DeclarativeBase):
    pass