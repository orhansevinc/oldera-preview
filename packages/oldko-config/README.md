# @oldko/config

Central runtime configuration contract for OldKOWeb server-side services.

## Usage

```js
import { loadConfig, redactConfig } from "@oldko/config";

const config = loadConfig(process.env); // throws on invalid startup config
console.info(redactConfig(config));
```

The package has no runtime dependency and targets Node.js 20+. It validates before service startup and returns an immutable typed configuration object.

## Rules

- Central variables use the `OLDKO_` prefix.
- `OLDKO_ENV` is one of `development`, `test`, or `production`.
- `OLDKO_SERVICE_NAME` is required.
- Unknown `OLDKO_` variables fail by default, catching typos early. Feature flags are the exception and use `OLDKO_FF_*`.
- Production literal secrets are rejected. Use a secret reference such as `env://NAME`, `file:///run/secrets/name`, or `secret://provider/key`.
- The package validates references only; it intentionally does **not** read secret files, secret managers, or remote providers.
- Log config through `redactConfig()` or environment maps through `redactEnv()`.

See `config/CONFIG_STANDARD.md` and `config/env/*.env.example` for the full contract.
