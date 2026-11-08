# Serves the prebuilt PWA (npm run build -> dist/). The build runs natively, not
# in this image, so the multi-arch image needs no Node under QEMU.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
EXPOSE 8080
