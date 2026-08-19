FROM node:14-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY app.js ./

# Store flag outside web roots (/root/flag.txt) with restricted permissions (chmod 400)
COPY flag.txt /root/flag.txt
RUN chown root:root /root/flag.txt && chmod 400 /root/flag.txt

# Dynamic flag entrypoint - injects dynamic $FLAG or $CTF_FLAG on container boot
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'if [ ! -z "$FLAG" ]; then echo "$FLAG" > /root/flag.txt; chmod 400 /root/flag.txt; fi' >> /entrypoint.sh && \
    echo 'exec su node -c "node /usr/src/app/app.js"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

EXPOSE 8081

CMD [ "/bin/sh", "/entrypoint.sh" ]

