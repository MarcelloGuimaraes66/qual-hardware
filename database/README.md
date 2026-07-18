# Dedicated Qual Hardware database

Qual Hardware owns an independent PostgreSQL database, role, schema and data volume:

- database: `qual_hardware`
- application role: `qual_hardware`
- SQL schema: `qual_hardware`
- Compose volume: `qual_hardware_database`

`docker compose up` provisions the database and role through the official PostgreSQL image. The application then applies `schema.sql` inside that dedicated database.

For an externally managed PostgreSQL server, an administrator must create the isolated role and database before starting the application:

```sql
CREATE ROLE qual_hardware LOGIN PASSWORD '<secret-from-the-host-secret-store>';
CREATE DATABASE qual_hardware OWNER qual_hardware;
```

Set `DATABASE_URL` to that database only. Both the application connection guard and `schema.sql` reject any other database name. Never reuse a Perceptrum, Drakon, shared product or PostgreSQL maintenance database.

The database stores only Qual Hardware projects, generated recommendations, benchmark metadata/results, catalog entries, price quotes and its internal work queue. It never stores Perceptrum media, RTSP credentials or Perceptrum application records.
