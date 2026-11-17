from sqlalchemy import String, Integer, Boolean, Text, ForeignKey
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
    ram: Mapped[str] = mapped_column(String(20), default="2G")
    server_type: Mapped[str] = mapped_column(String(50), default="PAPER")
    version: Mapped[str] = mapped_column(String(50), default="LATEST")
    auto_stop_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_stop_minutes: Mapped[int] = mapped_column(Integer, default=30)
    max_backups: Mapped[int] = mapped_column(Integer, default=5)

    # Relation inverse
    node = relationship("Node", back_populates="servers")

class ScheduledTask(Base):
    __tablename__ = "scheduled_tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    server_name: Mapped[str] = mapped_column(String(100), index=True)
    name: Mapped[str] = mapped_column(String(100))           # ex: "Reboot 04h00"
    action_type: Mapped[str] = mapped_column(String(50))     # "restart", "backup", "command", "stop", "start"
    schedule_type: Mapped[str] = mapped_column(String(30))   # "daily" (HH:MM) ou "interval" (minutes)
    schedule_value: Mapped[str] = mapped_column(String(50))  # ex: "04:00" ou "60"
    payload: Mapped[str] = mapped_column(String(255), default="") # Message d'annonce ou commande RCON
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run: Mapped[str] = mapped_column(String(50), default="")

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(30), default="admin") # "admin" ou "subuser"
    permissions_json: Mapped[str] = mapped_column(Text, default="{}") # JSON des droits par serveur
    theme: Mapped[str] = mapped_column(String(30), default="discord") # Thème sauvegardé par compte

class BlockedIP(Base):
    __tablename__ = "blocked_ips"

    id: Mapped[int] = mapped_column(primary_key=True)
    ip_address: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    reason: Mapped[str] = mapped_column(String(255), default="Bloquée par le Bouclier Réseau OurCraft")
    source_server: Mapped[str] = mapped_column(String(100), default="Global")
    created_at: Mapped[str] = mapped_column(String(50), default="")
