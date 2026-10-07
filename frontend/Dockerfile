FROM node:20-alpine

WORKDIR /app

# On copie d'abord uniquement les fichiers listant les dépendances
COPY package.json package-lock.json* ./

# On installe les dépendances À L'INTÉRIEUR du conteneur
RUN npm install

# La commande de démarrage
CMD ["npm", "run", "dev", "--", "--host"]