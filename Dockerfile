FROM node:22

# Node setup
WORKDIR /src
COPY package*.json ./
RUN npm install
COPY . .

# Install curl
RUN apt-get update && apt-get install curl

# Download b2 cli
RUN curl -LJO https://github.com/Backblaze/B2_Command_Line_Tool/releases/download/v4.1.0/b2-linux
RUN chmod +x b2-linux

# Get b2 secrets from docker build args
RUN --mount=type=secret,id=b2_app_key,env=B2_APP_KEY
RUN --mount=type=secret,id=b2_key_id,env=B2_KEY_ID
RUN echo $B2_KEY_ID
RUN echo $B2_APP_KEY

# Sync with b2 bucket
RUN ./b2-linux account authorize $B2_KEY_ID $B2_APP_KEY
RUN ./b2-linux sync --threads 10 b2://osm-reader src/data

# SSH setup
RUN apt-get update && apt-get install -y openssh-server
RUN mkdir /var/run/sshd
RUN sed -i 's/PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

# Add SSH user
RUN useradd -m -s /bin/bash lilly
RUN echo 'lilly:banana' | chpasswd

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
