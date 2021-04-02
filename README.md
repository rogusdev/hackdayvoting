# Hack Day Project Voting!

```
asdf install nodejs 14.15.1
asdf global nodejs 14.15.1
yarn install
yarn start
```

Frontend can run from the backend container because of express static (/ directs to index.html automatically)

Could run the frontend html in its own nginx:alpine docker container, and the backend in its own dedicated nodejs docker container

Env var `STORAGE_PROVIDER` should be "dynamodb" ("postgres" incoming)
