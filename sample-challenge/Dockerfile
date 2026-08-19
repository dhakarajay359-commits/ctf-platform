# Use a lightweight Node.js operating system
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY app.js ./
COPY public.txt ./

# Security Best Practice: Store flag outside web roots (/root/flag.txt) with restricted permissions
COPY flag.txt /root/flag.txt
RUN chmod 444 /root/flag.txt

# Entrypoint script to inject dynamic $FLAG or $CTF_FLAG if provided
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'if [ ! -z "$FLAG" ]; then echo "$FLAG" > /root/flag.txt; chmod 444 /root/flag.txt; fi' >> /entrypoint.sh && \
    echo 'exec su node -c "node /usr/src/app/app.js"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

EXPOSE 8080

CMD [ "/bin/sh", "/entrypoint.sh" ]
