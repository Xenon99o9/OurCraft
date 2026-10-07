# On utilise une image Python officielle légère (Debian slim est mieux qu'Alpine pour Python niveau compatibilité)
FROM python:3.11-slim

# On empêche Python de créer des fichiers .pyc et on force l'affichage direct des logs
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# On installe un outil pour compiler certaines librairies si besoin, et le client SSH
RUN apt-get update && apt-get install -y openssh-client gcc && rm -rf /var/lib/apt/lists/*

# Copie le fichier requirements et l'installe
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Commande pour lancer le serveur de développement avec Hot Reload
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]