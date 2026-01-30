# Simple Ubuntu environment with Node.js
FROM ubuntu:25.04

WORKDIR /app

# Install Node.js and npm
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy all source code
COPY . .

# Expose port
EXPOSE 3000

# Keep container running - access with: docker exec -it <container> bash
CMD ["tail", "-f", "/dev/null"]


