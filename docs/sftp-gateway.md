# Passerelle SFTP Stand-ING

Cette passerelle tourne sur le VPS Hostinger et sert de pont entre le configurateur et le SFTP Stand-ING.

Flux prévu :

1. Le configurateur envoie un fichier lourd à l'API du VPS.
2. L'API vérifie un token secret.
3. Le VPS dépose le fichier sur `sftpstanding.synology.me:2200`.
4. Le SFTP n'a besoin d'autoriser que l'IP publique du VPS.

## IP à faire autoriser

- VPS Hostinger IPv4 : `72.61.164.168`
- VPS Hostinger IPv6 : `2a02:4780:28:9155::1`
- Poste Théo IPv4 : `109.222.92.14`
- Poste Théo IPv6 : `2a01:cb04:70e:6200:3ce0:a6db:5719:2473`

## Installation sur le VPS

```bash
apt update && apt upgrade -y
apt install -y curl git ufw nginx nodejs npm netcat-openbsd
node -v
```

Node doit être en version 20 ou plus. Si Ubuntu installe une version trop ancienne, installer Node 20 :

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Créer un utilisateur dédié :

```bash
adduser --system --group --home /opt/stand-ing standing
mkdir -p /opt/stand-ing
chown -R standing:standing /opt/stand-ing
```

Déployer le dossier :

```bash
cd /opt/stand-ing
git clone https://github.com/OrionStudioSAS/Stand-ing.git .
cd sftp-gateway
npm install --omit=dev
cp .env.example .env
nano .env
```

Variables importantes dans `.env` :

```bash
PORT=8787
PUBLIC_ALLOWED_ORIGINS=https://stand-ing.vercel.app
GATEWAY_API_TOKEN=un-long-token-secret
SFTP_HOST=sftpstanding.synology.me
SFTP_PORT=2200
SFTP_USERNAME=configurator_upload
SFTP_PASSWORD=mot-de-passe-sftp
SFTP_BASE_DIR=/
```

Ne jamais commiter le fichier `.env`.

## Démarrage systemd

```bash
cp /opt/stand-ing/sftp-gateway/stand-ing-sftp-gateway.service.example /etc/systemd/system/stand-ing-sftp-gateway.service
systemctl daemon-reload
systemctl enable stand-ing-sftp-gateway
systemctl start stand-ing-sftp-gateway
systemctl status stand-ing-sftp-gateway
```

Logs :

```bash
journalctl -u stand-ing-sftp-gateway -f
```

## Test local sur le VPS

Test API :

```bash
curl http://127.0.0.1:8787/health
```

Test connexion SFTP depuis l'API :

```bash
curl -H "Authorization: Bearer $GATEWAY_API_TOKEN" http://127.0.0.1:8787/sftp/health
```

Tant que l'IP n'est pas autorisée côté Stand-ING, ce test peut échouer avec `No route to host`, `timed out` ou `connection refused`.

Test upload :

```bash
printf 'test stand-ing' > /tmp/test-stand-ing.txt
curl -X POST http://127.0.0.1:8787/uploads/production-file \
  -H "Authorization: Bearer $GATEWAY_API_TOKEN" \
  -F "file=@/tmp/test-stand-ing.txt" \
  -F "salon=SMCL 2026" \
  -F "company=Orion Studio" \
  -F "standNumber=A-14" \
  -F "category=baches-cloisons"
```

## Nginx conseillé

Créer `/etc/nginx/sites-available/stand-ing-sftp-gateway` :

```nginx
server {
  listen 80;
  server_name fichiers.stand-ing.com;

  client_max_body_size 900M;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Puis :

```bash
ln -s /etc/nginx/sites-available/stand-ing-sftp-gateway /etc/nginx/sites-enabled/stand-ing-sftp-gateway
nginx -t
systemctl reload nginx
```

HTTPS avec Certbot quand le domaine pointe vers le VPS :

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d fichiers.stand-ing.com
```
