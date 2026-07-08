# Moonveil Obfuscator — Dockerfile
# Base: Node (serves the dashboard + API) with Lua 5.1 added (to run Prometheus)

FROM node:20-alpine

# Lua 5.1 is what Prometheus expects. git is needed to pull the Prometheus source.
RUN apk add --no-cache lua5.1 lua5.1-dev git

WORKDIR /app

# --- Pull Prometheus obfuscator source into /app/prometheus ---
# Repo: https://github.com/levno-710/Prometheus
RUN git clone --depth 1 https://github.com/levno-710/Prometheus.git ./prometheus

# --- Install Node dependencies ---
COPY package.json ./
RUN npm install --omit=dev

# --- Copy server (HTML/CSS/JS is inline inside server.js) ---
COPY server.js ./

# Render (and most PaaS) inject PORT automatically. We fall back to 3000 locally.
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
