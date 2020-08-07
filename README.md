# Hack Day Project Voting!

Run the frontend html in its own nginx:alpine docker container, and the backend in its own dedicated nodejs docker container

Frontend can run from the backend container because of express static tho (/ directs to index.html automatically)

ssh chris@chrisrogus.com "cd ~/docker-apps/hackdayvoting/ && docker rm -f hackdayvoting && docker build -t hackdayvoting . && docker run -d --restart=always --env-file .env --network=www -l 'caddy'='hackdayvoting.chrisrogus.com' -l 'caddy.reverse_proxy'='\$CONTAINER_IP:3000' --name hackdayvoting hackdayvoting"
