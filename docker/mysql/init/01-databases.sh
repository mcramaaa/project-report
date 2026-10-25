#!/bin/sh
# Runs once on a fresh volume (docker-entrypoint-initdb.d). Safe to re-run:
#   docker compose exec mysql sh /docker-entrypoint-initdb.d/01-databases.sh
# Creates the disposable test and Prisma shadow databases for the app user.
set -eu
mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_test\`;
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}_shadow\`;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_test\`.* TO '${MYSQL_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}_shadow\`.* TO '${MYSQL_USER}'@'%';
SQL
