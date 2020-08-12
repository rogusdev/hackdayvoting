# Hack Day Project Voting!

Frontend can run from the backend container because of express static (/ directs to index.html automatically)

Could run the frontend html in its own nginx:alpine docker container, and the backend in its own dedicated nodejs docker container


ssh chris@chrisrogus.com "cd ~/docker-apps/hackdayvoting/ && docker rm -f hackdayvoting && docker build -t hackdayvoting . && docker run -d --restart=always --env-file .env --network=www -l 'caddy'='hackdayvoting.chrisrogus.com' -l 'caddy.reverse_proxy'='\$CONTAINER_IP:3000' --name hackdayvoting hackdayvoting"

scp server.js chris@chrisrogus.com:~/docker-apps/hackdayvoting/

ssh chris@chrisrogus.com "docker logs -f hackdayvoting"



git fetch && git reset --hard origin/master

sed -i 's|const SERVER_URL_BASE = "http://localhost:3000/"|const SERVER_URL_BASE = "https://hackdayvoting.chrisrogus.com/"|' public/index.html
sed -i 's|const HOSTED_DOMAIN = "example.com"|const HOSTED_DOMAIN = "OTHER.com"|' public/index.html
sed -i 's|//hosted_domain: HOSTED_DOMAIN,|hosted_domain: HOSTED_DOMAIN,|' public/index.html
sed -i 's|headerCells.push(category.name)|headerCells.push(category.name == "Company" ? "Product" : category.name == "Personal" ? "Rockstar" : category.name)|' public/index.html
