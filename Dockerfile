FROM node:22

# Node setup
WORKDIR /src
COPY package*.json ./
RUN npm install
COPY . .

# Get data files
RUN apt-get update && apt-get install curl
RUN curl -LJO https://github.com/Backblaze/B2_Command_Line_Tool/releases/download/v4.1.0/b2-linux
RUN ls -la
RUN chmod +x b2-linux
RUN ./b2-linux account authorize 005205ae54896c60000000003 K005fKEnOSKLz5O70PNqkznHisipRXI
RUN ./b2-linux sync --threads 10 b2://osm-reader src/data

# SSH setup
RUN apt-get update && apt-get install -y openssh-server
RUN mkdir /var/run/sshd
RUN sed -i 's/PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

RUN useradd -m -s /bin/bash lilly
RUN echo 'lilly:banana' | chpasswd

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
