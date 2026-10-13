# KO1298 binary fixtures

Every `.bin` file in this directory is an **outer KO wire frame**:

`AA55 + uint16LE(payload length) + payload + 55AA`

See `manifest.json` for direction, provenance and byte-exact hex. Do not edit binary fixtures by hand; regenerate them with:

```bash
python3 tools/ws11_protocol/generate_fixtures.py
```

The generator only emits structures already documented in `../KO1298_PROTOCOL.md`. Synthetic values are ASCII/demo values and are labelled `synthetic-source-derived`; they are not captured credentials or production data.
