# Development Dockerfile - No build, just run dev server
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY bots/package.json ./bots/

# Install all dependencies (including dev dependencies)
RUN npm install
RUN cd bots && npm install

# Copy all source code
COPY . .

# Expose ports
EXPOSE 3000

# Default: Run Next.js dev server
CMD ["npm", "run", "dev"]

