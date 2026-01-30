# Simple Ubuntu environment with Node.js
FROM ubuntu:25.04

WORKDIR /app

# Install Node.js, npm, and screen
RUN apt-get update && apt-get install -y \
    curl \
    screen \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy all source code
COPY . .

# Install dependencies
RUN npm install

# Create startup script
RUN echo '#!/bin/bash\n\
screen -dmS bot bash -c "cd /app && ASK_TOTAL_QUOTE_AMOUNT=200 BID_TOTAL_QUOTE_AMOUNT=300 SPREAD_PERCENT=20 NUMBER_OF_ORDERS=20 npx tsx bots/crypto/cex/mm/mm-both-side.ts; exec bash"\n\
echo \"Bot started in screen session '\''bot'\''\"\n\
echo \"To attach: screen -r bot\"\n\
echo \"To detach: Ctrl+A then D\"\n\
tail -f /dev/null\n\
' > /app/start.sh && chmod +x /app/start.sh

# Expose port
EXPOSE 3000

# Start bot in screen and keep container running
CMD ["/app/start.sh"]


