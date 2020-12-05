
scp *.js chris@chrisrogus.com:~/docker-apps/hackdayvoting/
scp -r public chris@chrisrogus.com:~/docker-apps/hackdayvoting/
ssh chris@chrisrogus.com "cd ~/docker-apps/hackdayvoting/ && ./sedify"

ssh chris@chrisrogus.com "cd ~/docker-apps/hackdayvoting/ && docker rm -f hackdayvoting && docker build -t hackdayvoting . && docker run -d --restart=always --env-file .env --network=www -l 'caddy'='hackdayvoting.chrisrogus.com' -l 'caddy.reverse_proxy'='\$CONTAINER_IP:3000' --name hackdayvoting hackdayvoting"

ssh chris@chrisrogus.com "docker logs -f hackdayvoting"

