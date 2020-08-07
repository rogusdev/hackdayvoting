# Hack Day Project Voting!

Run the frontend html in its own nginx:alpine docker container, and the backend in its own dedicated nodejs docker container

Frontend can run from the backend container because of express static tho (/ directs to index.html automatically)
