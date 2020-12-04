# Hack Day Project Voting!

```
asdf install nodejs 14.15.1
asdf global nodejs 14.15.1
yarn install
yarn start

docker exec -it hackdayvoting ash
apk --no-cache add curl nano

```

Frontend can run from the backend container because of express static (/ directs to index.html automatically)

Could run the frontend html in its own nginx:alpine docker container, and the backend in its own dedicated nodejs docker container


scp *.js chris@chrisrogus.com:~/docker-apps/hackdayvoting/
scp -r public chris@chrisrogus.com:~/docker-apps/hackdayvoting/

ssh chris@chrisrogus.com "cd ~/docker-apps/hackdayvoting/ && docker rm -f hackdayvoting && docker build -t hackdayvoting . && docker run -d --restart=always --env-file .env --network=www -l 'caddy'='hackdayvoting.chrisrogus.com' -l 'caddy.reverse_proxy'='\$CONTAINER_IP:3000' --name hackdayvoting hackdayvoting"

ssh chris@chrisrogus.com "docker logs -f hackdayvoting"
ssh chris@chrisrogus.com "cat ~/docker-apps/hackdayvoting/.env"



git fetch && git reset --hard origin/master

sed -i 's|const SERVER_URL_BASE = "http://localhost:3000/"|const SERVER_URL_BASE = "https://hackdayvoting.chrisrogus.com/"|' public/index.html
sed -i 's|//hosted_domain: HOSTED_DOMAIN,|hosted_domain: HOSTED_DOMAIN,|' public/index.html
sed -i 's|json.data.categories\b|json.data.categories.map(c => ({id: c.id, name: (c.name == "Company" ? "Product" : c.name == "Personal" ? "Rockstar" : c.name) }))|' public/index.html
sed -i 's|const HOSTED_DOMAIN = "example.com"|const HOSTED_DOMAIN = "OTHER.com"|' public/index.html
sed -i 's|state.email == "admin@example.com"|state.email == "other@example.com"|' public/index.html

