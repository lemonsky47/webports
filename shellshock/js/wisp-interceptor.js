// ws-interceptor.js
const unblockedDomains = [
    "geometry.monster",
    "humanorganising.org",
    "algebra.vip",
    "mathdrills.info",
    "geometry.report",
    "mathlete.fun",
    "mathlete.pro",
    "biologyclass.club",
    "yolk.life",
    "yolk.rocks",
    "violentegg.club",
    "math.international",
    "eggcombat.com",
    "algebra.vip",
    "eggsarecool.com",
    "violentegg.fun",
    "geometry.pw",
    "mathactivity.club",
    "mathdrills.life",
    "mathactivity.xyz",
    "urbanegger.com",
    "shellsocks.com",
    "eggboy.club",
    "yolk.quest",
    "deathegg.life",
    "combateggs.com",
    "shellshockers.best",
    "risenegg.com",
    "algebra.monster",
    "eggbattle.com",
    "shellshockers.xyz",
    "shellshockers.today",
    "shellshockers.life",
    "scrambled.us",
    "zygote.cafe",
    "shellshock.io",
    "yolk.today",
    "mathfun.rocks",
    "shellshockers.club",
    "yolk.best",
    "eggisthenewblack.com",
    "scrambled.tech",
    "overeasy.club",
    "shellshockers.world",
    "scrambled.today",
    "deathegg.world",
    "softboiled.club",
    "eggboy.xyz",
    "hardshell.life",
    "algebra.best",
    "egg.dance",
    "deadlyegg.com",
    "shellshockers.us",
    "egghead.institute",
    "eggfacts.fun",
    "shellshockers.site",
    "yolk.tech",
    "mathgames.world",
    "scrambled.world",
    "scrambled.best",
    "egggames.best",
    "eggshooter.best",
    "eggshock.com",
    "eggshock.net",
    "eggwars.io",
    "shockers.one",
    "shellshock.guru",
    "deathegg.life",
    "eggtown.org",
    "shellplay.org",
    "eggshock.me",
    "eggshooter.com",
    "shellshockers.ca",
    "shellgame.quest",
    "shellgame.one",
    "shellshockers.wiki"
];

// Pick a random unblocked domain
const proxyDomain = unblockedDomains[Math.floor(Math.random() * unblockedDomains.length)];

console.log('[Interceptor] Using official proxy domain:', proxyDomain);

const OriginalWebSocket = window.WebSocket;

// Map local paths to official server with the unblocked domain
const PATH_MAP = {
    '/matchmaker/': `wss://${proxyDomain}/matchmaker/`,
    '/services/': `wss://${proxyDomain}/services/`,
};

function remapUrl(url) {
    // 1. Manually catch the common Shell Shockers "internal" URL formats using regex
    // This handles strings that the URL constructor might reject (like those ending in .0.1)

    // Pattern for /matchmaker/ or /services/ on ANY host/port
    if (url.includes('/matchmaker/')) return `wss://${proxyDomain}/matchmaker/`;
    if (url.includes('/services/')) return `wss://${proxyDomain}/services/`;

    // Pattern for game servers: anyhost.0.1 or anyhost.shellshock.io
    const gameServerMatch = url.match(/ws(?:s)?:\/\/([^/]+)(\/game\/.*)/);
    if (gameServerMatch) {
        let hostname = gameServerMatch[1];
        const path = gameServerMatch[2];
        if (hostname.endsWith('.0.1') || hostname.endsWith('shellshock.io')) {
            // Extract the prefix (e.g. "egs-static-live-singapore-19357z9h")
            const prefix = hostname.replace('.0.1', '').replace('.shellshock.io', '');
            // Some hostnames might just be "shellshock.io" or "127.0.0.1" (no prefix)
            const newHostname = (prefix === hostname || prefix === '127.0.0.1') ? proxyDomain : `${prefix}.${proxyDomain}`;
            const newUrl = `wss://${newHostname}${path}`;
            console.log('[Interceptor] Game server match:', hostname, '->', newUrl);
            return newUrl;
        }
    }

    // 2. Fallback to URL constructor for anything else
    try {
        const parsed = new URL(url);
        if (parsed.hostname.endsWith('shellshock.io') || parsed.hostname.endsWith('.0.1')) {
            const prefix = parsed.hostname.replace('.0.1', '').replace('.shellshock.io', '');
            const newHostname = (prefix === parsed.hostname || prefix === '127.0.0.1') ? proxyDomain : `${prefix}.${proxyDomain}`;
            const newUrl = `wss://${newHostname}${parsed.pathname}${parsed.search}`;
            console.log('[Interceptor] URL match:', parsed.hostname, '->', newUrl);
            return newUrl;
        }
    } catch (e) {
        // If it's a known "bad" hostname but URL() failed, try a blind string replacement
        if (url.includes('.0.1') || url.includes('shellshock.io')) {
            const fixed = url
                .replace(/ws(?:s)?:\/\/[^/]+/, `wss://${proxyDomain}`)
                .replace('ws://', 'wss://');
            console.log('[Interceptor] String-fix for bad URL:', url, '->', fixed);
            return fixed;
        }
    }
    return url;
}

function ProxyWebSocket(url, protocols) {
    const targetUrl = remapUrl(url);
    if (url !== targetUrl) {
        console.log('[Interceptor] Remapped WS:', url, '→', targetUrl);
    }

    // Pass protocols only if provided, Firefox throws on explicit `undefined`
    if (arguments.length > 1) {
        return new OriginalWebSocket(targetUrl, protocols);
    } else {
        return new OriginalWebSocket(targetUrl);
    }
}

for (let key in OriginalWebSocket) {
    ProxyWebSocket[key] = OriginalWebSocket[key];
}
ProxyWebSocket.prototype = OriginalWebSocket.prototype;

window.WebSocket = ProxyWebSocket;
window.WispReady = true;
console.log('[Interceptor] Native WebSocket patch ready');
