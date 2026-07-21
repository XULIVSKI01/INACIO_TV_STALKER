// addon.cjs – universal e estável 23 junho (integrado com stalkerengine)
const axios = require("axios");
const crypto = require("crypto");
const https = require('https'); 
const engine = require("./stalkerengine.cjs");

const catalogCache = {};
const CACHE_TTL = 1000 * 60 * 60 * 4;

const TMDB_API_KEY = "04057ce87e56ea3234aff745ce9090ea";

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

async function parseM3U(url, config) {
    const res = await axios.get(url, {
        timeout: 15000,
        responseType: 'text',
        ...engine.getAxiosOpts(config || {})   // usa o proxy se configurado
    });
    const lines = res.data.split('\n');
    const channels = [];
    let current = {};
    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const name = line.split(',')[1]?.trim() || 'Sem nome';
            const logo = (line.match(/tvg-logo="([^"]+)"/) || [])[1] || '';
            const group = (line.match(/group-title="([^"]+)"/) || [])[1] || 'Sem grupo';
            current = { name, logo, group };
        } else if (line.trim().startsWith('http')) {
            channels.push({ ...current, url: line.trim() });
            current = {};
        }
    }
    return channels;
}

const addon = {
    getAxiosOpts(config, extraOpts = {}) {
    let opts = { ...extraOpts };
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });
    opts.httpsAgent = httpsAgent;

    // User-Agent padrão (resolve bloqueios Xtream)
    if (!opts.headers) {
        opts.headers = {};
    }
    if (!opts.headers['User-Agent']) {
        opts.headers['User-Agent'] = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
    }

    if (config && config.proxy) {
        const proxyStr = config.proxy.trim();
        if (proxyStr.startsWith('socks')) {
            const { SocksProxyAgent } = require('socks-proxy-agent');
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

    parseConfig(configBase64) {   // <-- esta linha já existia
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

    // O authenticate foi removido – usa-se engine.authenticate diretamente
    async getManifest(configBase64) {
        console.log("[MANIFEST] Pedido de Manifest recebido.");
        const cacheKey = `manifest_${configBase64}`;
        const cached = getCache(cacheKey); if (cached) return cached;
        const lists = this.parseConfig(configBase64);
        let catalogs = [];
        await Promise.all(lists.map(async (l, i) => {
            let tvG = []; let movG = []; let serG = [];
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
                } else if (l.type === 'm3u') {
                    const channels = await parseM3U(l.m3uUrl, l);
                    const groups = [...new Set(channels.map(c => c.group).filter(Boolean))];
                    catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: groups }, { name: "skip" }] });
                    return; // salta o resto do processamento para esta lista
                } else {
                    const auth = await engine.authenticate(l, l.proxy);                  if (auth) {
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
                            fetchSt('itv', 'get_genres', 'get_categories'), 
                            fetchSt('vod', 'get_categories', 'get_genres'), 
                            fetchSt('series', 'get_categories', 'get_genres')
                        ]);
                        tvG = tvG.concat(g1); movG = movG.concat(g2); serG = serG.concat(g3);
                    }
                }
            } catch(e) { console.error(`[MANIFEST ERROR] Falha ao carregar categorias da lista ${i}:`, e.message); }

            // Remove categorias indesejadas (ignorando espaços e maiúsculas/minúsculas)
               const isUndesired = (cat) => {
                   const clean = (cat || '').trim().toLowerCase();
                   return clean === 'predefinido' || clean === 'default';
                };
               tvG = tvG.filter(cat => !isUndesired(cat));
               movG = movG.filter(cat => !isUndesired(cat));
               serG = serG.filter(cat => !isUndesired(cat));  

               console.log(`[DEBUG MANIFEST] tvG após filtro: ${JSON.stringify(tvG)}`);
               console.log(`[DEBUG MANIFEST] movG após filtro: ${JSON.stringify(movG)}`);
               console.log(`[DEBUG MANIFEST] serG após filtro: ${JSON.stringify(serG)}`);
               
            // 📌 Filtragem pelas categorias selecionadas (NOVA LÓGICA)
               if (l.selectedCategories) {
                  const sel = l.selectedCategories;
               if (sel.tv && sel.tv.length > 0) tvG = tvG.filter(cat => sel.tv.includes(cat));
                  else tvG = [];
               if (sel.movie && sel.movie.length > 0) movG = movG.filter(cat => sel.movie.includes(cat));
                  else movG = [];
               if (sel.series && sel.series.length > 0) serG = serG.filter(cat => sel.series.includes(cat));
                  else serG = [];
             }

// Criar arrays únicos (remove duplicados)
const uniqueTv = [...new Set(tvG.filter(Boolean))];
const uniqueMov = [...new Set(movG.filter(Boolean))];
const uniqueSer = [...new Set(serG.filter(Boolean))];

