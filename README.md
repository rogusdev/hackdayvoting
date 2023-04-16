# Hack Day Project Voting!

```
asdf install nodejs 18.15.0
asdf global nodejs 18.15.0
yarn install
STORAGE_PROVIDER=dynamodb yarn start
```

Frontend can run from the backend container because of express static (/ directs to index.html automatically)

Could run the frontend html in its own nginx:alpine docker container, and the backend in its own dedicated nodejs docker container

Env var `STORAGE_PROVIDER` should be "dynamodb" ("postgres" incoming)
