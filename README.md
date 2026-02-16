# Application IPTV — Abonnement FCFA

Application IPTV déployable en ligne : abonnement annuel en FCFA (25 000 FCFA/an), paiement Mobile Money (Orange, MTN, Wave, etc.) via Fedapay, proxy masquant l’URL du serveur source.

## Structure du projet

```
extension/
├── backend/          # API Node.js (auth, abonnements, paiements Fedapay)
├── proxy-server/     # Proxy M3U + flux (masquage URL source)
├── frontend/        # React (Vite) — landing, auth, dashboard, lecteur
└── README.md
```

## Prérequis

- Node.js 18+
- PostgreSQL (pour le backend)
- Compte Fedapay (sandbox ou production) pour les paiements

## Test en local (tout sur la machine)

1. **Backend** : dans `backend/.env`, mettre `APP_URL=http://localhost:4000`, `FRONTEND_URL=http://localhost:5173`, `PROXY_URL=http://localhost:3001`.
2. **Proxy** : dans `proxy-server/.env`, mettre `PROXY_URL=http://localhost:3001`, et soit **Xtream** (`XTREAM_BASE_URL`, `XTREAM_USERNAME`, `XTREAM_PASSWORD`), soit un fichier M3U (`ORIGINAL_PLAYLIST_FILE=./xtream_playlist.m3u`) ou une URL.
3. Lancer dans l’ordre : `backend` (port 4000) → `proxy-server` (port 3001) → `frontend` (port 5173). Ouvrir http://localhost:5173.

## Installation et lancement

### 1. Backend

```bash
cd backend
cp .env.example .env
# Remplir DATABASE_URL, JWT_SECRET, FEDAPAY_SECRET_KEY, APP_URL, FRONTEND_URL, PROXY_URL
npm install
npx prisma generate
npx prisma db push
npm run dev
```

Le backend écoute sur le port **4000** par défaut.

### 2. Proxy

```bash
cd proxy-server
cp .env.example .env
# Définir la source des chaînes : ORIGINAL_PLAYLIST_FILE (fichier local, ex: xtream_playlist.m3u)
#   ou ORIGINAL_PLAYLIST_URL. PROXY_URL, ENCRYPTION_KEY, JWT_SECRET (identique au backend)
npm install
npm run dev
```

Le proxy écoute sur le port **3001** par défaut. **Seul le proxy se connecte à la source** (fichier ou URL) ; les utilisateurs ne voient que les flux masqués.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Le frontend tourne sur **http://localhost:5173**. Le proxy Vite redirige `/api` vers le backend (port 4000).

## Variables d’environnement importantes

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | URL PostgreSQL |
| `JWT_SECRET` | Secret JWT (partagé avec le proxy) |
| `APP_URL` | URL publique de l’API (pour callbacks Fedapay) |
| `FRONTEND_URL` | URL du frontend |
| `PROXY_URL` | URL du proxy (ex. http://localhost:3001) |
| `FEDAPAY_SECRET_KEY` | Clé secrète Fedapay (optionnel en dev : mock paiement) |

### Proxy (`proxy-server/.env`)

| Variable | Description |
|----------|-------------|
| **Xtream (prioritaire)** | |
| `XTREAM_BASE_URL` | URL du serveur Xtream (ex: `http://server:8080`) |
| `XTREAM_USERNAME` | Identifiant Xtream |
| `XTREAM_PASSWORD` | Mot de passe Xtream |
| **Ou M3U** | |
| `ORIGINAL_PLAYLIST_FILE` | Fichier M3U local (ex: `./xtream_playlist.m3u`) |
| `ORIGINAL_PLAYLIST_URL` | Ou URL M3U du provider |
| **Commun** | |
| `PROXY_URL` | URL du proxy (en local : `http://localhost:3001`) |
| `CORS_ORIGIN` | En local : `http://localhost:5173` |
| `ENCRYPTION_KEY` | Clé AES (min. 32 caractères) |
| `JWT_SECRET` | Même valeur que le backend |

### Frontend

- `VITE_API_URL` : en dev avec proxy Vite, utiliser `/api` ou laisser vide pour le défaut.

## Flux utilisateur

1. **Inscription / Connexion** : email (ou téléphone) + mot de passe.
2. **Abonnement** : choix du plan (annuel 25 000 FCFA), redirection vers Fedapay (Orange Money, MTN, Wave, etc.).
3. **Callback** : Fedapay appelle `POST /api/payment/callback` → activation de l’abonnement.
4. **Dashboard** : liste des chaînes (méta + URLs de stream masquées), lien de téléchargement de la playlist M3U.
5. **Lecteur** : lecture HLS dans le navigateur ou utilisation de la playlist dans VLC (URL avec token).

## Sécurité — qui se connecte à la source ?

- **Seul le proxy** lit la playlist et les flux (fichier `xtream_playlist.m3u` ou URL du provider). Le backend et le frontend ne connaissent jamais cette source.
- Les utilisateurs reçoivent uniquement une playlist masquée (URLs chiffrées pointant vers le proxy). Toutes les requêtes passent par le proxy.
- Les URLs de flux sont chiffrées (AES) ; le proxy déchiffre et relaie sans exposer l’origine.
- JWT partagé entre backend et proxy pour authentifier les requêtes playlist / stream.

Pour ne pas versionner le fichier de chaînes, ajoutez `xtream_playlist.m3u` (et/ou le chemin utilisé dans `ORIGINAL_PLAYLIST_FILE`) au `.gitignore`, et déposez le fichier uniquement sur le serveur proxy.

## Déploiement (résumé)

- **Frontend** : Vercel ou Netlify (build `npm run build`, dossier `dist`).
- **Backend** : Railway, Render, etc. + PostgreSQL.
- **Proxy** : VPS dédié (Contabo, Hetzner, OVH) avec Node + PM2 + Nginx + SSL (Let’s Encrypt).

### Frontend Vercel (production)

1. Dans Vercel, définir le **Root Directory** à `frontend`.
2. Variables d'environnement Vercel (Production + Preview):
   - `VITE_API_URL=https://api.votre-domaine.com/api`
3. Build command: `npm run build`
4. Output directory: `dist`

Le fichier `frontend/vercel.json` gère le fallback SPA (React Router) vers `index.html`.

Coûts indicatifs : ~5 000–10 000 FCFA/mois d’hébergement ; rentabilité à partir d’environ 5 abonnés (25 000 FCFA/an chacun).
