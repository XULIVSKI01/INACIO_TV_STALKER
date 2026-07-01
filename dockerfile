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

# Regista e liga o WARP em modo proxy (proxy HTTP em 127.0.0.1:40000)
RUN warp-cli register && \
    warp-cli set-mode proxy && \
    warp-cli connect && \
    sleep 5

EXPOSE 7860

# Comando de arranque: mantém o WARP ligado e inicia o addon
CMD sh -c "warp-cli connect && sleep 5 && node server.cjs"