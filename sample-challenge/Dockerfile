# Use a lightweight Node.js operating system
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application files (including the secret flag)
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Security Best Practice: Drop root privileges!
# Even if a hacker takes over the app, they won't have admin rights to the container.
USER node

# Start the vulnerable application
CMD [ "node", "app.js" ]
