FROM postgres:17.9-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends age rclone ca-certificates && rm -rf /var/lib/apt/lists/*
COPY infra/docker/backup.sh /backup.sh
RUN chmod +x /backup.sh
HEALTHCHECK --interval=1h CMD test -f /status/last-success && test "$(($(date +%s) - $(cat /status/last-success)))" -lt 93600
CMD ["/backup.sh"]
