FROM node:18-slim

# Instala dependências e o WARP
RUN apt-get update && apt-get install -y curl gnupg2 lsb-release && \
    curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/cloudflare-client.list && \
    apt-get update && apt-get install -y cloudflare-warp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia os ficheiros do addon
COPY package*.json ./
RUN npm install
COPY . .

# Inicia o WARP em modo proxy e depois o addon
CMD sh -c "warp-svc & \
           sleep 2 && \
           export WARP_ACCEPT_TOS=yes && \
           warp-cli mode proxy && \
           warp-cli connect && \
           sleep 5 && \
           echo '=== WARP STATUS ===' && \
           warp-cli status && \
           echo '=== WARP IP ===' && \
           curl --proxy http://127.0.0.1:40000 http://ifconfig.me && \
           node server.cjs"