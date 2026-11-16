# Image Python officielle légère compatible x86_64 et ARM64 (Raspberry Pi)
FROM python:3.11-slim

# On empêche Python de créer des fichiers .pyc et on force l'affichage direct des logs
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Copie le fichier requirements et installe les roues pré-compilées (aucun besoin de gcc/apt)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Commande pour lancer le serveur FastAPI avec Hot Reload
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