// Filtrar última vez para garantir que Default não aparece no manifesto
const safeOptions = (arr) => arr.filter(cat => {
    const c = (cat || '').trim().toLowerCase();
    return c !== 'default' && c !== 'predefinido';
});

if (uniqueTv.length > 0) {
    catalogs.push({ type: "tv", id: `cat_${i}`, name: l.name || `Lista ${i+1}`, extra: [{ name: "genre", options: safeOptions(uniqueTv) }, { name: "skip" }] });
}
if (uniqueMov.length > 0) {
    catalogs.push({ type: "movie", id: `mov_${i}`, name: `${l.name || `Lista ${i+1}`} 🎬`, extra: [{ name: "genre", options: safeOptions(uniqueMov) }, { name: "skip" }] });
}
if (uniqueSer.length > 0) {
    catalogs.push({ type: "series", id: `ser_${i}`, name: `${l.name || `Lista ${i+1}`} 🍿`, extra: [{ name: "genre", options: safeOptions(uniqueSer) }, { name: "skip" }] });
}
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
        const config = lists[lIdx]; if (!config) return { metas: [] };
        
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
    metas = pageItems.map((c, idx) => ({
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
                    if (effectiveGenre) {
                        const cAct = type === "tv" ? "get_live_categories" : (type === "movie" ? "get_vod_categories" : "get_series_categories");
                        const cRes = await axios.get(`${api}&action=${cAct}`, this.getAxiosOpts(config, {timeout: 5000}));
                        const cat = (cRes.data || []).find(c => normalize(c.category_name) === normalize(effectiveGenre));
                        if (cat) act += `&category_id=${cat.category_id}`;
                    }
                    const res = await axios.get(`${api}&action=${act}`, this.getAxiosOpts(config, {timeout: 10000}));
                    xtreamData = Array.isArray(res.data) ? res.data : [];
                    catalogCache[cacheKey] = { data: xtreamData, lastUpdate: Date.now() };
                }
                metas = xtreamData.slice(skip, skip + 100).map(item => ({
                    id: `xlv:${lIdx}_${listSig}:${item.stream_id || item.series_id}${type === 'movie' ? '.' + (item.container_extension || 'mp4') : ''}:${encodeURIComponent(item.name || item.title)}:${encodeURIComponent(item.stream_icon || item.cover || '')}`,
                    name: item.name || item.title, type: type, poster: item.stream_icon || item.cover, posterShape: type === "tv" ? "landscape" : "poster"
                }));
            } else {
                const page = Math.floor(skip / 14) + 1;
                const cacheKey = `stalker_${config.url}_${type}_${extra.genre || 'N/A'}_p${page}`;
                let stalkerData;
                if (catalogCache[cacheKey] && (Date.now() - catalogCache[cacheKey].lastUpdate < CACHE_TTL)) {
                    stalkerData = catalogCache[cacheKey].data;
                } else {
                    console.log(`[CACHE VAZIA/EXPIRADA] Autenticando e buscando dados do portal Stalker para ${type} - Página ${page}...`);
                    const auth = await engine.authenticate(config, config.proxy);
                    if (auth) {
                        const safeApi = auth.api;
                        const altApi = auth.apiAlt || null;
                        const sType = type === "tv" ? "itv" : (type === "movie" ? "vod" : "series");
                        let catP = "";
                        if (effectiveGenre) {
                            const actions = sType === "itv" ? ["get_genres", "get_categories"] : ["get_categories", "get_genres"];
                            let cats = [];
                            for (const act of actions) {
                                try {
                                    let cRes;
                                    try {
                                        cRes = await axios.get(`${safeApi}type=${sType}&action=${act}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                                    } catch (e) {
                                        if (altApi) cRes = await axios.get(`${altApi}type=${sType}&action=${act}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 5000 }));
                                        else continue;
                                    }
                                    const found = cRes.data?.js?.data || cRes.data?.js || [];
                                    const tempCats = Array.isArray(found) ? found : Object.values(found);
                                    if (tempCats.length > 0) { cats = tempCats; break; }
                                } catch(e) { continue; }
                            }
                            const cat = cats.find(c => normalize(c.title || c.name) === normalize(effectiveGenre));
                            if (cat) catP = sType === "itv" ? `&genre=${cat.id}` : `&category=${cat.id}`;
                        }
                        let sAct = "get_ordered_list"; 
                        let chCheckCat = type === "tv" ? "&force_ch_link_check=1" : "";
                        let res;
                        try {
                            res = await axios.get(`${safeApi}type=${sType}&action=${sAct}${catP}&p=${page}${chCheckCat}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                        } catch (e) {
                            if (altApi) {
                                console.log(`[CATALOG] Portal.php falhou, a tentar server/load.php...`);
                                res = await axios.get(`${altApi}type=${sType}&action=${sAct}${catP}&p=${page}${chCheckCat}&JsHttpRequest=1-0`, this.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 }));
                            } else throw e;
                        }
                        const raw = res.data?.js?.data || res.data?.js || [];
                        stalkerData = Array.isArray(raw) ? raw : Object.values(raw);
                        catalogCache[cacheKey] = { data: stalkerData, lastUpdate: Date.now() };
                    } else {
                        stalkerData = [];
                    }
                }
                metas = stalkerData.filter(i => i && (i.id || i.cmd)).map(m => {
                    let targetId = (type === "series") ? (m.id || m.cmd) : (m.cmd || m.id);
                    return {
                        id: `xlv:${lIdx}_${listSig}:${encodeURIComponent(targetId)}:${encodeURIComponent(m.name || m.title)}:${encodeURIComponent(m.logo || m.screenshot_uri || '')}`,
                        name: m.name || m.title, type: type, poster: m.logo || m.screenshot_uri, posterShape: type === "tv" ? "landscape" : "poster"
                    };
                });
            }
        } catch (e) { 
            console.error(`[CATALOG ERROR] Erro ao carregar catálogo:`, e.message); 
            if (e.response && e.response.status === 400) console.error(`[DEBUG 400] O portal rejeitou este URL exato:`, e.config?.url || e.response?.config?.url);
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
        
        const _lists = this.parseConfig(configBase64);
        const _config = _lists[lIdx];
        if (_config) {
            const expectedSig = crypto.createHash('md5').update(_config.url).digest('hex').substring(0,4);
            if (sig && sig !== expectedSig) return { meta: {} }; 
        }
        const listSig = _config ? crypto.createHash('md5').update(_config.url).digest('hex').substring(0,4) : "";

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
                
                if ((!searchRes.data.results || searchRes.data.results.length === 0)) {
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
                    
                    if (d.vote_average) {
                        meta.imdbRating = d.vote_average.toFixed(1).toString();
                    }

                    if (d.credits && d.credits.cast) {
                        meta.cast = d.credits.cast.slice(0, 10).map(c => c.name);
                    }
                }
            } catch (e) { console.error(`[TMDB ERROR] Erro ao buscar metadados para ${name}:`, e.message); }
        }

        if (type === "series") {
            const lists = this.parseConfig(configBase64);
            const config = lists[lIdx];
            if (!config) return { meta };

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
                    const res = await axios.get(`${api}&action=get_series_info&series_id=${sId}`, engine.getAxiosOpts(config, { timeout: 10000 }));
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
                    const auth = await engine.authenticate(config, config.proxy);
                    if (auth) {
                        const apiBase = `${auth.api}sn=${auth.authData.sn}&token=${auth.token}&JsHttpRequest=1-0`;
                        const opts = engine.getAxiosOpts(config, { headers: auth.authData.headers, timeout: 10000 });

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
                            console.log(`[META] Nenhuma pasta encontrada para ${sId}. Tentando busca direta...`);
                            
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
            } catch (e) { console.error(`[META ERROR] Erro ao extrair info da série ${id}:`, e.message); }

            if (meta.videos.length === 0) {
                console.warn(`[META WARNING] Nenhum episódio encontrado para a série: ${id}`);
                meta.videos.push({
                    id: `xlv:${lIdx}_${listSig}:empty:empty`,
                    title: "Nenhum episódio encontrado ou servidor instável",
                    season: 1, episode: 1
                });
            } else {
                console.log(`[META] Série processada com sucesso: ${meta.videos.length} episódios encontrados.`);
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
        const lists = this.parseConfig(configBase64); const config = lists[lIdx];
        if (!config) return { streams: [] };
        const expectedSig = crypto.createHash('md5').update(config.url).digest('hex').substring(0,4);
        if (sig && sig !== expectedSig) return { streams: [] };

        const pUrl = `https://${host}/proxy/${encodeURIComponent(configBase64)}/${lIdx}/${encodeURIComponent(sId)}?type=${type}`;
        let streams = [];
        let directAdded = false;

        if (config?.type === 'xtream') {
    if (config?.useDirect !== false) {
        const b = config.url.trim().replace(/\/$/, "");
        if (type === 'tv') {
            streams.push({ name: name, url: `${b}/${config.user}/${config.pass}/${sId}`, title: `📺 Directo TV`, behaviorHints: { notWebReady: true }, contentType: 'video/mp2t' });
        } else if (type === 'movie') {
            streams.push({ name: name, url: `${b}/movie/${config.user}/${config.pass}/${sId}`, title: `🎬 Directo Filme`, behaviorHints: { notWebReady: false } });
        } else if (type === 'series') {
            streams.push({ name: name, url: `${b}/series/${config.user}/${config.pass}/${sId}`, title: `🍿 Directo Série - ${name}`, behaviorHints: { notWebReady: false } });
        }
            }   // fecha o if (useDirect)
} else if (config?.type === 'm3u') {
    // 👇 BLOCO M3U
    const url = decodeURIComponent(sId);
    if (config?.useDirect !== false) {
        streams.push({ name: name, url: url, title: '📺 Directo M3U', behaviorHints: { notWebReady: true }, contentType: 'video/mp2t' });
        directAdded = true;
    }
} else {   // fecha o if (xtream) e inicia o else (Stalker)
    try {
        let auth = await engine.authenticate(config, config.proxy);
                if (auth) {
                    const decodedCmd = decodeURIComponent(sId);
                    let realCmd = decodedCmd;
                    let sNum = null;
                    if (decodedCmd.includes('|||')) {
                        let partsCmd = decodedCmd.split('|||');
                        realCmd = partsCmd[0];
                        sNum = partsCmd[1];
                    } else if (decodedCmd.includes('|')) {
                        let partsCmd = decodedCmd.split('|');
                        realCmd = partsCmd[0];
                        sNum = partsCmd[1];
                    }
                    console.log(`[STREAMS] Stalker - Extraindo link para cmd/id=${realCmd}, series=${sNum || 'N/A'}`);

                    let cmdUrl = await engine.createStreamLink(auth, config, realCmd, type, sNum);
                    if (!cmdUrl || cmdUrl.trim() === "") {
                        console.log(`[STREAMS] Link não recebido. Forçando novo token...`);
                        auth = await engine.authenticate(config, config.proxy);
                        if (auth) cmdUrl = await engine.createStreamLink(auth, config, realCmd, type, sNum);
                    }

                    if (typeof cmdUrl === 'string' && cmdUrl.trim() !== "") {
                        console.log(`[STREAMS] Sucesso! URL original recebido: ${cmdUrl}`);
                        let cleanUrl = cmdUrl.replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
                        if (!cleanUrl.includes('.ts') && !cleanUrl.includes('.m3u8') && !cleanUrl.includes('.mp4')) {
                            cleanUrl += (cleanUrl.includes('?') ? '&' : '?') + 'format=ts';
                        }
                        if (cleanUrl.includes('://')) {
    if (config?.useDirect !== false) {
        const titleStr = type === 'movie' ? '🎬 Directo Filme' : (type === 'series' ? `🍿 Directo Série - ${name}` : '⚡ Directo TV');
        streams.push({ name: name, url: cleanUrl, title: titleStr, behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
        directAdded = true;
    }
}
                    } else {
                        console.warn(`[STREAMS WARNING] Nenhuma tentativa devolveu link válido para ${id}`);
                    }
                }
            } catch(e) { 
                console.error(`[STREAM ERROR] Falha no processo de link Stalker para ${id}:`, e.message); 
            }

            if (!directAdded) {
    if (config?.useDirect !== false) {
        let fallbackUrl = decodeURIComponent(sId).split('|||')[0].split('|')[0].replace(/^(ffrt|ffmpeg|ffrt2|rtmp)\s+/, "").trim();
        if (fallbackUrl.startsWith('http')) {
            const titleStr = type === 'movie' ? '🎬 Directo Filme' : (type === 'series' ? `🍿 Directo Série - ${name}` : '⚡ Directo TV');
            streams.push({ name: name, url: fallbackUrl, title: titleStr, behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
        }
     }
  }
}
        
                                // Se houver proxy configurado, forçar o stream a passar pelo proxy do addon
                        const hasProxy = config?.proxy && config.proxy.trim().length > 0;
if (hasProxy) {
    // Remove streams diretos (Directo TV, etc.) – mantém apenas M3U se existir
    streams = streams.filter(s => s.title === '📺 Directo M3U');
    const hint = config?.streamHint || '';
    const proxyTitle = (hint ? hint + ' ' : '') + 
                       (type === 'movie' ? '🎬 Proxy Estável' : (type === 'series' ? `🍿 Proxy Estável - ${name}` : '🔄 Proxy Estável'));
    streams.push({ name: name, url: pUrl, title: proxyTitle, behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
} else {
    const useProxy = config?.useProxy !== false;
    if (useProxy) {
        const hint = config?.streamHint || '';
        const proxyTitle = (hint ? hint + ' ' : '') + 
                           (type === 'movie' ? '🎬 Proxy Estável' : (type === 'series' ? `🍿 Proxy Estável - ${name}` : '🔄 Proxy Estável'));
        streams.push({ name: name, url: pUrl, title: proxyTitle, behaviorHints: { notWebReady: type === 'tv' }, contentType: type === 'tv' ? 'video/mp2t' : undefined });
    }
}
return { streams };
    }
};

module.exports = addon;
