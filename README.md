# 🛠️ Guide des commandes Terminal pour KroustyControl (macOS)

Ce guide regroupe toutes les commandes terminal indispensables pour développer, tester et maintenir le projet **KroustyControl** sur macOS.

---

## 📋 Prérequis (Installation initiale)

Si vous n'avez pas encore configuré votre environnement de développement sur votre Mac :

### 1. Installer Node.js (via Homebrew - Recommandé)
Si vous utilisez [Homebrew](https://brew.sh/) :
```bash
brew install node
```
*Alternative via NVM (Node Version Manager) pour gérer plusieurs versions :*
```bash
# Installer NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Installer et utiliser la version LTS de Node
nvm install --lts
nvm use --lts
```

### 2. Vérifier les versions installées
```bash
node -v
npm -v
```

---

## 🚀 Commandes de développement quotidiennes

Ces commandes doivent être exécutées à la racine du projet (`/Users/mopiuy/Projets/KroustyControl`).

### 📥 1. Installer les dépendances du projet
À exécuter après avoir récupéré le projet ou après une mise à jour des packages :
```bash
npm install
```

### 💻 2. Lancer le serveur de développement
Démarre le serveur local de Vite avec rechargement à chaud (Hot Module Replacement) :
```bash
npm run dev
```
> **Astuce macOS** : Le projet sera généralement accessible sur [http://localhost:5173](http://localhost:5173). Vous pouvez maintenir la touche `Cmd ⌘` et cliquer sur le lien dans le terminal pour l'ouvrir directement.

### 🧹 3. Analyser le code (Linting)
Vérifie la qualité du code et détecte les erreurs potentielles avec ESLint :
```bash
npm run lint
```

---

## 📦 Production & Déploiement

### 🏗️ 1. Compiler le projet pour la production
Génère les fichiers optimisés et minifiés dans le dossier `dist/` :
```bash
npm run build
```

### 🔍 2. Tester le build de production localement
Lance un serveur local pour tester le rendu exact de la version de production compilée :
```bash
npm run preview
```

---

## 🛠️ Résolution des problèmes & Maintenance (macOS)

### 🔄 1. Nettoyer proprement et réinstaller les dépendances
En cas de bug étrange avec les packages ou de problème de build, cette commande supprime le dossier `node_modules` et le fichier de verrouillage puis réinstalle tout proprement :
```bash
rm -rf node_modules package-lock.json && npm install
```

### ⚡ 2. Forcer Vite à reconstruire le cache de dépendances
Si Vite ne prend pas en compte un changement dans un package externe ou si le cache est corrompu :
```bash
npm run dev -- --force
```

### 🔍 3. Trouver quel processus utilise le port 5173 (si déjà occupé)
Si le port par défaut de Vite est bloqué par une autre application :
```bash
lsof -i :5173
```
*Pour libérer/tuer le processus qui bloque ce port (remplacez `<PID>` par le numéro de process trouvé) :*
```bash
kill -9 <PID>
```

---

## 🌿 Raccourcis Git de base (Utile pour le projet)

### Statut et changements
```bash
git status
```

### Récupérer les dernières modifications
```bash
git pull origin main
```

### Sauvegarder son travail localement
```bash
git add .
git commit -m "Mon message de commit"
git push origin main
```
