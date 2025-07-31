# Base image with Ubuntu
FROM ubuntu:24.04

# Set non-interactive frontend for apt
ENV DEBIAN_FRONTEND=noninteractive

# Update and install dependencies
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    curl \
    wget \
    git \
    gnupg \
    software-properties-common \
    python3 \
    python3-pip \
    openjdk-21-jdk \
    gcc \
    g++ \
    unzip \
    ca-certificates \
    lsb-release \
    apt-transport-https && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS) and TypeScript
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g typescript

# Install Rust (via rustup)
RUN curl https://sh.rustup.rs -sSf | bash -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Go
ENV GO_VERSION=1.22.3
RUN curl -LO https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz && \
    tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz && \
    rm go${GO_VERSION}.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

# Install .NET SDK (C#)
RUN wget https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb && \
    dpkg -i packages-microsoft-prod.deb && \
    rm packages-microsoft-prod.deb && \
    apt-get update && \
    apt-get install -y dotnet-sdk-8.0

# Create app directory
WORKDIR /usr/src/app

# Copy app files
COPY package*.json ./
RUN npm install
RUN npm install node-fetch
COPY . .

# Expose port
EXPOSE 3000

# Start server
CMD ["npm", "start"]
