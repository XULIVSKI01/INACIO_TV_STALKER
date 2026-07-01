// server.cjs 10 Junho streams estaveis ponto doce + Auto-Deteção Inteligente (BRAIN)

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");
const { PassThrough } = require('stream');
const addon = require("./addon.cjs");

const PORT = process.env.PORT || 7860;
const app = express();

app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// Limpeza periódica de promessas e caches antigas
setInterval(() => {
    const now = Date.now();
    if (global.pendingTvPromises) {
        Object.keys(global.pendingTvPromises).forEach(k => {
            if (global.pendingTvPromises[k] && now - global.pendingTvPromises[k].timestamp > 30000) {
                delete global.pendingTvPromises[k];
            }
        });
    }
    if (global.vodCache) {
        Object.keys(global.vodCache).forEach(k => {
            if (now - global.vodCache[k].timestamp > 30000) {
                delete global.vodCache[k];
            }
        });
    }
}, 30000);

// Página de Configuração (inalterada)
app.get("/", (req, res) => res.redirect("/configure"));
app.get("/configure", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html><head><title>𝕀ℕ𝔸́ℂ𝕀𝕆 𝕋𝕍 𝕏-𝕋𝔸𝕃𝕂𝔼ℝ</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: sans-serif; background: #0c0d19; color: white; padding: 20px; }
            .container { max-width: 500px; margin: auto; }
            .list-box { background: #1b1d30; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 5px solid #007bff; position: relative; }
            h3 { margin-top: 0; color: #007bff; font-size: 16px; }
            label { display: block; font-size: 11px; color: #888; margin-top: 8px; font-weight: bold; }
            input, select { width: 100%; padding: 10px; margin: 4px 0; border-radius: 6px; border: 1px solid #333; background: #222; color: white; box-sizing: border-box; }
            .remove-btn { position: absolute; top: 10px; right: 10px; color: #ff4444; cursor: pointer; font-size: 12px; font-weight: bold; }
            .add-btn { background: #28a745; color: white; border: none; padding: 12px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
            .install-btn { background: #007bff; color: white; border: none; padding: 18px; width: 100%; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 18px; }
            .advanced { display: none; background: #141526; padding: 10px; border-radius: 8px; margin-top: 10px; }
            .adv-toggle { color: #007bff; font-size: 12px; cursor: pointer; text-decoration: underline; margin-top: 5px; display: block; }
            .proxy-box { background: rgba(255, 165, 0, 0.1); border: 1px dashed #ffa500; padding: 10px; border-radius: 8px; margin-top: 10px; }
            .proxy-box label { color: #ffa500 !important; }
        </style></head>
        <body>
            <div class="container">
                <h2 style="text-align:center">𝕀ℕ𝔸́ℂ𝕀𝕆 𝕋𝕍 𝕏-𝕋𝔸𝕃𝕂𝔼ℝ</h2>
                <div id="lists-container"></div>
                <button class="add-btn" onclick="addList()">+ Adicionar Nova Lista (Máx 5)</button>
                <button class="install-btn" onclick="install()">🚀 INSTALAR NO STREMIO</button>
            </div>
            <script>
                let listCount = 0;
                function addList() {
                    if(listCount >= 5) return alert("Máximo de 5 listas atingido!");
                    listCount++;
                    const id = Date.now() + Math.floor(Math.random() * 1000);
                    const html = \`
                        <div class="list-box" id="box-\${id}">
                            <div class="remove-btn" onclick="removeList('\${id}')">REMOVER</div>
                            <h3>LISTA #\${listCount}</h3>
                            <label>TIPO DE LISTA</label>
                            <select class="type" onchange="toggleType(this, '\${id}')">
                                <option value="stalker">Stalker Portal (MAC)</option>
                                <option value="xtream">Xtream Codes (User/Pass)</option>
                            </select>
                            <label>NOME DA LISTA</label>
                            <input type="text" class="name" placeholder="Ex: IPTV Portugal">
                            <label>URL PORTAL / SERVIDOR</label>
                            <input type="text" class="url" placeholder="http://portal.com:8080/c/">
                            <div id="stalker-group-\${id}">
                                <label>MAC ADDRESS</label>
                                <input type="text" class="mac" placeholder="00:1A:79:XX:XX:XX">
                                <label>BOX MODEL</label>
                                <select class="model">
                                    <option value="MAG250">MAG 250</option>
                                    <option value="MAG254">MAG 254</option>
                                    <option value="MAG256">MAG 256</option>
                                    <option value="MAG322">MAG 322</option>
                                </select>
                                <span class="adv-toggle" onclick="toggleAdv('\${id}')">Configurações Avançadas</span>
                                <div class="advanced" id="adv-\${id}">
                                    <label>SERIAL NUMBER (SN)</label><input type="text" class="sn">
                                    <label>DEVICE ID 1</label><input type="text" class="id1">
                                    <label>DEVICE ID 2</label><input type="text" class="id2">
                                    <label>SIGNATURE</label><input type="text" class="sig">
                                </div>
                            </div>
                            <div id="xtream-group-\${id}" style="display:none;">
                                <label>USERNAME</label>
                                <input type="text" class="user" placeholder="O teu utilizador Xtream">
                                <label>PASSWORD</label>
                                <input type="text" class="pass" placeholder="A tua password Xtream">
                            </div>
                            <div class="proxy-box">
                                <label>🛡️ PROXY / VPN PARA DESBLOQUEIO (Opcional)</label>
                                <input type="text" class="proxy-url" placeholder="http://user:pass@ip:porta">
                                <div style="font-size: 10px; color: #aaa; margin-top: 4px;">Força a ligação por este IP. Útil para servidores teimosos.</div>
                            </div>
                        </div>\`;
                    document.getElementById('lists-container').insertAdjacentHTML('beforeend', html);
                }
                function removeList(id) { document.getElementById('box-'+id).remove(); }
                function toggleType(selectEl, id) {
                    if (selectEl.value === 'xtream') {
                        document.getElementById('stalker-group-'+id).style.display = 'none';
                        document.getElementById('xtream-group-'+id).style.display = 'block';
                    } else {
                        document.getElementById('stalker-group-'+id).style.display = 'block';
                        document.getElementById('xtream-group-'+id).style.display = 'none';
                    }
                }
                function toggleAdv(id) {
                    const el = document.getElementById('adv-'+id);
                    el.style.display = el.style.display === 'block' ? 'none' : 'block';
                }
                function install() {
                    const boxes = document.querySelectorAll('.list-box');
                    if(boxes.length === 0) return alert("Adiciona pelo menos uma lista!");
                    try {
                        const lists = Array.from(boxes).map(box => {
                            const type = box.querySelector('.type').value;
                            const getV = (sel) => box.querySelector(sel)?.value?.trim() || "";
                            return {
                                type: type,
                                name: getV('.name') || "IPTV",
                                url: getV('.url'),
                                mac: type === 'stalker' ? getV('.mac') : "",
                                model: type === 'stalker' ? getV('.model') : "MAG250",
                                sn: getV('.sn'),
                                id1: getV('.id1'),
                                id2: getV('.id2'),
                                sig: getV('.sig'),
                                user: type === 'xtream' ? getV('.user') : "",
                                pass: type === 'xtream' ? getV('.pass') : "",
                                proxy: getV('.proxy-url')
                            };
                        });
                        const config = { lists: lists };
                        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(config))));
                        window.location.href = "stremio://" + window.location.host + "/" + encodeURIComponent(b64) + "/manifest.json";
                    } catch (err) {
                        console.error("Erro na instalação:", err);
                        alert("Erro ao gerar configuração.");
                    }
                }
                window.onload = function() { addList(); };
            </script>
        </body></html>
    `);
});

// ROTAS DO STREMIO
app.get("/:config/manifest.json", async (req, res) => {
    res.json(await addon.getManifest(req.params.config));
});

app.get("/:config/catalog/:type/:id/:extra?.json", async (req, res) => {
    const { config, type, id, extra } = req.params;
    let extraObj = {};
    if (extra) {
        extra.replace(".json", "").split("&").forEach(p => {
            const [k, v] = p.split("=");
            if (k && v) extraObj[k] = decodeURIComponent(v);
        });
    }
    res.json(await addon.getCatalog(type, id, extraObj, config));
});

app.get("/:config/meta/:type/:id.json", async (req, res) => {
    res.json(await addon.getMeta(req.params.type, req.params.id, req.params.config));
});

app.get("/:config/stream/:type/:id.json", async (req, res) => {
    const host = req.headers.host;
    res.json(await addon.getStreams(req.params.type, req.params.id, req.params.config, host));
});

// Função auxiliar para reutilizar broadcaster ativo (evita múltiplos streams)
function connectToExistingBroadcaster(cached, res, streamKey, req) {
    if (cached.source && !cached.source.destroyed && cached.broadcaster) {
        console.log(`[PROXY TV] Reconexão rápida detetada. A ligar ao Broadcaster existente...`);
        if (cached.timeout) { clearTimeout(cached.timeout); cached.timeout = null; }

        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        cached.broadcaster.pipe(res);
        cached.clients.add(res);

        req.on('close', () => {
            cached.clients.delete(res);
            cached.broadcaster.unpipe(res);
            if (cached.clients.size === 0) {
                console.log(`[PROXY TV] Stremio pausou. A segurar a ligação por 15s...`);
                cached.timeout = setTimeout(() => {
                    if (cached.source && cached.source.destroy) cached.source.destroy();
                    if (cached.broadcaster) cached.broadcaster.destroy();
                    delete global.activeTvStreams[streamKey];
                    console.log(`[PROXY TV] Ligação libertada após 15s.`);
                }, 15000);
            }
        });
        return true;
    }
    return false;
}

// ROTA PRINCIPAL DO PROXY
app.get("/proxy/:config/:listIdx/:channelId", async (req, res) => {
    const { config, listIdx, channelId } = req.params;
    const type = req.query.type || 'tv';
    const lists = addon.parseConfig(config);
    const configData = lists[listIdx];
    if (!configData) return res.status(400).end();

    try {
        // ----- XTREAM (redirect) -----
        if (configData.type === 'xtream') {
            const baseUrl = configData.url.replace(/\/$/, "");
            const finalUrl = type === 'tv' ? `${baseUrl}/${configData.user}/${configData.pass}/${channelId}` :
                             type === 'movie' ? `${baseUrl}/movie/${configData.user}/${configData.pass}/${channelId}` :
                             `${baseUrl}/series/${configData.user}/${configData.pass}/${channelId}`;
            return res.redirect(302, finalUrl);
        }

        // ----- STALKER VOD -----
        if (type === 'movie' || type === 'series') {
            const vodKey = `${configData.url}_${channelId}_${type}`;

            if (!global.pendingVodPromises) global.pendingVodPromises = {};
            if (global.pendingVodPromises[vodKey]) {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000));
                try {
                    const pendingStream = await Promise.race([global.pendingVodPromises[vodKey], timeoutPromise]);
                    if (pendingStream && pendingStream.pipe) {
                        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
                        pendingStream.pipe(res);
                        return;
                    }
                } catch (e) {}
                delete global.pendingVodPromises[vodKey];
            }

            if (!global.vodCache) global.vodCache = {};
            let cleanUrl = null;
            if (global.vodCache[vodKey] && (Date.now() - global.vodCache[vodKey].timestamp < 5000)) {
                cleanUrl = global.vodCache[vodKey].url;
            }

            if (!cleanUrl) {
                const auth = await addon.authenticate(configData);
                if (!auth) return res.status(401).end();

                let stalkerCmd = decodeURIComponent(channelId);
                let seriesParam = '';
                if (type === 'series' && stalkerCmd.includes('|||')) {
                    const parts = stalkerCmd.split('|||');
                    stalkerCmd = parts[0];
                    const epNum = parts[1];
                    if (epNum) seriesParam = `&series=${epNum}`;
                }

                let possibleUrl = stalkerCmd.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
                let isLocalhost = possibleUrl.includes('localhost') || possibleUrl.includes('127.0.0.1');
                
                if ((possibleUrl.startsWith('http://') || possibleUrl.startsWith('https://')) && !isLocalhost) {
                    cleanUrl = possibleUrl;
                } else {
                    const linkUrl = `${auth.api}type=vod&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}${seriesParam}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                    const linkRes = await axios.get(linkUrl, addon.getAxiosOpts(configData, { headers: auth.authData.headers }));
                    let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
                    if (!streamUrl || typeof streamUrl !== 'string') return res.status(404).end();

                    cleanUrl = streamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
                    if (!cleanUrl.startsWith('http')) {
                        const basePortal = configData.url.split('/c/')[0];
                        cleanUrl = basePortal + (cleanUrl.startsWith('/') ? '' : '/') + cleanUrl;
                    }
                }
                global.vodCache[vodKey] = { url: cleanUrl, timestamp: Date.now() };
            }

            let resolveVod;
            const vodPromise = new Promise(resolve => { resolveVod = resolve; });
            global.pendingVodPromises[vodKey] = vodPromise;

            try {
                const auth = await addon.authenticate(configData);
                const streamHeaders = {
                    ...auth.authData.headers,
                    'Referer': configData.url.replace(/\/$/, "") + "/c/",
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                };

                const axiosOpts = addon.getAxiosOpts(configData, {
                    url: cleanUrl,
                    headers: streamHeaders,
                    responseType: 'stream',
                    maxRedirects: 0,
                    validateStatus: () => true
                });
                const streamRes = await axios(axiosOpts);

                if ([301, 302, 307, 308].includes(streamRes.status) && streamRes.headers.location) {
                    const finalUrl = streamRes.headers.location;
                    const finalRes = await axios(addon.getAxiosOpts(configData, {
                        url: finalUrl,
                        headers: streamHeaders,
                        responseType: 'stream'
                    }));
                    pipeVod(finalRes.data, finalRes.status, finalRes.headers, vodKey, resolveVod);
                } else {
                    pipeVod(streamRes.data, streamRes.status, streamRes.headers, vodKey, resolveVod);
                }
            } catch (e) {
                delete global.pendingVodPromises[vodKey];
                if (!res.headersSent) res.status(500).end();
            }

            function pipeVod(source, statusCode, headers, key, resolveFn) {
                if (statusCode >= 400) {
                    source.destroy();
                    delete global.pendingVodPromises[key];
                    return;
                }
                const pipeStream = new PassThrough();
                source.pipe(pipeStream);
                resolveFn(pipeStream);
                delete global.pendingVodPromises[key];

                res.writeHead(200, {
                    'Content-Type': headers['content-type'] || 'video/mp4',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
                pipeStream.pipe(res);
            }

            return;
        }

// ----- TV STALKER (COM ESCUDO DE RECONEXÃO AUTOMÁTICA E CÉREBRO DE DETEÇÃO) -----
const streamKey = `${configData.url}_${channelId}`;

if (!global.activeTvStreams) global.activeTvStreams = {};
if (!global.pendingTvPromises) global.pendingTvPromises = {};
if (!global.linkAttempts) global.linkAttempts = {};
if (!global.linkAttempts[streamKey]) global.linkAttempts[streamKey] = 0;
const MAX_LINK_ATTEMPTS = 2;

// Guarda o último URL que funcionou (para reconexão rápida sem falar com o portal)
if (!global.lastGoodUrl) global.lastGoodUrl = {};

// 1. Se já existe um broadcaster ativo, liga-se a ele
if (global.activeTvStreams[streamKey]) {
    if (connectToExistingBroadcaster(global.activeTvStreams[streamKey], res, streamKey, req)) return;
    else delete global.activeTvStreams[streamKey];
}

// 2. Se já há uma promessa a criar o stream, espera e depois reutiliza
if (global.pendingTvPromises[streamKey]) {
    const outcome = await global.pendingTvPromises[streamKey];
    if (outcome && outcome.type === 'redirect') {
        return res.redirect(302, outcome.url);
    }
    if (global.activeTvStreams[streamKey]) {
        return connectToExistingBroadcaster(global.activeTvStreams[streamKey], res, streamKey, req);
    }
}

// Bloqueio extra: se já tentámos demasiadas vezes, rejeita
if (global.linkAttempts[streamKey] >= MAX_LINK_ATTEMPTS) {
    console.log(`[PROXY TV] Número máximo de tentativas de link atingido para este canal.`);
    return res.status(502).json({ error: 'too_many_attempts' });
}

// 3. Cria uma nova promessa para evitar pedidos simultâneos
let resolveOutcome;
const outcomePromise = new Promise(resolve => { resolveOutcome = resolve; });
global.pendingTvPromises[streamKey] = outcomePromise;

// --- Variáveis partilhadas (auth e stalkerCmd) ---
let auth = null;
let stalkerCmd = decodeURIComponent(channelId);

// Determinar se o comando original já é um link direto (não precisa de create_link)
const possibleUrl = stalkerCmd.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
const isDirectLink = (possibleUrl.startsWith('http://') || possibleUrl.startsWith('https://')) &&
                     !possibleUrl.includes('localhost') && !possibleUrl.includes('127.0.0.1');

// Funções internas
let reconnectAttempts = 0;
const MAX_RECONNECT = 5; 

const sendError = (msg) => {
    if (!res.headersSent) {
        console.error(`[PROXY TV] ${msg}`);
        res.status(502).json({ error: 'stream_unavailable' });
    }
    delete global.pendingTvPromises[streamKey];
    setTimeout(() => { delete global.linkAttempts[streamKey]; }, 60000);
};

const execFfmpegLegacy = (urlToPlay, streamHeaders) => {
    return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const ffmpegHeaders = Object.entries(streamHeaders)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\r\n') + '\r\n';

        const ffmpeg = spawn('ffmpeg', [
            '-headers', ffmpegHeaders,
            '-re', // O Segredo do Ponto Doce para canais difíceis
            '-i', urlToPlay,
            '-c', 'copy',
            '-f', 'mpegts',
            '-loglevel', 'error',
            'pipe:1'
        ]);

        ffmpeg.stdout.on('data', (chunk) => {
            if (!res.headersSent) {
                res.writeHead(200, {
                    'Content-Type': 'video/mp2t',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache'
                });
            }
            res.write(chunk);
        });

        ffmpeg.on('close', (code) => {
            console.log(`[PROXY TV] Legacy FFmpeg terminou com código ${code}.`);
            resolve(code);
        });

        ffmpeg.on('error', (err) => {
            console.error(`[PROXY TV] Erro no FFmpeg legacy: ${err.message}`);
            reject(err);
        });

        req.on('close', () => {
            if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
        });
    });
};

const execStream = async (urlToPlay, isRetry = false) => {
    if (res.headersSent) return;

    if (!isRetry) {
        global.linkAttempts[streamKey]++;
    }

    // =================================================================
    // 🧠 LÓGICA DE AUTO-DETEÇÃO E DISTRIBUIÇÃO DE ROTAS (O CÉREBRO)
    // =================================================================
    const useFfmpeg = stalkerCmd.trim().toLowerCase().startsWith('ffmpeg');
    const isFfmpegLocal = useFfmpeg && (stalkerCmd.includes('localhost') || stalkerCmd.includes('127.0.0.1'));
    
    const urlLower = configData.url.toLowerCase();
    const isLegacyPortal = urlLower.includes('newpear') || urlLower.includes('repolho') || urlLower.includes('achoquesim') || urlLower.includes('bonky');

    // Decide se precisa do pipeline especial estrito
    const needsLegacy = isLegacyPortal;

    // Extração robusta de cookies (Corrige MAG_TOKEN_INVALID para qualquer cenário)
    const rawHeaders = auth.authData.headers || {};
    const cookieString = rawHeaders['Cookie'] || rawHeaders['cookie'] || "";

    // 🔴 ROTA A: PIPELINE LEGACY
    if (needsLegacy) {
        // Correção: usando apenas urlToPlay que é o argumento garantido da função
        console.log(`[PROXY TV] 🧠 Auto-Deteção: Pipeline LEGACY ativado para -> ${urlToPlay}`);
        try {
            const legacyHeaders = {
                ...rawHeaders,
                'Cookie': cookieString,
                'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
                'Referer': configData.url.replace(/\/$/, "") + "/c/",
                'Accept': '*/*',
                'Connection': 'keep-alive'
            };
            
            const code = await execFfmpegLegacy(urlToPlay, legacyHeaders);
            if (code !== 0 && !res.headersSent) {
                console.log(`[PROXY TV] Legacy FFmpeg falhou. A fazer redirect de segurança...`);
                res.setHeader('Accept-Ranges', 'none');
                res.setHeader('Connection', 'close');
                res.redirect(302, urlToPlay);
            }
            return;
        } catch (err) {
            console.error(`[PROXY TV] Erro no pipeline legacy: ${err.message}`);
            if (!res.headersSent) res.status(502).end();
            return;
        }
    }

    // 🟢 ROTA B: PIPELINE MODERNO (Multiplexador Broadcaster, auto-reconnect)
    console.log(`[PROXY TV] 🧠 Auto-Deteção: Pipeline MODERNO selecionado para -> ${urlToPlay}`);
    const doAxiosStream = async () => {
        const streamHeaders = {
            ...rawHeaders,
            'Cookie': cookieString,
            'Referer': configData.url.replace(/\/$/, "") + "/c/",
            'Accept': '*/*',
            'Connection': 'keep-alive'
        };
        const axiosOpts = addon.getAxiosOpts(configData, {
            url: urlToPlay,
            headers: streamHeaders,
            responseType: 'stream',
            decompress: false
        });
        const streamRes = await axios(axiosOpts);
        return streamRes.data;
    };

    const doFfmpegStream = () => {
        const ffmpegHeaders = Object.entries({
            ...rawHeaders,
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Unknown; Linux armv7l) AppleWebKit/537.1+ (KHTML, like Gecko) Safari/537.1+ Stalker portal (0.5.66/0.5.66/1.0)',
            'Referer': configData.url.replace(/\/$/, "") + "/c/",
            'Accept': '*/*',
            'Connection': 'keep-alive'
        }).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';

        const { spawn } = require('child_process');
        const ffmpeg = spawn('ffmpeg', [
            '-headers', ffmpegHeaders,
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-fflags', 'nobuffer+discardcorrupt+genpts',
            '-err_detect', 'ignore_err',
            '-i', urlToPlay,
            '-c', 'copy',
            '-f', 'mpegts',
            '-loglevel', 'error',
            'pipe:1'
        ]);

        const source = ffmpeg.stdout;
        source.killProcess = () => { if (!ffmpeg.killed) ffmpeg.kill('SIGKILL'); };
        ffmpeg.on('error', () => { if (!source.destroyed) source.destroy(); });
        return source;
    };

    try {
        let source;
        if (useFfmpeg) {
            source = doFfmpegStream();
        } else {
            source = await doAxiosStream();
        }

        // Guardar o URL que funcionou
        global.lastGoodUrl[streamKey] = urlToPlay;

        let broadcaster;
        if (global.activeTvStreams[streamKey] && global.activeTvStreams[streamKey].broadcaster) {
            broadcaster = global.activeTvStreams[streamKey].broadcaster;
            if (global.activeTvStreams[streamKey].source.unpipe) {
                global.activeTvStreams[streamKey].source.unpipe();
            }
        } else {
            broadcaster = new PassThrough({ highWaterMark: 1024 * 1024 * 5 });
        }

        source.pipe(broadcaster, { end: false });

        global.activeTvStreams[streamKey] = {
            source: source,
            broadcaster: broadcaster,
            clients: new Set([res]),
            timeout: null
        };

        if (!res.headersSent) {
            res.writeHead(200, {
                'Content-Type': 'video/mp2t',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            broadcaster.pipe(res);
        }

        resolveOutcome({ type: 'stream' });
        delete global.pendingTvPromises[streamKey];
        reconnectAttempts = 0;
        global.linkAttempts[streamKey] = 0;

        source.on('end', async () => {
            console.log(`[PROXY TV] Stream terminou. Tentando reconectar automaticamente...`);
            await attemptReconnect();
        });
        source.on('error', async (err) => {
            console.log(`[PROXY TV] Erro na stream: ${err.message}. Tentando reconectar...`);
            await attemptReconnect();
        });

        req.on('close', () => {
            const cached = global.activeTvStreams[streamKey];
            if (cached) {
                cached.clients.delete(res);
                cached.broadcaster.unpipe(res);
                if (cached.clients.size === 0) {
                    console.log(`[PROXY TV] Stremio pausou. A manter ligação ativa por 10 minutos...`);
                    if (cached.timeout) clearTimeout(cached.timeout);
                    cached.timeout = setTimeout(() => {
                        if (cached.clients && cached.clients.size === 0) {
                            console.log(`[PROXY TV] Ligação libertada após 10 min de inatividade.`);
                            if (cached.source && cached.source.destroy) cached.source.destroy();
                            if (cached.broadcaster) cached.broadcaster.destroy();
                            delete global.activeTvStreams[streamKey];
                        }
                    }, 10 * 60 * 1000); // 10 minutos
                }
            }
        });

    } catch (e) {
        console.error(`[PROXY TV] Erro na ligação: ${e.message}`);
        if (!isRetry) {
            console.log(`[PROXY TV] A tentar renovar token e extrair novo link...`);
            try {
                const newAuth = await addon.authenticate(configData);
                if (newAuth) {
                    auth = newAuth;
                    if (isDirectLink) {
                        const lastUrl = global.lastGoodUrl[streamKey] || possibleUrl;
                        return execStream(lastUrl, true);
                    } else {
                        const newLinkUrl = `${newAuth.api}type=itv&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${newAuth.authData.sn}&token=${newAuth.token}&JsHttpRequest=1-0`;
                        const newLinkRes = await axios.get(newLinkUrl, addon.getAxiosOpts(configData, { headers: newAuth.authData.headers }));
                        let newStreamUrl = newLinkRes.data?.js?.cmd || newLinkRes.data?.js || newLinkRes.data?.cmd;
                        if (newStreamUrl) {
                            let cUrl = newStreamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
                            if (!cUrl.startsWith('http')) {
                                const basePortal = configData.url.split('/c/')[0];
                                cUrl = basePortal + (cUrl.startsWith('/') ? '' : '/') + cUrl;
                            }
                            return execStream(cUrl, true);
                        }
                    }
                }
            } catch(err) {}
        }
        sendError('Stream indisponível após várias tentativas');
    }
};

async function attemptReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT) {
        console.log(`[PROXY TV] Máximo de tentativas de reconexão atingido. A desistir.`);
        if (global.activeTvStreams[streamKey]) {
            global.activeTvStreams[streamKey].broadcaster.end();
            delete global.activeTvStreams[streamKey];
        }
        sendError('Falha na reconexão automática');
        return;
    }
    reconnectAttempts++;
    console.log(`[PROXY TV] Tentativa de reconexão ${reconnectAttempts}/${MAX_RECONNECT}...`);

    try {
        if (isDirectLink) {
            const lastUrl = global.lastGoodUrl[streamKey] || possibleUrl;
            console.log(`[PROXY TV] A reutilizar link direto (tentativa ${reconnectAttempts})...`);
            const delay = Math.min(1000 * reconnectAttempts, 4000); 
            await new Promise(resolve => setTimeout(resolve, delay));
            return execStream(lastUrl, true);
        }

        const newAuth = await addon.authenticate(configData);
        if (!newAuth) throw new Error('Falha na autenticação');
        auth = newAuth;

        const linkUrl = `${newAuth.api}type=itv&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${newAuth.authData.sn}&token=${newAuth.token}&JsHttpRequest=1-0`;
        const linkRes = await axios.get(linkUrl, addon.getAxiosOpts(configData, { headers: newAuth.authData.headers }));
        let newStreamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
        if (!newStreamUrl) throw new Error('Link não obtido');

        let cUrl = newStreamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
        if (!cUrl.startsWith('http')) {
            const basePortal = configData.url.split('/c/')[0];
            cUrl = basePortal + (cUrl.startsWith('/') ? '' : '/') + cUrl;
        }

        await execStream(cUrl, true);
    } catch (err) {
        console.log(`[PROXY TV] Reconexão falhou: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await attemptReconnect();
    }
}

// Início da lógica de obtenção do primeiro link
try {
    auth = await addon.authenticate(configData);
    if (!auth) {
        delete global.pendingTvPromises[streamKey];
        return res.status(401).end();
    }

    let cleanUrl = null;

    if (isDirectLink) {
        console.log(`[PROXY TV] Link directo detetado: ${possibleUrl.substring(0, 50)}...`);
        cleanUrl = possibleUrl;
    } else {
        const linkUrl = `${auth.api}type=itv&action=create_link&cmd=${encodeURIComponent(stalkerCmd)}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
        const linkRes = await axios.get(linkUrl, addon.getAxiosOpts(configData, { headers: auth.authData.headers }));
        let streamUrl = linkRes.data?.js?.cmd || linkRes.data?.js || linkRes.data?.cmd;
        if (!streamUrl || typeof streamUrl !== 'string') {
            delete global.pendingTvPromises[streamKey];
            return res.status(404).end();
        }

        cleanUrl = streamUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "").trim();
        if (!cleanUrl.startsWith('http')) {
            const basePortal = configData.url.split('/c/')[0];
            cleanUrl = basePortal + (cleanUrl.startsWith('/') ? '' : '/') + cleanUrl;
        }
    }
    
    console.log(`[PROXY TV] Link obtido do portal: ${cleanUrl}`);
    execStream(cleanUrl);

} catch (e) {
    console.error("[PROXY] Erro interno no pipe TV:", e.message);
    delete global.pendingTvPromises[streamKey];
    if (!res.headersSent) res.status(500).end();
}

    } catch (e) {
        console.error("[PROXY] Erro geral do router:", e.message);
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Addon Online na porta ${PORT}`));
