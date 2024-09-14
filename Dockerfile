FROM node:22

# Node setup
WORKDIR /src
COPY package*.json ./
RUN npm install
COPY . .

# SSH setup
RUN apt-get update && apt-get install -y openssh-server
RUN mkdir /var/run/sshd
RUN sed -i 's/PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config

RUN useradd -m -s /bin/bash lilly
RUN echo 'lilly:banana' | chpasswd

EXPOSE 22

CMD ["/usr/sbin/sshd", "-D"]
