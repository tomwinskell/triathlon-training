-- One append-only table. `json` holds a log entry or an override record; `seq` is the file order.
CREATE TABLE entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('log', 'override')),
  json TEXT NOT NULL
);
