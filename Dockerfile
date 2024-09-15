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
# RUN --mount=type=secret,id=b2_app_key \
#   B2_APP_KEY=$(cat /run/secrets/b2_app_key) \
#   && export B2_APP_KEY
# RUN --mount=type=secret,id=b2_key_id \
#   B2_KEY_ID=$(cat /run/secrets/b2_key_id) \
#   && export B2_KEY_ID

RUN --mount=type=secret,id=b2_key_id \
  export B2_KEY_ID=$(cat /run/secrets/b2_key_id) 
RUN --mount=type=secret,id=b2_app_key \
  export B2_APP_KEY=$(cat /run/secrets/b2_app_key) 
RUN echo "the B2_KEY_ID is $B2_KEY_ID"
RUN echo "the B2_APP_KEY is $B2_APP_KEY"

# Sync with b2 bucket
RUN ./b2-linux account authorize "$B2_KEY_ID" "$B2_APP_KEY"
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
