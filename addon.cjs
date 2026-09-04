const axios = require("axios");
const crypto = require("crypto");
const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');

const authCache = new Map();
const catalogCache = {};
const CACHE_TTL = 1000 * 60 * 60 * 4; // 4 horas para catálogos

const TMDB_API_KEY = "04057ce87e56ea3234aff745ce9090ea";

// Cache em memória simples
const memCache = {};
function getCache(key) {
    const cached = memCache[key];
    return (cached && cached.expire > Date.now()) ? cached.data : null;
}
function setCache(key, data, ttlMinutes = 30) {
    memCache[key] = { data, expire: Date.now() + (ttlMinutes * 60 * 1000) };
}

function cleanTitle(title) {
    return title.replace(/\[.*?\]/g, '').replace(/\(.*\)/g, '').replace(/(S\d+|T\d+).*/i, '').replace(/(1080p|720p|4k|uhd|hdtv|x264|x265|hevc|dual|latino|legendado|multi|v1|v2)/gi, '').trim();
}

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
        let opts = { ...extraOpts };
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        opts.httpsAgent = httpsAgent;
        if (config && config.proxy) {
            const proxyStr = config.proxy.trim();
            if (proxyStr.startsWith('socks')) {
                const agent = new SocksProxyAgent(proxyStr);
                agent.options.rejectUnauthorized = false;
                opts.httpAgent = agent;
                opts.httpsAgent = agent;
            } else if (proxyStr.startsWith('http')) {
                try {
                    const p = new URL(proxyStr);
                    opts.proxy = {
                        protocol: p.protocol.replace(':', ''),
                        host: p.hostname,
                        port: parseInt(p.port),
                        auth: p.username ? { username: decodeURIComponent(p.username), password: decodeURIComponent(p.password) } : undefined
                    };
                } catch(e) {}
            }
        }
        return opts;
    },

    parseConfig(configBase64) {
        try {
            const decoded = Buffer.from(decodeURIComponent(configBase64), 'base64').toString('utf8');
            const data = JSON.parse(decoded);
            let lists = data.lists || [];
            lists = lists.map(list => {
                if (list.url) {
                    list.url = list.url.trim().replace(/\/+$/, "");
                    list.url = list.url.replace(/\/c\/?$/, "");
                    if (list.mac || list.type === 'stalker') {
                        list.url = list.url.replace(/\/(stalker_portal\/c|stalker_portal)$/i, "");
                    }
                }
                return list;
            });
            return lists;
        } catch (e) {
            console.error("[CONFIG ERROR]", e.message);
            return [];
        }
    },

    async authenticate(config) {
        const mac = (config.mac || "00:1A:79:00:00:00").toUpperCase();
        const cleanBase = config.url.trim().replace(/\/$/, "");
        const cacheKey = `auth_${cleanBase}_${mac}`;
        if (authCache.has(cacheKey)) {
            const cached = authCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 10 * 60 * 1000) return cached.data;
        }

        const fakeResidencialIP = '188.81.121.45';
        const deviceId = crypto.createHash('md5').update(mac).digest('hex').toUpperCase();
        const shortHash = crypto.createHash('md5').update(mac).digest('hex').substring(0, 13).toUpperCase();
        const serialNumber = `8CA3${shortHash.substring(4)}`;

        const universalHeaders = {
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
            'X-User-Agent': `Model: MAG250; SW: 2.18-r14-pub-250; STB_active: true; Device ID: ${deviceId}; Device ID 2: ${deviceId}; Signature: 88e76854; SN: ${serialNumber}`,
            'Referer': `${cleanBase}/c/`,
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Runtime-Info': 'render: gles; s_type: 250; s_ver: 0.2.18-r14;',
            'X-Requested-With': 'XMLHttpRequest',
            'X-Forwarded-For': fakeResidencialIP,
            'X-Real-IP': fakeResidencialIP,
            'Client-IP': fakeResidencialIP,
            'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`
        };

        const paths = ['/c/portal.php', '/portal.php', '/server/load.php', '/stalker_portal/server/load.php'];

        console.log(`[STB-EMU MODE] Tentando enganar portal: ${cleanBase}`);

        for (const path of paths) {
            const fullUrl = `${cleanBase}${path}?`;
            try {
                const handshakeUrl = `${fullUrl}type=stb&action=handshake&mac=${encodeURIComponent(mac)}&JsHttpRequest=1-0`;
                const res = await axios.get(handshakeUrl, this.getAxiosOpts(config, { headers: universalHeaders, timeout: 5000 }));
                let data = res.data;
                if (typeof data === 'string') data = JSON.parse(data.replace(/\/\*[\s\S]*?\*\//g, "").trim());
                if (data?.js?.token) {
                    const token = data.js.token;
                    console.log(`[AUTH SUCCESS] Servidor enganado em: ${path}`);
                    universalHeaders.Authorization = `Bearer ${token}`;
                    universalHeaders.Cookie += ` token=${token}; access_token=${token};`;
                    try { await axios.get(`${fullUrl}type=stb&action=get_profile&token=${token}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: universalHeaders })); } catch (e) { }
                    const result = {
                        api: fullUrl,
                        apiAlt: fullUrl.replace(/\/[^\/]+$/, '/server/load.php?'),
                        token,
                        authData: { sn: data.js.sn || deviceId.substring(0, 13), headers: universalHeaders }
                    };
                    authCache.set(cacheKey, { data: result, timestamp: Date.now() });
                    return result;
                }
            } catch (e) {
                console.warn(`[AUTH SCAN] ${path} recusado (Status: ${e.response?.status || 'OFFLINE'})`);
            }
        }

        // Fallback clássico
        console.log(`[AUTH] IP falso falhou, a tentar método clássico...`);
        const classicBase = cleanBase.replace(/\/c$/, '');
        const classicPaths = ['/c/portal.php', '/stalker_portal/c/portal.php', '/portal.php', '/server/load.php'];

        for (const path of classicPaths) {
            const fullUrl = `${classicBase}${path}?`;
            try {
                const handshakeUrl = `${fullUrl}type=stb&action=handshake&mac=${encodeURIComponent(mac)}&JsHttpRequest=1-0`;
                const classicHeaders = {
                    'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
                    'Referer': `${classicBase}/c/`,
                    'Accept': '*/*',
                    'Connection': 'keep-alive',
                    'Cookie': `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=Europe/Lisbon;`
                };
                const res = await axios.get(handshakeUrl, this.getAxiosOpts(config, { headers: classicHeaders, timeout: 8000 }));
                let data = res.data;
                if (typeof data === 'string') data = JSON.parse(data.replace(/\/\*[\s\S]*?\*\//g, "").trim());
                if (data?.js?.token) {
                    const token = data.js.token;
                    console.log(`[AUTH SUCCESS] Clássico funcionou em: ${path}`);
                    classicHeaders.Authorization = `Bearer ${token}`;
                    classicHeaders.Cookie += ` token=${token}; access_token=${token};`;
                    const result = {
                        api: `${classicBase}${path}?`,
                        apiAlt: `${classicBase}/server/load.php?`,
                        token,
                        authData: { sn: data.js.sn || classicHeaders.sn, headers: classicHeaders }
                    };
                    authCache.set(cacheKey, { data: result, timestamp: Date.now() });
                    return result;
                }
            } catch (e) {
                console.warn(`[AUTH SCAN] Clássico recusado em ${path} (${e.message})`);
            }
        }

        console.error(`[AUTH FATAL] Nenhum caminho ou perfil funcionou para este MAC.`);
        return null;
    },

    async createStreamLink(auth, config, stalkerCmd, type, sNum = null) {
        const cmdType = (type === "movie" || type === "series") ? "vod" : "itv";
        const seriesParam = sNum ? `&series=${sNum}` : '';
        const chCheck = type === "tv" ? "&force_ch_link_check=1" : "";
        const realCmd = stalkerCmd;

        const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }, config.proxy);

        // Tentativa 1: comando original (cmd)
        let linkUrl = `${auth.api}type=${cmdType}&action=create_link&cmd=${encodeURIComponent(realCmd)}${seriesParam}&sn=${auth.authData.sn}&token=${auth.token}${chCheck}&long_lived=1&JsHttpRequest=1-0`;
        let res = await axios.get(linkUrl, opts).catch(() => ({}));
        let url = this.extractUrl(res.data?.js);

        // Tentativa 2: video_id
        if (!url) {
            linkUrl = `${auth.api}type=${cmdType}&action=create_link&video_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${auth.authData.sn}&token=${auth.token}${chCheck}&long_lived=1&JsHttpRequest=1-0`;
            res = await axios.get(linkUrl, opts).catch(() => ({}));
            url = this.extractUrl(res.data?.js);
        }

        // Tentativa 3: para séries
        if (!url && type === "series") {
            linkUrl = `${auth.api}type=series&action=create_link&video_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${auth.authData.sn}&token=${auth.token}${chCheck}&long_lived=1&JsHttpRequest=1-0`;
            res = await axios.get(linkUrl, opts).catch(() => ({}));
            url = this.extractUrl(res.data?.js);
        }

        // Tentativa 4: movie_id (para filmes e séries)
        if (!url && (type === "series" || type === "movie")) {
            linkUrl = `${auth.api}type=vod&action=create_link&movie_id=${encodeURIComponent(realCmd)}${seriesParam}&sn=${auth.authData.sn}&token=${auth.token}${chCheck}&long_lived=1&JsHttpRequest=1-0`;
            res = await axios.get(linkUrl, opts).catch(() => ({}));
            url = this.extractUrl(res.data?.js);
        }

        return url;
    },

    extractUrl(jsData) {
        if (!jsData) return null;
        let url = jsData?.cmd || jsData?.url || (typeof jsData === 'string' ? jsData : null);
        if (!url && typeof jsData === 'object') {
            url = Object.values(jsData).find(v => typeof v === 'string' && (v.startsWith('http') || v.includes('://')));
        }
        return url ? url.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, "") : null;
    },

    async getManifest(configBase64) {
        console.log("[MANIFEST] Pedido de Manifest recebido.");
        const cacheKey = `manifest_${configBase64}`;
        const cached = getCache(cacheKey); if (cached) return cached;
        const lists = this.parseConfig(configBase64);
        let catalogs = [];
        await Promise.all(lists.map(async (l, i) => {
            let tvG = ["Predefinido"]; let movG = ["Predefinido"]; let serG = ["Predefinido"];
            try {
                if (l.type === 'xtream') {
                    const b = l.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(l.user)}&password=${encodeURIComponent(l.pass)}`;
                    const f = async (a) => {
                        try {
                            const r = await axios.get(`${api}&action=${a}`, this.getAxiosOpts(l, { timeout: 5000 }));
                            return Array.isArray(r.data) ? r.data.map(g => g.category_name) : [];
                        } catch(e) { return []; }
                    };
                    const [c1, c2, c3] = await Promise.all([f('get_live_categories'), f('get_vod_categories'), f('get_series_categories')]);
                    tvG = tvG.concat(c1); movG = movG.concat(c2); serG = serG.concat(c3);
                } else {
                    const auth = await this.authenticate(l);
                    if (auth) {
                        const fetchSt = async (t, a, fb) => {
                            try {
                                let r;
                                try {
                                    r = await axios.get(`${auth.api}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                                } catch (e) {
                                    if (auth.apiAlt) {
                                        r = await axios.get(`${auth.apiAlt}type=${t}&action=${a}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                                    } else throw e;
                                }
                                let items = r.data?.js?.data || r.data?.js || [];
                                if ((!items || (Array.isArray(items) && items.length === 0)) && fb) {
                                    try {
                                        r = await axios.get(`${auth.api}type=${t}&action=${fb}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                                    } catch (e) {
                                        if (auth.apiAlt) {
                                            r = await axios.get(`${auth.apiAlt}type=${t}&action=${fb}&sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`, this.getAxiosOpts(l, { headers: auth.authData.headers, timeout: 5000 }));
                                        } else throw e;
                                    }
                                    items = r.data?.js?.data || r.data?.js || [];
                                }
                                return (Array.isArray(items) ? items : Object.values(items)).map(g => g.title || g.name).filter(Boolean);
                            } catch(e) { return []; }
                        };
                        const [g1, g2, g3] = await Promise.all([
                            fetchSt('itv', 'get_categories', 'get_genres'),  // tenta get_categories primeiro
                            fetchSt('vod', 'get_categories', 'get_genres'),
                            fetchSt('series', 'get_categories', 'get_genres')
                        ]);
                        tvG = tvG.concat(g1); movG = movG.concat(g2); serG = serG.concat(g3);
                    }
                }
            } catch(e) { console.error(`[MANIFEST ERROR] Falha ao carregar categorias da lista ${i}:`, e.message); }

            if (l.selectedCategories) {
                const sel = l.selectedCategories;
                if (sel.tv && sel.tv.length > 0) tvG = tvG.filter(cat => sel.tv.includes(cat)); else tvG = [];
                if (sel.movie && sel.movie.length > 0) movG = movG.filter(cat => sel.movie.includes(cat)); else movG = [];
                if (sel.series && sel.series.length > 0) serG = serG.filter(cat => sel.series.includes(cat)); else serG = [];
            }

            const uniqueTv = [...new Set(tvG.filter(Boolean))];
            const uniqueMov = [...new Set(movG.filter(Boolean))];
            const uniqueSer = [...new Set(serG.filter(Boolean))];

            if (uniqueTv.length > 0) catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: uniqueTv }, { name: "skip" }] });
            if (uniqueMov.length > 0) catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: uniqueMov }, { name: "skip" }] });
            if (uniqueSer.length > 0) catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: uniqueSer }, { name: "skip" }] });
        }));

        const addonName = lists.map(l => l.name).filter(Boolean).join(" + ") || "XuloV Hub";
        const m = { id: "org.xulov.stalker", version: "5.3.0", name: addonName, resources: ["catalog", "stream", "meta"], types: ["tv", "movie", "series"], idPrefixes: ["xlv:"], catalogs: catalogs };
        setCache(cacheKey, m, 60);
        console.log("[MANIFEST] Manifest gerado com sucesso.");
        return m;
    },

    async getCatalog(type, id, extra, configBase64) {
        const normalize = (str) => (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
        console.log(`[CATALOG] Pedido: type=${type}, id=${id}, genre=${extra.genre || 'N/A'}, skip=${extra.skip || 0}`);
        const lists = this.parseConfig(configBase64);
        const lIdx = parseInt(id.split('_')[1]);
        const config = lists[lIdx];
        if (!config) return { metas: [] };

        const listSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        const skip = parseInt(extra.skip) || 0;
        const effectiveGenre = (extra.genre === 'Predefinido' || extra.genre === 'Default') ? null : extra.genre;
        let metas = [];

        try {
            if (config.type === 'm3u') {
                const channels = await parseM3U(config.m3uUrl, config);
                const genre = effectiveGenre;
                const filtered = genre ? channels.filter(c => c.group === genre) : channels;
                const pageItems = filtered.slice(skip, skip + 100);
                metas = pageItems.map((c) => ({
                    id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(c.url)}:${encodeURIComponent(c.name)}:${encodeURIComponent(c.logo || '')}`,
                    name: c.name,
                    type: 'tv',
                    poster: c.logo,
                    posterShape: 'landscape'
                }));
                return { metas };
            }

            if (config.type === 'xtream') {
                const b = config.url.trim().replace(/\/$/, "");
                const cacheKey = `xtream_${b}_${config.user}_${type}_${extra.genre || 'N/A'}`;
                let xtreamData;
                if (catalogCache[cacheKey] && (Date.now() - catalogCache[cacheKey].lastUpdate < CACHE_TTL)) {
                    xtreamData = catalogCache[cacheKey].data;
                } else {
                    const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                    let act = type === "tv" ? "get_live_streams" : (type === "movie" ? "get_vod_streams" : "get_series");
                    const xtreamHeaders = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    };
                    if (effectiveGenre) {
                        const cAct = type === "tv" ? "get_live_categories" : (type === "movie" ? "get_vod_categories" : "get_series_categories");
                        const cRes = await axios.get(`${api}&action=${cAct}`, this.getAxiosOpts(config, { timeout: 5000, headers: xtreamHeaders }));
                        const cat = (cRes.data || []).find(c => normalize(c.category_name) === normalize(effectiveGenre));
                        if (cat) act += `&category_id=${cat.category_id}`;
                    }
                    const res = await axios.get(`${api}&action=${act}`, this.getAxiosOpts(config, { timeout: 10000, headers: xtreamHeaders }));
                    xtreamData = Array.isArray(res.data) ? res.data : [];
                    catalogCache[cacheKey] = { data: xtreamData, lastUpdate: Date.now() };
                }
                metas = xtreamData.slice(skip, skip + 100).map(item => ({
                    id: `xlv:${lIdx}_${listSig}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}:${encodeURIComponent(item.stream_icon || item.cover || '')}`,
                    name: item.name || item.title,
                    type: type,
                    poster: item.stream_icon || item.cover,
                    posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                // Stalker
                const auth = await this.authenticate(config);
                if (!auth) return { metas: [] };

                const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                let catP = "";
                if (effectiveGenre) {
                    const actions = sType === "itv" ? ["get_genres", "get_categories"] : ["get_categories", "get_genres"];
                    let cats = [];
                    for (const act of actions) {
                        try {
                            let cRes = await axios.get(`${auth.api}type=${sType}&action=${act}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                            const found = cRes.data?.js?.data || cRes.data?.js || [];
                            const tempCats = Array.isArray(found) ? found : Object.values(found);
                            if (tempCats.length > 0) { cats = tempCats; break; }
                        } catch(e) {}
                    }
                    const cat = cats.find(c => normalize(c.title || c.name) === normalize(effectiveGenre));
                    if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                }

                const sAct = "get_ordered_list";
                const chCheckCat = type === "tv" ? "&force_ch_link_check=1" : "";
                const page = Math.floor(skip / 30) + 1; // assumimos 30 itens por página, mas sem slice abaixo
                let res;
                try {
                    res = await axios.get(`${auth.api}type=${sType}&action=${sAct}${catP}&p=${page}${chCheckCat}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                } catch (e) {
                    if (auth.apiAlt) {
                        res = await axios.get(`${auth.apiAlt}type=${sType}&action=${sAct}${catP}&p=${page}${chCheckCat}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                    } else throw e;
                }
                const raw = res.data?.js?.data || res.data?.js || [];
                const stalkerData = Array.isArray(raw) ? raw : Object.values(raw);

                // Sem slice sobre a página; devolvemos todos os itens da página
                metas = stalkerData.filter(i => i && (i.id || i.cmd)).map(m => {
                    let targetId = m.id || m.cmd;  // prioridade ao id
                    return {
                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(targetId)}:${encodeURIComponent(m.name || m.title)}:${encodeURIComponent(m.logo || m.screenshot_uri || '')}`,
                        name: m.name || m.title,
                        type: type,
                        poster: m.logo || m.screenshot_uri,
                        posterShape: type === "tv" ? "landscape" : "poster"
                    };
                });
            }
        } catch (e) {
            console.error(`[CATALOG ERROR] Erro ao carregar catálogo:`, e.message);
            if (e.response && e.response.status === 400) console.error(`[DEBUG 400] URL:`, e.config?.url || e.response?.config?.url);
        }
        return { metas };
    },

    async getMeta(type, id, configBase64) {
        console.log(`[META] Pedido: type=${type}, id=${id}`);
        const parts = id.split(":");
        const lIdxParts = parts[1].split("_");
        const lIdx = parseInt(lIdxParts[0]);
        const sig = lIdxParts[1];
        const sId = decodeURIComponent(parts[2]);
        const name = decodeURIComponent(parts[3] || "Série");
        const posterUrl = parts[4] ? decodeURIComponent(parts[4]) : undefined;

        const lists = this.parseConfig(configBase64);
        const config = lists[lIdx];
        if (!config) return { meta: {} };

        const expectedSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        if (sig && sig !== expectedSig) return { meta: {} };

        const listSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        let meta = { id, type, name, posterShape: "poster", videos: [] };

        if (posterUrl) {
            meta.poster = posterUrl;
            meta.background = posterUrl;
        }

        let tmdbId = null;
        if (type === "series" || type === "movie") {
            try {
                const searchTitle = cleanTitle(name);
                const tmdbType = (type === "series") ? "tv" : "movie";
                let searchUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchTitle)}&language=pt-PT`;
                let searchRes = await axios.get(searchUrl);
                if (!searchRes.data.results || searchRes.data.results.length === 0) {
                    searchUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(searchTitle)}`;
                    searchRes = await axios.get(searchUrl);
                }
                if (searchRes.data.results && searchRes.data.results.length > 0) {
                    const item = searchRes.data.results[0];
                    tmdbId = item.id;
                    const detailUrl = `https://api.themoviedb.org/3/${tmdbType}/${item.id}?api_key=${TMDB_API_KEY}&language=pt-PT&append_to_response=credits`;
                    const detailRes = await axios.get(detailUrl);
                    const d = detailRes.data;
                    meta.description = d.overview || item.overview;
                    meta.poster = d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : meta.poster;
                    meta.background = d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : meta.background;
                    meta.releaseInfo = (d.first_air_date || d.release_date || "").split('-')[0];
                    meta.genres = d.genres ? d.genres.map(g => g.name) : [];
                    if (d.vote_average) meta.imdbRating = d.vote_average.toFixed(1).toString();
                    if (d.credits && d.credits.cast) meta.cast = d.credits.cast.slice(0, 10).map(c => c.name);
                }
            } catch (e) { console.error(`[TMDB ERROR]`, e.message); }
        }

        if (type === "series") {
            let seasonDataCache = {};
            const fetchSeasonData = async (sNum) => {
                if (!tmdbId || seasonDataCache[sNum]) return;
                try {
                    const sRes = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${sNum}?api_key=${TMDB_API_KEY}&language=pt-PT`);
                    const sResGlobal = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${sNum}?api_key=${TMDB_API_KEY}`);
                    seasonDataCache[sNum] = {};
                    sRes.data.episodes.forEach((ep, idx) => {
                        const epGlobal = sResGlobal.data?.episodes?.[idx] || {};
                        seasonDataCache[sNum][ep.episode_number] = {
                            thumbnail: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : (epGlobal.still_path ? `https://image.tmdb.org/t/p/w500${epGlobal.still_path}` : undefined),
                            title: ep.name || epGlobal.name || `Episódio ${ep.episode_number}`,
                            overview: ep.overview || epGlobal.overview || undefined,
                            released: (ep.air_date || epGlobal.air_date) ? new Date(ep.air_date || epGlobal.air_date).toISOString() : undefined
                        };
                    });
                } catch (e) { seasonDataCache[sNum] = {}; }
            };

            try {
                if (config.type === 'xtream') {
                    const b = config.url.trim().replace(/\/$/, "");
                    const api = `${b}/player_api.php?username=${encodeURIComponent(config.user)}&password=${encodeURIComponent(config.pass)}`;
                    const res = await axios.get(`${api}&action=get_series_info&series_id=${sId}`, this.getAxiosOpts(config, { timeout: 10000 }));
                    if (res.data && res.data.episodes) {
                        const epsData = res.data.episodes;
                        for (const sNum of Object.keys(epsData)) {
                            await fetchSeasonData(parseInt(sNum) || 1);
                            epsData[sNum].forEach(ep => {
                                let epNum = parseInt(ep.episode_num) || 1;
                                let epData = seasonDataCache[sNum]?.[epNum] || {};
                                meta.videos.push({
                                    id: `xlv:${lIdx}_${listSig}:${ep.id}.${ep.container_extension || 'mp4'}:${encodeURIComponent(ep.title || 'Ep')}`,
                                    title: epData.title || ep.title || `Episódio ${epNum}`,
                                    season: parseInt(sNum) || 1,
                                    episode: epNum,
                                    thumbnail: epData.thumbnail || undefined,
                                    overview: epData.overview || undefined,
                                    released: epData.released || undefined
                                });
                            });
                        }
                    }
                } else {
                    const auth = await this.authenticate(config);
                    if (auth) {
                        const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const opts = this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 });

                        let rFirst = await axios.get(`${apiBase}&type=series&action=get_ordered_list&movie_id=${sId}`, opts);
                        let levels = rFirst.data?.js?.data || rFirst.data?.js || [];
                        levels = Array.isArray(levels) ? levels : Object.values(levels);

                        if (levels.length === 0) {
                            let rSecond = await axios.get(`${apiBase}&type=vod&action=get_ordered_list&movie_id=${sId}`, opts);
                            let levelsSecond = rSecond.data?.js?.data || rSecond.data?.js || [];
                            levels = Array.isArray(levelsSecond) ? levelsSecond : Object.values(levelsSecond);
                        }

                        for (let i = 0; i < levels.length; i++) {
                            let item = levels[i];
                            if (!item) continue;
                            let sNum = parseInt((item.name || "").match(/season\s*(\d+)|temporada\s*(\d+)/i)?.[1] || (item.name || "").match(/\d+/)?.[0]) || (i + 1);
                            await fetchSeasonData(sNum);

                            let seriesArr = [];
                            if (item.series) {
                                seriesArr = typeof item.series === 'string' ? item.series.split(',') : (Array.isArray(item.series) ? item.series : []);
                            } else {
                                let rInfo = await axios.get(`${apiBase}&type=vod&action=get_movie_info&movie_id=${item.id || item.cmd}`, opts);
                                let info = rInfo.data?.js;
                                if (info && info.series) {
                                    seriesArr = typeof info.series === 'string' ? info.series.split(',') : (Array.isArray(info.series) ? info.series : []);
                                }
                            }

                            if (seriesArr.length > 0) {
                                seriesArr.forEach((epVal, index) => {
                                    let eNum = parseInt(epVal) || (index + 1);
                                    let epData = seasonDataCache[sNum]?.[eNum] || {};
                                    meta.videos.push({
                                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent((item.cmd || item.id) + "|||" + eNum)}:${encodeURIComponent(item.name || "Ep")}`,
                                        title: epData.title || `Episódio ${eNum}`,
                                        season: sNum,
                                        episode: eNum,
                                        thumbnail: epData.thumbnail || undefined,
                                        overview: epData.overview || undefined,
                                        released: epData.released || undefined
                                    });
                                });
                            } else {
                                let epData = seasonDataCache[sNum]?.[1] || {};
                                meta.videos.push({
                                    id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(item.cmd || item.id)}:${encodeURIComponent(item.name || "Ep")}`,
                                    title: epData.title || item.name || `Episódio ${i+1}`,
                                    season: sNum,
                                    episode: 1,
                                    thumbnail: epData.thumbnail || undefined,
                                    overview: epData.overview || undefined,
                                    released: epData.released || undefined
                                });
                            }
                        }

                        if (meta.videos.length === 0) {
                            let rInfoDirect = await axios.get(`${apiBase}&type=vod&action=get_movie_info&movie_id=${sId}`, opts);
                            let infoDirect = rInfoDirect.data?.js;
                            if (!infoDirect || (!infoDirect.series && !infoDirect.cmd)) {
                                let rInfoSer = await axios.get(`${apiBase}&type=series&action=get_movie_info&movie_id=${sId}`, opts);
                                infoDirect = rInfoSer.data?.js || infoDirect;
                            }
                            let seriesArrDirect = [];
                            if (infoDirect && infoDirect.series) {
                                seriesArrDirect = typeof infoDirect.series === 'string' ? infoDirect.series.split(',') : (Array.isArray(infoDirect.series) ? infoDirect.series : []);
                            }
                            if (seriesArrDirect.length > 0) {
                                await fetchSeasonData(1);
                                seriesArrDirect.forEach((epVal, index) => {
                                    let eNum = parseInt(epVal) || (index + 1);
                                    let epData = seasonDataCache[1]?.[eNum] || {};
                                    meta.videos.push({
                                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(sId + "|||" + eNum)}:${encodeURIComponent(name)}`,
                                        title: epData.title || `Episódio ${eNum}`,
                                        season: 1,
                                        episode: eNum,
                                        thumbnail: epData.thumbnail || undefined,
                                        overview: epData.overview || undefined,
                                        released: epData.released || undefined
                                    });
                                });
                            } else if (infoDirect && (infoDirect.cmd || infoDirect.id)) {
                                let epData = seasonDataCache[1]?.[1] || {};
                                meta.videos.push({
                                    id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(infoDirect.cmd || infoDirect.id)}:${encodeURIComponent(name)}`,
                                    title: epData.title || infoDirect.name || `Episódio Único`,
                                    season: 1,
                                    episode: 1,
                                    thumbnail: epData.thumbnail || undefined,
                                    overview: epData.overview || undefined,
                                    released: epData.released || undefined
                                });
                            }
                        }
                        meta.videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
                    }
                }
            } catch (e) { console.error(`[META ERROR]`, e.message); }

            if (meta.videos.length === 0) {
                meta.videos.push({ id: `xlv:${lIdx}_${listSig}:empty:empty`, title: "Nenhum episódio encontrado", season: 1, episode: 1 });
            }
        }
        return { meta };
    },

    async getStreams(type, id, configBase64, host) {
        console.log(`[STREAMS] Pedido de stream: type=${type}, id=${id}`);
        if (type === "series") await new Promise(resolve => setTimeout(resolve, 2500));

        const parts = id.split(":");
        const lIdxParts = parts[1].split("_");
        const lIdx = parseInt(lIdxParts[0]);
        const sig = lIdxParts[1];
        const sId = parts[2];
        const name = decodeURIComponent(parts[3] || "Stream");
        const lists = this.parseConfig(configBase64);
        const config = lists[lIdx];
        if (!config) return { streams: [] };
        const expectedSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        if (sig && sig !== expectedSig) return { streams: [] };

        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;
        let streams = [];
        let directAdded = false;

        if (config.type === 'xtream') {
            const b = config.url.trim().replace(/\/$/, "");
            if (type === 'tv') {
                streams.push({ name: name, url: `${b}/live/${config.user}/${config.pass}/${sId}.ts`, title: '📺 Directo TV', behaviorHints: { notWebReady: true }, contentType: 'video/mp2t' });
            } else if (type === 'movie') {
                streams.push({ name: name, url: `${b}/movie/${config.user}/${config.pass}/${sId}`, title: '🎬 Directo Filme', behaviorHints: { notWebReady: false } });
            } else if (type === 'series') {
                streams.push({ name: name, url: `${b}/series/${config.user}/${config.pass}/${sId}`, title: `🍿 Directo Série - ${name}`, behaviorHints: { notWebReady: false } });
            }
            directAdded = true;
        } else if (config.type === 'm3u') {
            const url = decodeURIComponent(sId);
            streams.push({ name: name, url: url, title: '📺 Directo M3U', behaviorHints: { notWebReady: true }, contentType: 'video/mp2t' });
            directAdded = true;
        } else {
            // Stalker
            try {
                let auth = await this.authenticate(config);
                if (auth) {
                    const decodedCmd = decodeURIComponent(sId);
                    let realCmd = decodedCmd;
                    let sNum = null;
                    if (decodedCmd.includes('|||')) {
                        const partsCmd = decodedCmd.split('|||');
                        realCmd = partsCmd[0];
                        sNum = partsCmd[1];
                    } else if (decodedCmd.includes('|')) {
                        const partsCmd = decodedCmd.split('|');
                        realCmd = partsCmd[0];
                        sNum = partsCmd[1];
                    }
                    let cmdUrl = await this.createStreamLink(auth, config, realCmd, type, sNum);
                    if (!cmdUrl) {
                        // tenta renovar autenticação
                        auth = await this.authenticate(config);
                        if (auth) cmdUrl = await this.createStreamLink(auth, config, realCmd, type, sNum);
                    }
                    if (cmdUrl && typeof cmdUrl === 'string' && cmdUrl.trim() !== '') {
                        let cleanUrl = cmdUrl.trim().replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/i, '');
                        if (!cleanUrl.includes('.ts') && !cleanUrl.includes('.m3u8') && !cleanUrl.includes('.mp4')) {
                            cleanUrl += (cleanUrl.includes('?') ? '&' : '?') + 'format=ts';
                        }
                        if (cleanUrl.includes('://')) {
                            const titleStr = type === 'movie' ? '🎬 Directo Filme' : (type === 'series' ? `🍿 Directo Série - ${name}` : '⚡ Directo TV');
                            streams.push({ name: name, url: cleanUrl, title: titleStr, behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
                            directAdded = true;
                        }
                    }
                }
            } catch (e) {
                console.error(`[STREAM ERROR]`, e.message);
            }

            if (!directAdded) {
                let fallbackUrl = decodeURIComponent(sId).split('|||')[0].split('|')[0].replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                if (fallbackUrl.startsWith('http')) {
                    streams.push({ name: name, url: fallbackUrl, title: 'Directo TV', behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
                }
            }
        }

        // Proxy stream (sempre disponível, a menos que useProxy seja falso)
        const useProxy = config?.useProxy !== false;
        if (useProxy) {
            const hint = config?.streamHint || '';
            const proxyTitle = (hint ? hint + ' ' : '') + (type === 'movie' ? '🎬 Proxy Estável' : (type === 'series' ? `🍿 Proxy Estável - ${name}` : '🔄 Proxy Estável'));
            streams.push({ name: name, url: pUrl, title: proxyTitle, behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
        }

        return { streams };
    }
};

module.exports = addon;