# Planning

- Risk tier: T4 (persistent data, desktop packaging and catalog trust boundary).
- Goal: replace PostgreSQL/session memory with a dedicated local SQLite database without coupling Qual Hardware to Perceptrum.
- Scope: store, schema, desktop data path, worker/API sharing, package contents, tests and operator documentation.
- Rollback: restore the previous store/schema and executable; existing `qual-hardware.sqlite` remains isolated and is not consumed by Perceptrum.
