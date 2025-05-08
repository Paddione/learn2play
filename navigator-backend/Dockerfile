    # navigator-backend/Dockerfile

    # Use an official Node.js runtime as a parent image
    # Choose a version compatible with your project (LTS versions are good, e.g., 18, 20)
    FROM node:18-alpine AS base

    # Set the working directory in the container
    WORKDIR /app

    # Copy package.json and package-lock.json (or yarn.lock) first
    # This leverages Docker layer caching - dependencies are only re-installed if these files change
    COPY package*.json ./

    # Install app dependencies
    # Using alpine image, some packages might need build tools for native modules
    # If you encounter build issues, you might need:
    # RUN apk add --no-cache --virtual .gyp python3 make g++ && npm install && apk del .gyp
    RUN npm install

    # Copy the rest of the application code into the working directory
    COPY . .

    # Make port 4000 available to the world outside this container
    # This should match the port your server listens on in server.js
    EXPOSE 4000

    # Define the command to run your application when the container starts
    # This assumes your main server file is named server.js
    CMD [ "node", "server.js" ]
    