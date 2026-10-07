from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base

class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    ip_address: Mapped[str] = mapped_column(String(50))
    ssh_port: Mapped[int] = mapped_column(default=22)
    ssh_username: Mapped[str] = mapped_column(String(50))

    # Relation : Un noeud peut héberger plusieurs serveurs
    servers = relationship("MinecraftServer", back_populates="node")

class MinecraftServer(Base):
    __tablename__ = "minecraft_servers"

    id: Mapped[int] = mapped_column(primary_key=True)
    node_id: Mapped[int] = mapped_column(ForeignKey("nodes.id"))
    name: Mapped[str] = mapped_column(String(100))
    path: Mapped[str] = mapped_column(String(255)) # ex: /home/pi/minecraft/survie
    server_port: Mapped[int] = mapped_column(default=25565)

    # Relation inverse
    node = relationship("Node", back_populates="servers")

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))