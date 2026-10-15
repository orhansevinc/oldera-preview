FROM nginx:1.27-alpine
COPY deploy/domain-live/nginx.conf /etc/nginx/nginx.conf
COPY index.html account.html site-config.js oldkoweb-v14-a.css oldkoweb-v14-b.css oldkoweb-v14.js account-v15.css account-v15.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
COPY admin /usr/share/nginx/html/admin
COPY real1298 /usr/share/nginx/html/real1298
COPY real1298.html play.html client1298.html /usr/share/nginx/html/
COPY *.js /usr/share/nginx/html/
EXPOSE 8080
