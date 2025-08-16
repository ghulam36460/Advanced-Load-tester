# Advanced Load Tester - Production Dockerfile
# Builds a single container running Node.js app which spawns the Python bridge

FROM node:18-bullseye

# Install Python for the bridge
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Install Python dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

ENV NODE_ENV=production
EXPOSE 3000 5001

# Start unified server (spawns Python bridge if available)
CMD ["npm","start"]
